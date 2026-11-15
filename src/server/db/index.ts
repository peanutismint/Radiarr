import { DatabaseSync } from 'node:sqlite';
import {
  computeTrackEnergyLevel,
  resolveTrackEraMetadata,
} from '../../shared/metadataNormalizer.ts';
import { DB_PATH } from '../config.ts';

export const db = new DatabaseSync(DB_PATH);

export function initDatabase(): void {
  try {
    db.exec(`PRAGMA journal_mode = WAL;`);
  } catch {
    // Windows Docker Desktop bind mounts (/config) sometimes do not support WAL shared memory (-shm/-wal)
    db.exec(`PRAGMA journal_mode = DELETE;`);
  }

  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -64000;

    -- 1. Music Sources / Libraries (each immediate subfolder of /music)
    CREATE TABLE IF NOT EXISTS libraries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'local',
      path TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_scanned_at INTEGER
    );

    -- 2. Albums (grouped by COALESCE(album_artist, artist) + album title)
    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      year INTEGER,
      art_path TEXT
    );

    -- 2b. Artists (generic band/artist press photos and fanart)
    CREATE TABLE IF NOT EXISTS artists (
      name TEXT PRIMARY KEY,
      art_path TEXT
    );

    -- 3. Tracks
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      album_id TEXT NOT NULL REFERENCES albums(id),
      file_path TEXT NOT NULL UNIQUE,
      ext TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album_artist TEXT,
      album TEXT NOT NULL,
      track_number INTEGER NOT NULL DEFAULT 1,
      disc_number INTEGER NOT NULL DEFAULT 1,
      year INTEGER,
      original_year INTEGER,
      genre TEXT,
      bpm INTEGER,
      mood TEXT,
      energy_level INTEGER NOT NULL DEFAULT 2,
      is_reissue_or_comp INTEGER NOT NULL DEFAULT 0,
      gain_db REAL,
      duration_ms INTEGER NOT NULL,
      tags_incomplete INTEGER NOT NULL DEFAULT 0,
      missing_fields_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_library ON tracks(library_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id, disc_number, track_number);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist_lower ON tracks(lower(artist));
    CREATE INDEX IF NOT EXISTS idx_tracks_year ON tracks(year);
    CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);
    CREATE INDEX IF NOT EXISTS idx_albums_artist_lower ON albums(lower(artist));

    -- 4. Scan Reports (last scan summary per run)
    CREATE TABLE IF NOT EXISTS scan_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT NOT NULL,
      tracks_total INTEGER NOT NULL DEFAULT 0,
      albums_total INTEGER NOT NULL DEFAULT 0,
      artists_total INTEGER NOT NULL DEFAULT 0,
      tags_incomplete_count INTEGER NOT NULL DEFAULT 0,
      skipped_by_ext_json TEXT NOT NULL DEFAULT '{}',
      unreadable_files_json TEXT NOT NULL DEFAULT '[]'
    );

    -- 5. Stations
    CREATE TABLE IF NOT EXISTS stations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      channel_number INTEGER NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      play_mode TEXT NOT NULL,
      rules_json TEXT NOT NULL,
      dayparts_enabled INTEGER NOT NULL DEFAULT 0,
      dayparts_json TEXT NOT NULL DEFAULT '[]',
      tile_color TEXT NOT NULL,
      seed INTEGER NOT NULL,
      epoch_ms INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- 6. Daypart Schedule Checkpoints (Phase 7)
    CREATE TABLE IF NOT EXISTS station_checkpoints (
      station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      day_utc_ms INTEGER NOT NULL,
      track_start_ms INTEGER NOT NULL,
      active_segment_id TEXT NOT NULL,
      segment_state_json TEXT NOT NULL,
      PRIMARY KEY (station_id, revision, day_utc_ms)
    );

    -- 7. Dismissed Suggestions
    CREATE TABLE IF NOT EXISTS dismissed_suggestions (
      suggestion_key TEXT PRIMARY KEY,
      dismissed_at INTEGER NOT NULL
    );

    -- 8. Transcode Cache LRU Index
    CREATE TABLE IF NOT EXISTS transcode_cache (
      track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
      cache_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      bitrate_kbps INTEGER NOT NULL,
      last_accessed_ms INTEGER NOT NULL
    );

    -- 9. Server-side Settings
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );

    -- 10. Users & Authentication
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'listener',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

    -- 11. User Sessions
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

    -- 12. Playback Diagnostic Logs
    CREATE TABLE IF NOT EXISTS playback_logs (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      level TEXT NOT NULL,
      category TEXT NOT NULL,
      track_id TEXT,
      title TEXT,
      artist TEXT,
      ext TEXT,
      source TEXT,
      method TEXT,
      http_status INTEGER,
      message TEXT NOT NULL,
      details TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_playback_logs_timestamp ON playback_logs(timestamp DESC);
  `);

  // Safe migrations for existing databases
  const safeAlters = [
    `ALTER TABLE stations ADD COLUMN thumbnail_url TEXT;`,
    `ALTER TABLE stations ADD COLUMN custom_color INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE tracks ADD COLUMN original_year INTEGER;`,
    `ALTER TABLE tracks ADD COLUMN bpm INTEGER;`,
    `ALTER TABLE tracks ADD COLUMN mood TEXT;`,
    `ALTER TABLE tracks ADD COLUMN energy_level INTEGER NOT NULL DEFAULT 2;`,
    `ALTER TABLE tracks ADD COLUMN is_reissue_or_comp INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE tracks ADD COLUMN gain_db REAL;`,
  ];
  for (const sql of safeAlters) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists
    }
  }

  backfillTrackMetadataAndEnergy();
}

/**
 * Automatically backfills energy_level, original_year, and is_reissue_or_comp
 * on existing tracks in SQLite so Dayparting and Era/Genre accuracy work immediately
 * without requiring a full re-scan.
 */
export function backfillTrackMetadataAndEnergy(): void {
  try {
    const rows = db
      .prepare(`
        SELECT
          t.id,
          t.title,
          t.artist,
          t.album_artist,
          t.album,
          t.year,
          t.original_year,
          t.genre,
          t.bpm,
          t.mood,
          t.duration_ms,
          a.year AS album_year
        FROM tracks t
        LEFT JOIN albums a ON a.id = t.album_id
      `)
      .all() as Array<{
      id: string;
      title: string;
      artist: string;
      album_artist: string | null;
      album: string;
      year: number | null;
      original_year: number | null;
      genre: string | null;
      bpm: number | null;
      mood: string | null;
      duration_ms: number;
      album_year: number | null;
    }>;

    if (rows.length === 0) return;

    const updateStmt = db.prepare(`
      UPDATE tracks
      SET original_year = ?,
          energy_level = ?,
          is_reissue_or_comp = ?
      WHERE id = ?
    `);

    db.exec('BEGIN IMMEDIATE');
    try {
      for (const r of rows) {
        const eraMeta = resolveTrackEraMetadata({
          year: r.year !== null ? Number(r.year) : null,
          originalYear: r.original_year !== null ? Number(r.original_year) : null,
          albumYear: r.album_year !== null ? Number(r.album_year) : null,
          title: r.title,
          album: r.album,
          artist: r.artist,
          albumArtist: r.album_artist,
        });

        const energyLevel = computeTrackEnergyLevel({
          title: r.title,
          album: r.album,
          genre: r.genre,
          mood: r.mood,
          bpm: r.bpm !== null ? Number(r.bpm) : null,
          durationMs: Number(r.duration_ms),
        });

        updateStmt.run(
          eraMeta.originalYear,
          energyLevel,
          eraMeta.isReissueOrComp ? 1 : 0,
          r.id
        );
      }
      db.exec('COMMIT');
    } catch {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore if table is empty or migrating
  }
}

