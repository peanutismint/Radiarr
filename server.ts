import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { CONFIG_DIR, MUSIC_DIR, SERVER_TZ } from './src/server/config.ts';
import { initDatabase } from './src/server/db/index.ts';
import { scheduleEngine } from './src/server/engine/ScheduleEngine.ts';
import { loadUserSession } from './src/server/middleware/authMiddleware.ts';
import { authRouter } from './src/server/routes/auth.ts';
import { librariesRouter } from './src/server/routes/libraries.ts';
import {
  applyScheduledRescanTimer,
   getServerSettings,
  settingsRouter,
} from './src/server/routes/settings.ts';
import { stationsRouter } from './src/server/routes/stations.ts';
import { diagnosticsRouter } from './src/server/routes/diagnostics.ts';
import { usersRouter } from './src/server/routes/users.ts';
import { ensureDemoLibraryIfEmpty } from './src/server/scanner/SampleLibrarySeeder.ts';
import { scannerService } from './src/server/scanner/ScannerService.ts';
import { applyAutoBackupScheduler } from './src/server/services/BackupService.ts';

const currentFile = fileURLToPath(import.meta.url);
const __dirname = path.dirname(currentFile);

async function startServer(customPort?: number) {
  // 1. Initialize SQLite schema in /config
  initDatabase();

  // 2. Ensure sample music folders exist if /music is empty in preview environment
  await ensureDemoLibraryIfEmpty();

  // 3. Discover immediate subfolders of /music (/music/albums, /music/singles, etc.)
  await scannerService.syncDiscoveredLibraries();

  // 4. Seed default starter stations if none exist yet
  scheduleEngine.seedDefaultStationsIfEmpty();

  // 5. Apply scheduled rescan timer from saved server settings
  const currentSettings = getServerSettings();
  applyScheduledRescanTimer(currentSettings.rescanIntervalMinutes);

  // 6. Initialize auto-backup scheduler from saved settings
  applyAutoBackupScheduler();

  // 7. Warm lookahead transcodes if tracks have already been scanned or restored
  if (scannerService.getLatestScanRun()) {
    scheduleEngine.warmLookaheadTranscodes();
  }

  const app = express();
  const PORT = customPort || Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '150mb' }));
  app.use(loadUserSession);

  // API routes
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api', librariesRouter);
  app.use('/api', stationsRouter);
  app.use('/api', settingsRouter);
  app.use('/api', diagnosticsRouter);

  // Vite middleware in development, static files in production
  if (process.env.NODE_ENV !== 'production' && !process.env.ELECTRON_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const possibleDistPaths = [
      path.join(process.cwd(), 'dist'),
      path.join(__dirname, 'dist'),
      path.join(__dirname, '..', 'dist'),
    ];
    const distPath = possibleDistPaths.find((p) => {
      try {
        return fs.existsSync(p) && fs.existsSync(path.join(p, 'index.html'));
      } catch {
        return false;
      }
    }) || possibleDistPaths[0];

    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return new Promise<{ app: express.Express; server: any; port: number }>((resolve) => {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(
        `Radiarr server listening on http://0.0.0.0:${PORT} (TZ=${SERVER_TZ}, music=${MUSIC_DIR}, config=${CONFIG_DIR})`
      );
      resolve({ app, server, port: PORT });
    });
  });
}

export { startServer };

if (!process.versions.electron && process.env.RADIARR_NO_AUTO_START !== 'true') {
  startServer().catch((err) => {
    console.error('Failed to start Radiarr server:', err);
    process.exit(1);
  });
}

