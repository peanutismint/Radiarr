import express from 'express';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import {
  NasConfig,
  PlayMode,
  RescanIntervalMinutes,
  ServerSettings,
} from '../../shared/types.ts';
import { MUSIC_DIR } from '../config.ts';
import { db } from '../db/index.ts';
import { scannerService } from '../scanner/ScannerService.ts';
import {
  createBackupPayload,
  deleteStoredBackup,
  getAutoBackupConfig,
  getStoredBackupPath,
  listStoredBackups,
  restoreBackupPayload,
  restoreStoredBackup,
  saveAutoBackupConfig,
  saveBackupToFile,
} from '../services/BackupService.ts';
import { requireAuth } from '../middleware/authMiddleware.ts';
import { authService } from '../services/AuthService.ts';

const execFileAsync = promisify(execFile);

const DEFAULT_NAS_CONFIG: NasConfig = {
  enabled: false,
  protocol: 'smb',
  host: process.env.RADIARR_NAS_HOST || '192.168.1.50',
  sharePath: 'Music',
  username: process.env.RADIARR_NAS_USER || 'admin',
  password: process.env.RADIARR_NAS_PASSWORD || '',
  domain: '',
  vers: '3.0',
};

const DEFAULT_SETTINGS: ServerSettings = {
  rescanIntervalMinutes: 0,
  defaultLibraryIds: [],
  defaultPlayMode: 'shuffle',
  defaultSmartUpdate: true,
  nasConfig: { ...DEFAULT_NAS_CONFIG },
};

let rescanTimer: ReturnType<typeof setInterval> | null = null;

export function getServerSettings(): ServerSettings {
  const row = db
    .prepare(`SELECT value_json FROM settings WHERE key = 'app_settings'`)
    .get() as { value_json: string } | undefined;

  if (!row) {
    return { ...DEFAULT_SETTINGS, nasConfig: { ...DEFAULT_NAS_CONFIG } };
  }

  try {
    const parsed = JSON.parse(row.value_json) as Partial<ServerSettings>;
    const rawNas = parsed.nasConfig;
    const nasConfig: NasConfig = {
      enabled: typeof rawNas?.enabled === 'boolean' ? rawNas.enabled : DEFAULT_NAS_CONFIG.enabled,
      protocol: rawNas?.protocol === 'nfs' ? 'nfs' : 'smb',
      host: typeof rawNas?.host === 'string' ? rawNas.host.trim() : DEFAULT_NAS_CONFIG.host,
      sharePath:
        typeof rawNas?.sharePath === 'string'
          ? rawNas.sharePath.trim().replace(/^\/+/, '')
          : DEFAULT_NAS_CONFIG.sharePath,
      username:
        typeof rawNas?.username === 'string' ? rawNas.username.trim() : DEFAULT_NAS_CONFIG.username,
      password:
        typeof rawNas?.password === 'string' ? rawNas.password : DEFAULT_NAS_CONFIG.password,
      domain:
        typeof rawNas?.domain === 'string' ? rawNas.domain.trim() : DEFAULT_NAS_CONFIG.domain,
      vers:
        rawNas?.vers === '2.0' || rawNas?.vers === '2.1' || rawNas?.vers === '3.0'
          ? rawNas.vers
          : '3.0',
    };

    return {
      rescanIntervalMinutes:
        typeof parsed.rescanIntervalMinutes === 'number'
          ? (parsed.rescanIntervalMinutes as RescanIntervalMinutes)
          : DEFAULT_SETTINGS.rescanIntervalMinutes,
      defaultLibraryIds: Array.isArray(parsed.defaultLibraryIds)
        ? parsed.defaultLibraryIds
        : DEFAULT_SETTINGS.defaultLibraryIds,
      defaultPlayMode:
        parsed.defaultPlayMode === 'straight' ||
        parsed.defaultPlayMode === 'album_shuffle' ||
        parsed.defaultPlayMode === 'shuffle'
          ? parsed.defaultPlayMode
          : DEFAULT_SETTINGS.defaultPlayMode,
      defaultSmartUpdate:
        typeof parsed.defaultSmartUpdate === 'boolean'
          ? parsed.defaultSmartUpdate
          : DEFAULT_SETTINGS.defaultSmartUpdate,
      nasConfig,
      plexConfig: parsed.plexConfig,
      forceTranscodeFlac: Boolean(parsed.forceTranscodeFlac),
      autoSkipUnplayable: parsed.autoSkipUnplayable !== false,
    };
  } catch {
    return { ...DEFAULT_SETTINGS, nasConfig: { ...DEFAULT_NAS_CONFIG } };
  }
}

export function applyScheduledRescanTimer(intervalMinutes: number): void {
  if (rescanTimer) {
    clearInterval(rescanTimer);
    rescanTimer = null;
  }

  if (intervalMinutes > 0) {
    const intervalMs = intervalMinutes * 60 * 1000;
    rescanTimer = setInterval(() => {
      void scannerService.triggerScan();
    }, intervalMs);
  }
}

export function saveServerSettings(patch: Partial<ServerSettings>): ServerSettings {
  const current = getServerSettings();
  const validIntervals = new Set([0, 60, 360, 720, 1440]);
  const validModes = new Set<PlayMode>(['straight', 'album_shuffle', 'shuffle']);

  const currentNas = current.nasConfig || { ...DEFAULT_NAS_CONFIG };
  const patchNas = patch.nasConfig;
  const nextNas: NasConfig = patchNas
    ? {
        enabled:
          typeof patchNas.enabled === 'boolean' ? patchNas.enabled : currentNas.enabled,
        protocol: patchNas.protocol === 'nfs' ? 'nfs' : 'smb',
        host:
          typeof patchNas.host === 'string' ? patchNas.host.trim() : currentNas.host,
        sharePath:
          typeof patchNas.sharePath === 'string'
            ? patchNas.sharePath.trim().replace(/^\/+/, '')
            : currentNas.sharePath,
        username:
          typeof patchNas.username === 'string'
            ? patchNas.username.trim()
            : currentNas.username,
        password:
          typeof patchNas.password === 'string'
            ? patchNas.password
            : currentNas.password,
        domain:
          typeof patchNas.domain === 'string'
            ? patchNas.domain.trim()
            : currentNas.domain,
        vers:
          patchNas.vers === '2.0' || patchNas.vers === '2.1' || patchNas.vers === '3.0'
            ? patchNas.vers
            : currentNas.vers || '3.0',
      }
    : currentNas;

  const nextPlex =
    patch.plexConfig !== undefined ? patch.plexConfig : current.plexConfig;

  const next: ServerSettings = {
    rescanIntervalMinutes:
      typeof patch.rescanIntervalMinutes === 'number' &&
      validIntervals.has(patch.rescanIntervalMinutes)
        ? (patch.rescanIntervalMinutes as RescanIntervalMinutes)
        : current.rescanIntervalMinutes,
    defaultLibraryIds: Array.isArray(patch.defaultLibraryIds)
      ? patch.defaultLibraryIds.filter((id) => typeof id === 'string')
      : current.defaultLibraryIds,
    defaultPlayMode:
      patch.defaultPlayMode && validModes.has(patch.defaultPlayMode)
        ? patch.defaultPlayMode
        : current.defaultPlayMode,
    defaultSmartUpdate:
      typeof patch.defaultSmartUpdate === 'boolean'
        ? patch.defaultSmartUpdate
        : current.defaultSmartUpdate ?? true,
    nasConfig: nextNas,
    plexConfig: nextPlex,
    forceTranscodeFlac:
      typeof patch.forceTranscodeFlac === 'boolean'
        ? patch.forceTranscodeFlac
        : current.forceTranscodeFlac ?? false,
    autoSkipUnplayable:
      typeof patch.autoSkipUnplayable === 'boolean'
        ? patch.autoSkipUnplayable
        : current.autoSkipUnplayable ?? true,
  };

  db.prepare(`
    INSERT INTO settings (key, value_json)
    VALUES ('app_settings', ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
  `).run(JSON.stringify(next));

  applyScheduledRescanTimer(next.rescanIntervalMinutes);
  return next;
}

export const settingsRouter = express.Router();

settingsRouter.get('/settings', (req, res) => {
  const settings = getServerSettings();
  if (authService.isAuthEnabled() && req.user?.role !== 'admin') {
    res.json({
      settings: {
        ...settings,
        nasConfig: {
          ...settings.nasConfig,
          password: '',
        },
      },
    });
    return;
  }
  res.json({ settings });
});

settingsRouter.put('/settings', requireAuth('admin'), (req, res) => {
  const body = req.body as Partial<ServerSettings>;
  const settings = saveServerSettings(body || {});
  res.json({ settings });
});

// Export full Radiarr backup (settings, stations, dismissed suggestions, libraries, albums, tracks, and latest scan summary)
settingsRouter.get('/backup/export', requireAuth('admin'), (_req, res) => {
  try {
    const backupPayload = createBackupPayload();
    const dateStamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="radiarr-backup-${dateStamp}.json"`
    );
    res.send(JSON.stringify(backupPayload, null, 2));
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to export backup',
    });
  }
});

// Restore full Radiarr backup from uploaded/dropped JSON
settingsRouter.post('/backup/restore', requireAuth('admin'), (req, res) => {
  try {
    const result = restoreBackupPayload(req.body);

    const updatedSettings = getServerSettings();
    applyScheduledRescanTimer(updatedSettings.rescanIntervalMinutes);
    scannerService.invalidateCaches();

    res.json({
      restored: true,
      counts: result.counts,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to restore backup',
    });
  }
});

// Get Auto-Backup Schedule & Configuration
settingsRouter.get('/backup/auto-config', requireAuth('admin'), (_req, res) => {
  try {
    const config = getAutoBackupConfig();
    res.json({ config });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to get auto backup config',
    });
  }
});

// Update Auto-Backup Schedule & Configuration
settingsRouter.post('/backup/auto-config', requireAuth('admin'), (req, res) => {
  try {
    const patch = req.body || {};
    const config = saveAutoBackupConfig(patch);
    res.json({ config });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to save auto backup config',
    });
  }
});

// List all stored backups on the server
settingsRouter.get('/backup/stored', requireAuth('admin'), (_req, res) => {
  try {
    const backups = listStoredBackups();
    res.json({ backups });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to list stored backups',
    });
  }
});

// Immediately trigger a snapshot backup saved to the server's backup folder
settingsRouter.post('/backup/create-now', requireAuth('admin'), (_req, res) => {
  try {
    const item = saveBackupToFile(false);
    res.json({ backup: item, message: 'Backup created successfully' });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to create backup',
    });
  }
});

// Download a specific stored backup file
settingsRouter.get('/backup/download/:filename', requireAuth('admin'), (req, res) => {
  try {
    const filename = req.params.filename;
    const fullPath = getStoredBackupPath(filename);
    res.download(fullPath, filename);
  } catch (err) {
    res.status(404).json({
      error: err instanceof Error ? err.message : 'Backup file not found',
    });
  }
});

// Restore directly from a stored backup on the server
settingsRouter.post('/backup/restore-stored/:filename', requireAuth('admin'), (req, res) => {
  try {
    const filename = req.params.filename;
    const result = restoreStoredBackup(filename);

    const updatedSettings = getServerSettings();
    applyScheduledRescanTimer(updatedSettings.rescanIntervalMinutes);
    scannerService.invalidateCaches();

    res.json({
      restored: true,
      filename,
      counts: result.counts,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to restore stored backup',
    });
  }
});

// Delete a stored backup file from the server
settingsRouter.delete('/backup/stored/:filename', requireAuth('admin'), (req, res) => {
  try {
    const filename = req.params.filename;
    deleteStoredBackup(filename);
    res.json({ success: true, deleted: filename });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to delete stored backup',
    });
  }
});

settingsRouter.post('/settings/nas-mount', requireAuth('admin'), async (req, res) => {
  const body = req.body as Partial<NasConfig> | undefined;
  const saved = getServerSettings().nasConfig;
  const cfg: NasConfig = {
    ...DEFAULT_NAS_CONFIG,
    ...saved,
    ...(body || {}),
  };

  if (!cfg.host || !cfg.sharePath) {
    res.status(400).json({
      mounted: false,
      message: 'Please provide both a NAS host/IP and share path.',
    });
    return;
  }

  try {
    fs.mkdirSync(MUSIC_DIR, { recursive: true });
    if (cfg.protocol === 'nfs') {
      const remote = `${cfg.host}:${cfg.sharePath.startsWith('/') ? cfg.sharePath : '/' + cfg.sharePath}`;
      await execFileAsync('mount', ['-t', 'nfs', '-o', 'ro,nolock', remote, MUSIC_DIR]);
    } else {
      const remote = `//${cfg.host}/${cfg.sharePath.replace(/^\/+/, '')}`;
      const opts = [
        `vers=${cfg.vers || '3.0'}`,
        'ro',
        'iocharset=utf8',
        cfg.username ? `username=${cfg.username}` : 'guest',
      ];
      if (cfg.password) {
        opts.push(`password=${cfg.password}`);
      }
      if (cfg.domain) {
        opts.push(`domain=${cfg.domain}`);
      }
      await execFileAsync('mount', ['-t', 'cifs', '-o', opts.join(','), remote, MUSIC_DIR]);
    }

    await scannerService.syncDiscoveredLibraries();
    void scannerService.triggerScan();

    res.json({
      mounted: true,
      message: `Successfully mounted ${cfg.host}/${cfg.sharePath} to ${MUSIC_DIR} and started scan.`,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    res.status(200).json({
      mounted: false,
      message: `Direct container mount not permitted in this environment (${errMsg.split('\n')[0]}). Use the generated Docker Compose CIFS volume snippet below on your Docker host.`,
    });
  }
});

