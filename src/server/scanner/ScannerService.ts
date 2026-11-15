import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  AlbumSummary,
  ArtistSummary,
  LibraryInfo,
  ScanProgress,
  ScanResultsOverview,
  ScanRunSummary,
  TagProblemTrack,
  UnreadableFileReport,
} from '../../shared/types.ts';
import { MUSIC_DIR } from '../config.ts';
import { db } from '../db/index.ts';
import { LocalFolderSource } from '../sources/LocalFolderSource.ts';
import { MusicSource } from '../sources/MusicSource.ts';
import {
  fetchPlexLibraryCatalog,
  ScannedPlexTrackItem,
} from '../sources/PlexService.ts';
import { invalidateTrackCatalogCache } from '../engine/RuleMatcher.ts';
import { scheduleEngine } from '../engine/ScheduleEngine.ts';
import { ensureAlbumCoverArt, ensureArtistGenericArt } from './CoverArtCache.ts';
import { probeAudioFile } from './ffprobe.ts';

function hashId(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 16);
}

function normalizeKey(str: string): string {
  return str.trim().toLowerCase();
}

class ScannerService {
  private readonly musicSource: MusicSource;
  private progress: ScanProgress = {
    isScanning: false,
    currentLibrary: null,
    filesProcessed: 0,
    filesTotal: 0,
    currentFile: null,
  };
  private cachedOverviewData: Omit<ScanResultsOverview, 'progress'> | null = null;
  private cachedOverviewTimeMs = 0;

  constructor() {
    this.musicSource = new LocalFolderSource(MUSIC_DIR);
  }

  public invalidateCaches(): void {
    this.cachedOverviewData = null;
    this.cachedOverviewTimeMs = 0;
    invalidateTrackCatalogCache();
    scheduleEngine.invalidateCurationCache();
  }

  public async syncDiscoveredLibraries(): Promise<LibraryInfo[]> {
    const discovered = await this.musicSource.discoverLibraries();
    const discoveredIds = new Set(discovered.map((d) => d.id));

    const upsertStmt = db.prepare(`
      INSERT INTO libraries (id, name, source_type, path, enabled)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        path = excluded.path
    `);

    for (const lib of discovered) {
      upsertStmt.run(lib.id, lib.name, lib.sourceType, lib.path);
    }

    // Remove auto-discovered /music/* libraries whose folders no longer exist,
    // while preserving any custom user-added library paths.
    const existingRows = db
      .prepare(`SELECT id, path FROM libraries WHERE source_type = 'local'`)
      .all() as Array<{ id: string; path: string }>;

    const resolvedMusicRoot = path.resolve(MUSIC_DIR);
    const deleteStmt = db.prepare(`DELETE FROM libraries WHERE id = ?`);
    for (const row of existingRows) {
      const resolvedRowPath = path.resolve(row.path);
      const isDirectMusicChild =
        path.dirname(resolvedRowPath) === resolvedMusicRoot;
      if (
        isDirectMusicChild &&
        !discoveredIds.has(row.id) &&
        !row.id.startsWith('custom-')
      ) {
        deleteStmt.run(row.id);
      }
    }

    return this.getLibraries();
  }

  public addCustomLibrary(name: string, folderPath: string): LibraryInfo {
    const trimmedPath = folderPath.trim();
    if (!trimmedPath) {
      throw new Error('Folder path is required.');
    }

    const trimmedName =
      name.trim() ||
      path.basename(trimmedPath.replace(/[\\/]+$/, '')) ||
      'Custom Library';

    const existing = db
      .prepare(`SELECT id FROM libraries WHERE path = ?`)
      .get(trimmedPath) as { id: string } | undefined;

    const id = existing ? existing.id : `custom-${hashId(trimmedPath).slice(0, 10)}`;

    try {
      if (trimmedPath.startsWith(MUSIC_DIR)) {
        fs.mkdirSync(trimmedPath, { recursive: true });
      }
    } catch {
      // ignore if read-only mount
    }

    db.prepare(`
      INSERT INTO libraries (id, name, source_type, path, enabled)
      VALUES (?, ?, 'local', ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        path = excluded.path,
        enabled = 1
    `).run(id, trimmedName, trimmedPath);

    this.invalidateCaches();
    const libs = this.getLibraries();
    return libs.find((l) => l.id === id)!;
  }

  public addPlexLibrary(
    sectionKey: string,
    title: string,
    machineId = 'server'
  ): LibraryInfo {
    const cleanKey = sectionKey.trim();
    const plexPath = `plex://${machineId}/${cleanKey}`;
    const id = `plex-${hashId(plexPath).slice(0, 10)}`;
    const libName = title.trim() ? `${title.trim()} (Plex)` : `Plex Library ${cleanKey}`;

    db.prepare(`
      INSERT INTO libraries (id, name, source_type, path, enabled)
      VALUES (?, ?, 'plex', ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        path = excluded.path,
        enabled = 1
    `).run(id, libName, plexPath);

    this.invalidateCaches();
    const libs = this.getLibraries();
    return libs.find((l) => l.id === id)!;
  }

  public removeLibrary(libraryId: string): boolean {
    const res = db.prepare(`DELETE FROM libraries WHERE id = ?`).run(libraryId);
    db.exec(`
      DELETE FROM albums
      WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks)
    `);
    this.invalidateCaches();
    return Number(res.changes) > 0;
  }

  public getLibraries(): LibraryInfo[] {
    const rows = db
      .prepare(`
        SELECT
          l.id,
          l.name,
          l.source_type,
          l.path,
          l.enabled,
          l.last_scanned_at,
          COUNT(t.id) AS track_count,
          COUNT(DISTINCT t.album_id) AS album_count,
          COUNT(DISTINCT lower(t.artist)) AS artist_count
        FROM libraries l
        LEFT JOIN tracks t ON t.library_id = l.id
        GROUP BY l.id
        ORDER BY l.name ASC
      `)
      .all() as Array<{
      id: string;
      name: string;
      source_type: 'local' | 'plex';
      path: string;
      enabled: number;
      last_scanned_at: number | null;
      track_count: number;
      album_count: number;
      artist_count: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      sourceType: r.source_type,
      path: r.path,
      enabled: r.enabled === 1,
      lastScannedAt: r.last_scanned_at,
      trackCount: Number(r.track_count || 0),
      albumCount: Number(r.album_count || 0),
      artistCount: Number(r.artist_count || 0),
    }));
  }

  public setLibraryEnabled(libraryId: string, enabled: boolean): LibraryInfo | null {
    db.prepare(`UPDATE libraries SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, libraryId);
    this.invalidateCaches();
    const libs = this.getLibraries();
    return libs.find((l) => l.id === libraryId) ?? null;
  }

  public getProgress(): ScanProgress {
    return { ...this.progress };
  }

  public async triggerScan(
    libraryId?: string
  ): Promise<{ started: boolean; message: string }> {
    if (this.progress.isScanning) {
      return { started: false, message: 'A scan is already in progress.' };
    }

    // Run asynchronously so the UI and HTTP call are never blocked
    void this.runIncrementalScan(libraryId);
    return {
      started: true,
      message: libraryId
        ? `Incremental scan started for library "${libraryId}".`
        : 'Incremental scan started.',
    };
  }

  private async runIncrementalScan(targetLibraryId?: string): Promise<void> {
    const startedAt = Date.now();
    this.progress = {
      isScanning: true,
      currentLibrary: null,
      filesProcessed: 0,
      filesTotal: 0,
      currentFile: null,
    };

    const insertRunResult = db
      .prepare(
        `INSERT INTO scan_runs (started_at, status, skipped_by_ext_json, unreadable_files_json)
         VALUES (?, 'running', '{}', '[]')`
      )
      .run(startedAt);
    const runId = Number(insertRunResult.lastInsertRowid);

    const aggregatedSkippedByExt: Record<string, number> = {};
    const unreadableFiles: UnreadableFileReport[] = [];

    try {
      await this.syncDiscoveredLibraries();
      const allLibs = this.getLibraries();
      const enabledLibs = targetLibraryId
        ? allLibs.filter((l) => l.id === targetLibraryId)
        : allLibs.filter((l) => l.enabled);

      // Walk all enabled libraries first to compute total candidate count for progress reporting
      const walkedByLib = new Map<
        string,
        Awaited<ReturnType<MusicSource['walkLibrary']>>
      >();
      const plexCatalogByLib = new Map<string, ScannedPlexTrackItem[]>();
      let totalFiles = 0;

      for (const lib of enabledLibs) {
        if (lib.sourceType === 'plex') {
          this.progress.currentLibrary = lib.name;
          const sectionKey = lib.path.split('/').pop() || '';
          try {
            const plexResult = await fetchPlexLibraryCatalog(sectionKey);
            plexCatalogByLib.set(lib.id, plexResult.tracks);
            totalFiles += plexResult.tracks.length;
            for (const [ext, count] of Object.entries(plexResult.skippedByExt)) {
              aggregatedSkippedByExt[ext] =
                (aggregatedSkippedByExt[ext] || 0) + count;
            }
          } catch (err) {
            unreadableFiles.push({
              path: lib.path,
              reason:
                err instanceof Error
                  ? err.message
                  : 'Failed to reach Plex library section',
            });
          }
        } else {
          const walkResult = await this.musicSource.walkLibrary(lib.path);
          walkedByLib.set(lib.id, walkResult);
          totalFiles += walkResult.candidates.length;

          for (const [ext, count] of Object.entries(walkResult.skippedByExt)) {
            aggregatedSkippedByExt[ext] = (aggregatedSkippedByExt[ext] || 0) + count;
          }
        }
      }

      this.progress.filesTotal = totalFiles;

      const upsertAlbumStmt = db.prepare(`
        INSERT INTO albums (id, title, artist, year, art_path)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          year = COALESCE(albums.year, excluded.year),
          art_path = COALESCE(albums.art_path, excluded.art_path)
      `);

      const upsertArtistStmt = db.prepare(`
        INSERT INTO artists (name, art_path)
        VALUES (?, ?)
        ON CONFLICT(name) DO UPDATE SET
          art_path = COALESCE(excluded.art_path, artists.art_path)
      `);

      const upsertTrackStmt = db.prepare(`
        INSERT INTO tracks (
          id, library_id, album_id, file_path, ext, file_size, mtime_ms,
          title, artist, album_artist, album, track_number, disc_number,
          year, original_year, genre, bpm, mood, energy_level, is_reissue_or_comp,
          gain_db, duration_ms, tags_incomplete, missing_fields_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET
          library_id = excluded.library_id,
          album_id = excluded.album_id,
          ext = excluded.ext,
          file_size = excluded.file_size,
          mtime_ms = excluded.mtime_ms,
          title = excluded.title,
          artist = excluded.artist,
          album_artist = excluded.album_artist,
          album = excluded.album,
          track_number = excluded.track_number,
          disc_number = excluded.disc_number,
          year = excluded.year,
          original_year = excluded.original_year,
          genre = excluded.genre,
          bpm = excluded.bpm,
          mood = excluded.mood,
          energy_level = excluded.energy_level,
          is_reissue_or_comp = excluded.is_reissue_or_comp,
          gain_db = excluded.gain_db,
          duration_ms = excluded.duration_ms,
          tags_incomplete = excluded.tags_incomplete,
          missing_fields_json = excluded.missing_fields_json
      `);

      for (const lib of enabledLibs) {
        this.progress.currentLibrary = lib.name;

        if (lib.sourceType === 'plex') {
          const plexTracks = plexCatalogByLib.get(lib.id);
          if (!plexTracks) continue;

          const existingTracks = db
            .prepare(`SELECT file_path FROM tracks WHERE library_id = ?`)
            .all(lib.id) as Array<{ file_path: string }>;
          const existingSet = new Set(existingTracks.map((r) => r.file_path));
          const seenPaths = new Set<string>();

          const BATCH_SIZE = 200;
          for (let i = 0; i < plexTracks.length; i += BATCH_SIZE) {
            const batch = plexTracks.slice(i, i + BATCH_SIZE);
            this.progress.currentFile = batch[0]?.title || lib.name;

            db.exec('BEGIN IMMEDIATE');
            try {
              for (const item of batch) {
                seenPaths.add(item.filePath);
                upsertAlbumStmt.run(
                  item.albumId,
                  item.albumTitle,
                  item.albumArtist,
                  item.albumYear,
                  item.artPath
                );
                if (item.artistArtPath && item.albumArtist) {
                  upsertArtistStmt.run(item.albumArtist, item.artistArtPath);
                }
                upsertTrackStmt.run(
                  item.trackId,
                  lib.id,
                  item.albumId,
                  item.filePath,
                  item.ext,
                  item.fileSize,
                  item.mtimeMs,
                  item.title,
                  item.artist,
                  item.albumArtist,
                  item.albumTitle,
                  item.trackNumber,
                  item.discNumber,
                  item.year,
                  item.originalYear,
                  item.genre,
                  item.bpm,
                  item.mood,
                  item.energyLevel,
                  item.isReissueOrComp ? 1 : 0,
                  null, // gain_db
                  item.durationMs,
                  item.tagsIncomplete ? 1 : 0,
                  JSON.stringify(item.missingFields)
                );
              }
              db.exec('COMMIT');
            } catch (txErr) {
              try {
                db.exec('ROLLBACK');
              } catch {
                // ignore
              }
              throw txErr;
            }

            this.progress.filesProcessed += batch.length;
          }

          const deleteTrackStmt = db.prepare(
            `DELETE FROM tracks WHERE library_id = ? AND file_path = ?`
          );
          for (const oldPath of existingSet) {
            if (!seenPaths.has(oldPath)) {
              deleteTrackStmt.run(lib.id, oldPath);
            }
          }

          db.prepare(`UPDATE libraries SET last_scanned_at = ? WHERE id = ?`).run(
            Date.now(),
            lib.id
          );
          continue;
        }

        const walkResult = walkedByLib.get(lib.id);
        if (!walkResult) continue;

        // Load existing tracks for this library to perform incremental check (size + mtime_ms)
        const existingTracks = db
          .prepare(
            `SELECT file_path, file_size, mtime_ms FROM tracks WHERE library_id = ?`
          )
          .all(lib.id) as Array<{
          file_path: string;
          file_size: number;
          mtime_ms: number;
        }>;

        const existingMap = new Map<string, { fileSize: number; mtimeMs: number }>();
        for (const row of existingTracks) {
          existingMap.set(row.file_path, {
            fileSize: Number(row.file_size),
            mtimeMs: Number(row.mtime_ms),
          });
        }

        const seenPaths = new Set<string>();
        const toProbe: typeof walkResult.candidates = [];

        for (const candidate of walkResult.candidates) {
          seenPaths.add(candidate.filePath);

          const existing = existingMap.get(candidate.filePath);
          if (
            existing &&
            existing.fileSize === candidate.fileSize &&
            existing.mtimeMs === candidate.mtimeMs
          ) {
            // Unchanged file: skip probing!
            this.progress.filesProcessed += 1;
            continue;
          }

          toProbe.push(candidate);
        }

        // Probe changed/new files concurrently in batches of 48 using in-process header parsing and commit each batch in a single SQLite transaction
        const PROBE_CONCURRENCY = 48;
        for (let i = 0; i < toProbe.length; i += PROBE_CONCURRENCY) {
          const batch = toProbe.slice(i, i + PROBE_CONCURRENCY);
          this.progress.currentFile = batch[0].filePath;

          const batchResults = await Promise.all(
            batch.map(async (candidate) => {
              try {
                const meta = await probeAudioFile(candidate.filePath, lib.path);
                const groupingArtist = meta.albumArtist || meta.artist;
                const albumId = hashId(
                  `${normalizeKey(groupingArtist)}::${normalizeKey(meta.album)}`
                );
                const trackId = hashId(candidate.filePath);

                const artFileName = await ensureAlbumCoverArt(
                  albumId,
                  candidate.filePath,
                  meta.hasEmbeddedArt,
                  meta.embeddedPictureData
                );

                return {
                  ok: true as const,
                  candidate,
                  meta,
                  groupingArtist,
                  albumId,
                  trackId,
                  artFileName,
                };
              } catch (err) {
                const reason =
                  err instanceof Error
                    ? err.message
                    : 'Corrupt or unreadable audio file';
                return {
                  ok: false as const,
                  candidate,
                  reason,
                };
              }
            })
          );

          db.exec('BEGIN IMMEDIATE');
          try {
            for (const res of batchResults) {
              if (res.ok) {
                const {
                  candidate,
                  meta,
                  groupingArtist,
                  albumId,
                  trackId,
                  artFileName,
                } = res;

                upsertAlbumStmt.run(
                  albumId,
                  meta.album,
                  groupingArtist,
                  meta.year,
                  artFileName
                );

                upsertTrackStmt.run(
                  trackId,
                  lib.id,
                  albumId,
                  candidate.filePath,
                  candidate.ext,
                  candidate.fileSize,
                  candidate.mtimeMs,
                  meta.title,
                  meta.artist,
                  meta.albumArtist,
                  meta.album,
                  meta.trackNumber,
                  meta.discNumber,
                  meta.year,
                  meta.originalYear,
                  meta.genre,
                  meta.bpm,
                  meta.mood,
                  meta.energyLevel,
                  meta.isReissueOrComp ? 1 : 0,
                  meta.gainDb ?? null,
                  meta.durationMs,
                  meta.tagsIncomplete ? 1 : 0,
                  JSON.stringify(meta.missingFields)
                );
              } else {
                unreadableFiles.push({
                  path: res.candidate.filePath,
                  reason: res.reason,
                });
              }
            }
            db.exec('COMMIT');
          } catch (txErr) {
            try {
              db.exec('ROLLBACK');
            } catch {
              // ignore rollback error
            }
            throw txErr;
          }

          this.progress.filesProcessed += batch.length;
        }

        // Remove tracks from this library that were deleted from disk
        const deleteTrackStmt = db.prepare(
          `DELETE FROM tracks WHERE library_id = ? AND file_path = ?`
        );
        for (const oldPath of existingMap.keys()) {
          if (!seenPaths.has(oldPath)) {
            deleteTrackStmt.run(lib.id, oldPath);
          }
        }

        db.prepare(`UPDATE libraries SET last_scanned_at = ? WHERE id = ?`).run(
          Date.now(),
          lib.id
        );
      }

      // Clean up orphaned albums that no longer have any tracks
      db.exec(`
        DELETE FROM albums
        WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks)
      `);

      this.invalidateCaches();

      // Compute final counts across enabled libraries
      const totals = this.getTotalsForEnabledLibraries();

      db.prepare(`
        UPDATE scan_runs
        SET finished_at = ?,
            status = 'completed',
            tracks_total = ?,
            albums_total = ?,
            artists_total = ?,
            tags_incomplete_count = ?,
            skipped_by_ext_json = ?,
            unreadable_files_json = ?
        WHERE id = ?
      `).run(
        Date.now(),
        totals.tracks,
        totals.albums,
        totals.artists,
        totals.tagsIncomplete,
        JSON.stringify(aggregatedSkippedByExt),
        JSON.stringify(unreadableFiles),
        runId
      );
    } catch (err) {
      db.prepare(`
        UPDATE scan_runs
        SET finished_at = ?,
            status = 'failed',
            skipped_by_ext_json = ?,
            unreadable_files_json = ?
        WHERE id = ?
      `).run(
        Date.now(),
        JSON.stringify(aggregatedSkippedByExt),
        JSON.stringify(unreadableFiles),
        runId
      );
      console.error('Scan error:', err);
    } finally {
      this.invalidateCaches();
      this.progress = {
        isScanning: false,
        currentLibrary: null,
        filesProcessed: this.progress.filesProcessed,
        filesTotal: this.progress.filesTotal,
        currentFile: null,
      };
    }
  }

  private getTotalsForEnabledLibraries(): {
    tracks: number;
    albums: number;
    artists: number;
    tagsIncomplete: number;
  } {
    const row = db
      .prepare(`
        SELECT
          COUNT(t.id) AS tracks,
          COUNT(DISTINCT t.album_id) AS albums,
          COUNT(DISTINCT lower(t.artist)) AS artists,
          SUM(CASE WHEN t.tags_incomplete = 1 THEN 1 ELSE 0 END) AS tags_incomplete
        FROM tracks t
        JOIN libraries l ON l.id = t.library_id
        WHERE l.enabled = 1
      `)
      .get() as {
      tracks: number;
      albums: number;
      artists: number;
      tags_incomplete: number | null;
    };

    return {
      tracks: Number(row?.tracks || 0),
      albums: Number(row?.albums || 0),
      artists: Number(row?.artists || 0),
      tagsIncomplete: Number(row?.tags_incomplete || 0),
    };
  }

  public getLatestScanRun(): ScanRunSummary | null {
    const row = db
      .prepare(`SELECT * FROM scan_runs ORDER BY id DESC LIMIT 1`)
      .get() as
      | {
          id: number;
          started_at: number;
          finished_at: number | null;
          status: 'running' | 'completed' | 'failed';
          tracks_total: number;
          albums_total: number;
          artists_total: number;
          tags_incomplete_count: number;
          skipped_by_ext_json: string;
          unreadable_files_json: string;
        }
      | undefined;

    if (!row) return null;

    return {
      id: Number(row.id),
      startedAt: Number(row.started_at),
      finishedAt: row.finished_at ? Number(row.finished_at) : null,
      status: row.status,
      tracksTotal: Number(row.tracks_total),
      albumsTotal: Number(row.albums_total),
      artistsTotal: Number(row.artists_total),
      tagsIncompleteCount: Number(row.tags_incomplete_count),
      skippedByExt: JSON.parse(row.skipped_by_ext_json || '{}'),
      unreadableFiles: JSON.parse(row.unreadable_files_json || '[]'),
    };
  }

  public getOverview(): ScanResultsOverview {
    const now = Date.now();
    // During an active scan, reuse the heavy SQL overview snapshot for up to 4 seconds
    // while still returning real-time progress on every poll. When idle, cache until invalidated.
    const cacheTtlMs = this.progress.isScanning ? 4000 : 60000;
    if (
      this.cachedOverviewData &&
      now - this.cachedOverviewTimeMs < cacheTtlMs
    ) {
      return {
        progress: this.getProgress(),
        ...this.cachedOverviewData,
      };
    }

    const libraries = this.getLibraries();
    const totals = this.getTotalsForEnabledLibraries();
    const latestRun = this.getLatestScanRun();

    // Artists summary in enabled libraries
    const artistRows = db
      .prepare(`
        SELECT
          t.artist AS name,
          COUNT(DISTINCT t.album_id) AS album_count,
          COUNT(t.id) AS track_count,
          GROUP_CONCAT(DISTINCT t.year) AS years_csv,
          GROUP_CONCAT(DISTINCT t.genre) AS genres_csv
        FROM tracks t
        JOIN libraries l ON l.id = t.library_id
        WHERE l.enabled = 1
        GROUP BY lower(t.artist)
        ORDER BY lower(t.artist) ASC
        LIMIT 250
      `)
      .all() as Array<{
      name: string;
      album_count: number;
      track_count: number;
      years_csv: string | null;
      genres_csv: string | null;
    }>;

    const artists: ArtistSummary[] = artistRows.map((r) => ({
      name: r.name,
      albumCount: Number(r.album_count),
      trackCount: Number(r.track_count),
      years: r.years_csv
        ? r.years_csv
            .split(',')
            .map((y) => parseInt(y, 10))
            .filter((n) => Number.isFinite(n))
            .sort((a, b) => a - b)
        : [],
      genres: r.genres_csv
        ? r.genres_csv
            .split(',')
            .map((g) => g.trim())
            .filter(Boolean)
        : [],
    }));

    // Albums summary in enabled libraries
    const albumRows = db
      .prepare(`
        SELECT
          a.id,
          a.title,
          a.artist,
          a.year,
          a.art_path,
          COUNT(t.id) AS track_count,
          SUM(t.duration_ms) AS duration_ms
        FROM albums a
        JOIN tracks t ON t.album_id = a.id
        JOIN libraries l ON l.id = t.library_id
        WHERE l.enabled = 1
        GROUP BY a.id
        ORDER BY lower(a.artist) ASC, COALESCE(a.year, 9999) ASC, lower(a.title) ASC
        LIMIT 250
      `)
      .all() as Array<{
      id: string;
      title: string;
      artist: string;
      year: number | null;
      art_path: string | null;
      track_count: number;
      duration_ms: number;
    }>;

    const albums: AlbumSummary[] = albumRows.map((r) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      year: r.year ? Number(r.year) : null,
      trackCount: Number(r.track_count),
      durationMs: Number(r.duration_ms || 0),
      hasArt: Boolean(r.art_path),
    }));

    // Tracks with incomplete tags
    const problemRows = db
      .prepare(`
        SELECT
          t.id,
          t.file_path,
          t.title,
          t.artist,
          t.album,
          t.missing_fields_json
        FROM tracks t
        JOIN libraries l ON l.id = t.library_id
        WHERE l.enabled = 1 AND t.tags_incomplete = 1
        ORDER BY t.file_path ASC
        LIMIT 100
      `)
      .all() as Array<{
      id: string;
      file_path: string;
      title: string;
      artist: string;
      album: string;
      missing_fields_json: string;
    }>;

    const tagProblemTracks: TagProblemTrack[] = problemRows.map((r) => ({
      id: r.id,
      filePath: r.file_path,
      title: r.title,
      artist: r.artist,
      album: r.album,
      missingFields: JSON.parse(r.missing_fields_json || '[]'),
    }));

    this.cachedOverviewData = {
      latestRun,
      libraries,
      totals,
      artists,
      albums,
      tagProblemTracks,
    };
    this.cachedOverviewTimeMs = now;

    return {
      progress: this.getProgress(),
      ...this.cachedOverviewData,
    };
  }
}

export const scannerService = new ScannerService();
