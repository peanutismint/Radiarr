import fs from 'node:fs';
import path from 'node:path';
import {
  AutoBackupConfig,
  AutoBackupUnit,
  StoredBackupItem,
} from '../../shared/types.ts';
import { BACKUPS_DIR } from '../config.ts';
import { db } from '../db/index.ts';

const DEFAULT_AUTO_BACKUP_CONFIG: AutoBackupConfig = {
  enabled: false,
  intervalValue: 6,
  intervalUnit: 'hours',
  maxBackupsToKeep: 5,
  lastBackupAt: null,
  lastBackupFilename: null,
  nextBackupAt: null,
};

let autoBackupTimer: ReturnType<typeof setInterval> | null = null;

function sanitizeFilename(filename: string): string {
  const base = path.basename(filename);
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(base)) {
    throw new Error('Invalid filename');
  }
  return base;
}

export function computeIntervalMs(value: number, unit: AutoBackupUnit): number {
  const safeVal = Math.max(1, value);
  switch (unit) {
    case 'minutes':
      return safeVal * 60 * 1000;
    case 'hours':
      return safeVal * 60 * 60 * 1000;
    case 'days':
      return safeVal * 24 * 60 * 60 * 1000;
    default:
      return safeVal * 60 * 60 * 1000;
  }
}

export function getAutoBackupConfig(): AutoBackupConfig {
  try {
    const row = db
      .prepare(`SELECT value_json FROM settings WHERE key = 'auto_backup_config'`)
      .get() as { value_json: string } | undefined;

    if (!row) {
      return { ...DEFAULT_AUTO_BACKUP_CONFIG };
    }

    const parsed = JSON.parse(row.value_json) as Partial<AutoBackupConfig>;
    const unit: AutoBackupUnit =
      parsed.intervalUnit === 'minutes' ||
      parsed.intervalUnit === 'hours' ||
      parsed.intervalUnit === 'days'
        ? parsed.intervalUnit
        : DEFAULT_AUTO_BACKUP_CONFIG.intervalUnit;

    const intervalValue =
      typeof parsed.intervalValue === 'number' && parsed.intervalValue > 0
        ? Math.round(parsed.intervalValue)
        : DEFAULT_AUTO_BACKUP_CONFIG.intervalValue;

    const maxBackupsToKeep =
      typeof parsed.maxBackupsToKeep === 'number' && parsed.maxBackupsToKeep > 0
        ? Math.min(100, Math.round(parsed.maxBackupsToKeep))
        : DEFAULT_AUTO_BACKUP_CONFIG.maxBackupsToKeep;

    const enabled = Boolean(parsed.enabled);
    const lastBackupAt =
      typeof parsed.lastBackupAt === 'number' ? parsed.lastBackupAt : null;
    const lastBackupFilename =
      typeof parsed.lastBackupFilename === 'string' ? parsed.lastBackupFilename : null;

    let nextBackupAt: number | null = null;
    if (enabled) {
      const intervalMs = computeIntervalMs(intervalValue, unit);
      if (lastBackupAt) {
        const next = lastBackupAt + intervalMs;
        nextBackupAt = next > Date.now() ? next : Date.now() + intervalMs;
      } else {
        nextBackupAt = Date.now() + intervalMs;
      }
    }

    return {
      enabled,
      intervalValue,
      intervalUnit: unit,
      maxBackupsToKeep,
      lastBackupAt,
      lastBackupFilename,
      nextBackupAt,
    };
  } catch {
    return { ...DEFAULT_AUTO_BACKUP_CONFIG };
  }
}

export function saveAutoBackupConfig(
  patch: Partial<AutoBackupConfig>
): AutoBackupConfig {
  const current = getAutoBackupConfig();
  const next: AutoBackupConfig = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    intervalValue:
      typeof patch.intervalValue === 'number' && patch.intervalValue > 0
        ? Math.round(patch.intervalValue)
        : current.intervalValue,
    intervalUnit:
      patch.intervalUnit === 'minutes' ||
      patch.intervalUnit === 'hours' ||
      patch.intervalUnit === 'days'
        ? patch.intervalUnit
        : current.intervalUnit,
    maxBackupsToKeep:
      typeof patch.maxBackupsToKeep === 'number' && patch.maxBackupsToKeep > 0
        ? Math.min(100, Math.round(patch.maxBackupsToKeep))
        : current.maxBackupsToKeep,
    lastBackupAt:
      patch.lastBackupAt !== undefined ? patch.lastBackupAt : current.lastBackupAt,
    lastBackupFilename:
      patch.lastBackupFilename !== undefined
        ? patch.lastBackupFilename
        : current.lastBackupFilename,
    nextBackupAt: null,
  };

  if (next.enabled) {
    const intervalMs = computeIntervalMs(next.intervalValue, next.intervalUnit);
    if (next.lastBackupAt) {
      const expectedNext = next.lastBackupAt + intervalMs;
      next.nextBackupAt =
        expectedNext > Date.now() ? expectedNext : Date.now() + intervalMs;
    } else {
      next.nextBackupAt = Date.now() + intervalMs;
    }
  }

  const jsonStr = JSON.stringify(next);
  db.prepare(`
    INSERT INTO settings (key, value_json)
    VALUES ('auto_backup_config', ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
  `).run(jsonStr);

  applyAutoBackupScheduler();
  return getAutoBackupConfig();
}

export function createBackupPayload() {
  const settingsRows = db.prepare(`SELECT * FROM settings`).all();
  const usersRows = db.prepare(`SELECT * FROM users`).all();
  const librariesRows = db.prepare(`SELECT * FROM libraries`).all();
  const albumsRows = db.prepare(`SELECT * FROM albums`).all();
  const tracksRows = db.prepare(`SELECT * FROM tracks`).all();
  const stationsRows = db
    .prepare(`SELECT * FROM stations ORDER BY channel_number ASC`)
    .all();
  const dismissedRows = db.prepare(`SELECT * FROM dismissed_suggestions`).all();
  const scanRunsRows = db
    .prepare(`SELECT * FROM scan_runs ORDER BY id DESC LIMIT 5`)
    .all();

  return {
    app: 'radiarr',
    backupVersion: 1,
    exportedAt: Date.now(),
    counts: {
      libraries: librariesRows.length,
      albums: albumsRows.length,
      tracks: tracksRows.length,
      stations: stationsRows.length,
      users: usersRows.length,
    },
    data: {
      settings: settingsRows,
      users: usersRows,
      libraries: librariesRows,
      albums: albumsRows,
      tracks: tracksRows,
      stations: stationsRows,
      dismissed_suggestions: dismissedRows,
      scan_runs: scanRunsRows,
    },
  };
}

export function pruneOldBackups(maxAutoToKeep: number): void {
  try {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    const files = fs.readdirSync(BACKUPS_DIR);
    const autoFiles: Array<{ filename: string; mtimeMs: number }> = [];

    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      if (f.startsWith('radiarr-autobackup-')) {
        const fullPath = path.join(BACKUPS_DIR, f);
        try {
          const stat = fs.statSync(fullPath);
          autoFiles.push({ filename: f, mtimeMs: stat.mtimeMs });
        } catch {
          // ignore
        }
      }
    }

    // Sort newest first
    autoFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

    // If more than maxAutoToKeep, remove the excess older ones
    if (autoFiles.length > maxAutoToKeep) {
      const toDelete = autoFiles.slice(maxAutoToKeep);
      for (const item of toDelete) {
        try {
          fs.unlinkSync(path.join(BACKUPS_DIR, item.filename));
        } catch (e) {
          console.warn('Failed to prune old backup:', item.filename, e);
        }
      }
    }
  } catch (err) {
    console.error('Error during auto-backup pruning:', err);
  }
}

export function saveBackupToFile(isAuto = false): StoredBackupItem {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const payload = createBackupPayload();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  const prefix = isAuto ? 'radiarr-autobackup' : 'radiarr-backup';
  const filename = `${prefix}-${dateStr}.json`;
  const filePath = path.join(BACKUPS_DIR, filename);

  const jsonContent = JSON.stringify(payload, null, 2);
  fs.writeFileSync(filePath, jsonContent, 'utf-8');

  const stat = fs.statSync(filePath);

  const config = getAutoBackupConfig();
  if (isAuto) {
    saveAutoBackupConfig({
      lastBackupAt: Date.now(),
      lastBackupFilename: filename,
    });
    pruneOldBackups(config.maxBackupsToKeep);
  } else {
    // Also prune if we have strict limits
    pruneOldBackups(config.maxBackupsToKeep);
  }

  return {
    filename,
    sizeBytes: stat.size,
    createdAt: Date.now(),
    isAuto,
    counts: payload.counts,
  };
}

export function listStoredBackups(): StoredBackupItem[] {
  try {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    const files = fs.readdirSync(BACKUPS_DIR);
    const items: StoredBackupItem[] = [];

    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const fullPath = path.join(BACKUPS_DIR, f);
      try {
        const stat = fs.statSync(fullPath);
        let counts = undefined;
        try {
          const sample = fs.readFileSync(fullPath, 'utf-8');
          const parsed = JSON.parse(sample) as { counts?: StoredBackupItem['counts'] };
          if (parsed && typeof parsed.counts === 'object') {
            counts = parsed.counts;
          }
        } catch {
          // ignore JSON parsing issue for counts
        }

        items.push({
          filename: f,
          sizeBytes: stat.size,
          createdAt: stat.mtimeMs,
          isAuto: f.startsWith('radiarr-autobackup-'),
          counts,
        });
      } catch {
        // ignore single unreadable file
      }
    }

    // Sort newest first
    items.sort((a, b) => b.createdAt - a.createdAt);
    return items;
  } catch {
    return [];
  }
}

export function getStoredBackupPath(filename: string): string {
  const safe = sanitizeFilename(filename);
  const fullPath = path.join(BACKUPS_DIR, safe);
  if (!fs.existsSync(fullPath)) {
    throw new Error('Backup file not found');
  }
  return fullPath;
}

export function deleteStoredBackup(filename: string): void {
  const fullPath = getStoredBackupPath(filename);
  fs.unlinkSync(fullPath);
}

export function restoreBackupPayload(body: any): { counts: any } {
  if (!body || typeof body !== 'object' || !body.data) {
    throw new Error('Invalid backup file format. Expected a Radiarr JSON backup.');
  }

  const {
    settings = [],
    users = [],
    libraries = [],
    albums = [],
    tracks = [],
    stations = [],
    dismissed_suggestions = [],
    scan_runs = [],
  } = body.data;

  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN IMMEDIATE;');

  try {
    if (Array.isArray(settings) && settings.length > 0) {
      db.exec(`DELETE FROM settings WHERE key != 'auto_backup_config';`);
      const insSetting = db.prepare(
        `INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
      );
      for (const s of settings) {
        if (s && typeof s.key === 'string' && typeof s.value_json === 'string') {
          // Do not overwrite auto_backup_config if user has configured custom automated schedule
          if (s.key === 'auto_backup_config') continue;
          insSetting.run(s.key, s.value_json);
        }
      }
    }

    if (Array.isArray(users) && users.length > 0) {
      db.exec(`DELETE FROM users;`);
      const insUser = db.prepare(`
        INSERT INTO users (id, username, password_hash, salt, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const u of users) {
        if (u && u.id && u.username && u.password_hash) {
          insUser.run(
            u.id,
            u.username,
            u.password_hash,
            u.salt || '',
            u.role || 'listener',
            u.created_at || Date.now(),
            u.updated_at || Date.now()
          );
        }
      }
    }

    if (Array.isArray(libraries)) {
      db.exec(`DELETE FROM libraries;`);
      const insLib = db.prepare(`
        INSERT INTO libraries (id, name, source_type, path, enabled, last_scanned_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const l of libraries) {
        insLib.run(
          l.id,
          l.name,
          l.source_type || 'local',
          l.path,
          typeof l.enabled === 'number' ? l.enabled : 1,
          l.last_scanned_at ?? null
        );
      }
    }

    if (Array.isArray(albums)) {
      db.exec(`DELETE FROM albums;`);
      const insAlbum = db.prepare(`
        INSERT INTO albums (id, title, artist, year, art_path)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const a of albums) {
        insAlbum.run(
          a.id,
          a.title,
          a.artist,
          a.year ?? null,
          a.art_path ?? null
        );
      }
    }

    if (Array.isArray(tracks)) {
      db.exec(`DELETE FROM tracks;`);
      const insTrack = db.prepare(`
        INSERT INTO tracks (
          id, library_id, album_id, file_path, ext, file_size, mtime_ms,
          title, artist, album_artist, album, track_number, disc_number,
          year, genre, duration_ms, tags_incomplete, missing_fields_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const t of tracks) {
        insTrack.run(
          t.id,
          t.library_id,
          t.album_id,
          t.file_path,
          t.ext,
          t.file_size,
          t.mtime_ms,
          t.title,
          t.artist,
          t.album_artist ?? null,
          t.album,
          t.track_number ?? 1,
          t.disc_number ?? 1,
          t.year ?? null,
          t.genre ?? null,
          t.duration_ms,
          t.tags_incomplete ?? 0,
          t.missing_fields_json || '[]'
        );
      }
    }

    if (Array.isArray(stations)) {
      db.exec(`DELETE FROM station_checkpoints;`);
      db.exec(`DELETE FROM stations;`);
      const insStation = db.prepare(`
        INSERT INTO stations (
          id, name, channel_number, enabled, play_mode, rules_json,
          dayparts_enabled, dayparts_json, tile_color, seed, epoch_ms,
          revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const st of stations) {
        insStation.run(
          st.id,
          st.name,
          st.channel_number,
          typeof st.enabled === 'number' ? st.enabled : 1,
          st.play_mode,
          st.rules_json || '{}',
          st.dayparts_enabled ?? 0,
          st.dayparts_json || '[]',
          st.tile_color || '#4f46e5',
          st.seed,
          st.epoch_ms,
          st.revision ?? 1,
          st.created_at ?? Date.now(),
          st.updated_at ?? Date.now()
        );
      }
    }

    if (Array.isArray(dismissed_suggestions)) {
      db.exec(`DELETE FROM dismissed_suggestions;`);
      const insDismissed = db.prepare(`
        INSERT INTO dismissed_suggestions (suggestion_key, dismissed_at)
        VALUES (?, ?)
      `);
      for (const d of dismissed_suggestions) {
        insDismissed.run(d.suggestion_key, d.dismissed_at);
      }
    }

    if (Array.isArray(scan_runs)) {
      db.exec(`DELETE FROM scan_runs;`);
      const insScan = db.prepare(`
        INSERT INTO scan_runs (
          started_at, finished_at, status, tracks_total,
          albums_total, artists_total, tags_incomplete_count,
          skipped_by_ext_json, unreadable_files_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const sr of scan_runs) {
        insScan.run(
          sr.started_at,
          sr.finished_at ?? null,
          sr.status,
          sr.tracks_total ?? 0,
          sr.albums_total ?? 0,
          sr.artists_total ?? 0,
          sr.tags_incomplete_count ?? 0,
          sr.skipped_by_ext_json || '{}',
          sr.unreadable_files_json || '[]'
        );
      }
    } else if (tracks.length > 0) {
      db.prepare(`
        INSERT INTO scan_runs (
          started_at, finished_at, status, tracks_total, albums_total,
          artists_total, tags_incomplete_count, skipped_by_ext_json, unreadable_files_json
        ) VALUES (?, ?, 'completed', ?, ?, 0, 0, '{}', '[]')
      `).run(Date.now(), Date.now(), tracks.length, albums.length);
    }

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }

  return {
    counts: {
      settings: settings.length,
      libraries: libraries.length,
      albums: albums.length,
      tracks: tracks.length,
      stations: stations.length,
    },
  };
}

export function restoreStoredBackup(filename: string) {
  const fullPath = getStoredBackupPath(filename);
  const raw = fs.readFileSync(fullPath, 'utf-8');
  const payload = JSON.parse(raw);
  return restoreBackupPayload(payload);
}

export function applyAutoBackupScheduler(): void {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }

  const config = getAutoBackupConfig();
  if (!config.enabled) {
    return;
  }

  const intervalMs = computeIntervalMs(config.intervalValue, config.intervalUnit);
  autoBackupTimer = setInterval(() => {
    try {
      console.log(
        `[AutoBackup] Executing scheduled backup (interval=${config.intervalValue} ${config.intervalUnit}, maxKept=${config.maxBackupsToKeep})`
      );
      saveBackupToFile(true);
    } catch (err) {
      console.error('[AutoBackup] Error executing scheduled backup:', err);
    }
  }, intervalMs);

  if (typeof autoBackupTimer.unref === 'function') {
    autoBackupTimer.unref();
  }
}

export function stopAutoBackupScheduler(): void {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }
}
