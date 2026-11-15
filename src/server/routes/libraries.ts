import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { PlexRemoteSection, PlexServerDevice } from '../../shared/types.ts';
import { ART_CACHE_DIR, MUSIC_DIR } from '../config.ts';
import { db } from '../db/index.ts';
import { scannerService } from '../scanner/ScannerService.ts';
import {
  checkPlexAuthPin,
  createPlexAuthPin,
  discoverPlexServers,
  ensurePlexClientId,
  fetchPlexMusicSections,
  findBestServerConnectionUri,
  resolvePlexArtUrl,
} from '../sources/PlexService.ts';
import { requireAuth } from '../middleware/authMiddleware.ts';
import { getServerSettings, saveServerSettings } from './settings.ts';

export const librariesRouter = express.Router();

librariesRouter.get('/libraries', async (_req, res) => {
  try {
    const libraries = await scannerService.syncDiscoveredLibraries();
    res.json({ libraries });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to list libraries',
    });
  }
});

librariesRouter.post('/libraries', requireAuth('admin'), (req, res) => {
  const { name, path: folderPath } = req.body as {
    name?: string;
    path?: string;
  };

  if (!folderPath || typeof folderPath !== 'string' || !folderPath.trim()) {
    res.status(400).json({ error: 'Library folder path is required.' });
    return;
  }

  try {
    const library = scannerService.addCustomLibrary(name || '', folderPath);
    res.status(201).json({ library });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to add library',
    });
  }
});

librariesRouter.delete('/libraries/:id', requireAuth('admin'), (req, res) => {
  const { id } = req.params;
  const removed = scannerService.removeLibrary(id);
  if (!removed) {
    res.status(404).json({ error: `Library "${id}" not found.` });
    return;
  }
  res.json({ removed: true });
});

librariesRouter.patch('/libraries/:id', requireAuth('admin'), (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body as { enabled?: boolean };

  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'Field "enabled" (boolean) is required.' });
    return;
  }

  const updated = scannerService.setLibraryEnabled(id, enabled);
  if (!updated) {
    res.status(404).json({ error: `Library "${id}" not found.` });
    return;
  }

  res.json({ library: updated });
});

librariesRouter.post('/scan', requireAuth('admin'), async (req, res) => {
  const { libraryId } = (req.body || {}) as { libraryId?: string };
  const result = await scannerService.triggerScan(
    typeof libraryId === 'string' && libraryId.trim() ? libraryId.trim() : undefined
  );
  res.json(result);
});

librariesRouter.get('/scan/status', (_req, res) => {
  const overview = scannerService.getOverview();
  res.json(overview);
});

/**
 * Raw binary file upload endpoint so users can upload test audio files or folders
 * (e.g., into /music/albums or /music/singles) directly inside the AI Studio preview environment.
 */
librariesRouter.post(
  '/libraries/upload',
  requireAuth('admin'),
  express.raw({ type: '*/*', limit: '200mb' }),
  async (req, res) => {
    try {
      const targetLibrary = String(req.query.library || 'singles')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .toLowerCase() || 'singles';
      const rawRelPath = String(req.query.relativePath || 'track.mp3');

      // Sanitize path segments to prevent directory traversal
      const safeSegments = rawRelPath
        .split(/[\\/]/)
        .map((seg) => seg.trim())
        .filter((seg) => seg.length > 0 && seg !== '.' && seg !== '..');

      if (safeSegments.length === 0) {
        res.status(400).json({ error: 'Invalid file path' });
        return;
      }

      // If the user selected a folder named "albums" or "singles", avoid duplicating the top folder name
      if (
        safeSegments.length > 1 &&
        safeSegments[0].toLowerCase() === targetLibrary
      ) {
        safeSegments.shift();
      }

      const destPath = path.join(MUSIC_DIR, targetLibrary, ...safeSegments);
      const resolvedDest = path.resolve(destPath);
      const resolvedMusicRoot = path.resolve(MUSIC_DIR);

      if (!resolvedDest.startsWith(resolvedMusicRoot)) {
        res.status(403).json({ error: 'Path traversal not allowed' });
        return;
      }

      await fs.promises.mkdir(path.dirname(resolvedDest), { recursive: true });
      const bodyBuffer = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(req.body || '');
      await fs.promises.writeFile(resolvedDest, bodyBuffer);

      res.json({
        saved: true,
        library: targetLibrary,
        path: resolvedDest,
        bytes: bodyBuffer.length,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Upload failed',
      });
    }
  }
);

librariesRouter.get('/art/:albumId', async (req, res) => {
  const { albumId } = req.params;
  const row = db
    .prepare(`SELECT art_path FROM albums WHERE id = ?`)
    .get(albumId) as { art_path: string | null } | undefined;

  if (!row || !row.art_path) {
    res.status(404).end();
    return;
  }

  if (row.art_path.startsWith('plex://')) {
    const plexArtUrl = resolvePlexArtUrl(row.art_path);
    if (!plexArtUrl) {
      res.status(404).end();
      return;
    }

    try {
      const upstream = await fetch(plexArtUrl);
      if (!upstream.ok || !upstream.body) {
        res.status(404).end();
        return;
      }
      res.setHeader(
        'Content-Type',
        upstream.headers.get('content-type') || 'image/jpeg'
      );
      res.setHeader('Cache-Control', 'public, max-age=86400');
      Readable.fromWeb(upstream.body as unknown as WebReadableStream).pipe(res);
      return;
    } catch {
      res.status(404).end();
      return;
    }
  }

  const fullArtPath = path.join(ART_CACHE_DIR, path.basename(row.art_path));
  if (!fs.existsSync(fullArtPath)) {
    res.status(404).end();
    return;
  }

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(fullArtPath).pipe(res);
});

librariesRouter.get('/art/artist/:artistName', async (req, res) => {
  const { artistName } = req.params;
  if (!artistName || !artistName.trim()) {
    res.status(404).end();
    return;
  }

  const row = db
    .prepare(`SELECT art_path FROM artists WHERE LOWER(name) = LOWER(?)`)
    .get(artistName.trim()) as { art_path: string | null } | undefined;

  if (!row || !row.art_path) {
    res.status(404).end();
    return;
  }

  if (row.art_path.startsWith('plex://')) {
    const plexArtUrl = resolvePlexArtUrl(row.art_path);
    if (!plexArtUrl) {
      res.status(404).end();
      return;
    }

    try {
      const upstream = await fetch(plexArtUrl);
      if (!upstream.ok || !upstream.body) {
        res.status(404).end();
        return;
      }
      res.setHeader(
        'Content-Type',
        upstream.headers.get('content-type') || 'image/jpeg'
      );
      res.setHeader('Cache-Control', 'public, max-age=86400');
      Readable.fromWeb(upstream.body as unknown as WebReadableStream).pipe(res);
      return;
    } catch {
      res.status(404).end();
      return;
    }
  }

  const fullArtPath = path.isAbsolute(row.art_path)
    ? row.art_path
    : path.join(ART_CACHE_DIR, path.basename(row.art_path));

  if (!fs.existsSync(fullArtPath)) {
    res.status(404).end();
    return;
  }

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(fullArtPath).pipe(res);
});


/**
 * Plex Integration Endpoints (Strong OAuth PIN flow without 4-digit PIN entry,
 * Server Discovery, Music Section Selection, and Hybrid Local+Plex Libraries)
 */
librariesRouter.post('/plex/auth/pin', async (req, res) => {
  try {
    const { forwardUrl } = (req.body || {}) as { forwardUrl?: string };
    const pin = await createPlexAuthPin(forwardUrl);
    res.json(pin);
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error ? err.message : 'Failed to start Plex authentication',
    });
  }
});

// Callback handler for popup forwardUrl (sends postMessage and closes popup)
librariesRouter.get(['/plex/auth/callback', '/plex/auth/callback/'], (_req, res) => {
  res.send(`<!DOCTYPE html>
<html>
  <head><title>Plex Connected</title></head>
  <body style="font-family: system-ui, sans-serif; background: #18181b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'plex' }, '*');
        window.close();
      } else {
        window.location.href = '/';
      }
    </script>
    <p>Plex authentication completed. This window will close automatically...</p>
  </body>
</html>`);
});

librariesRouter.get('/plex/auth/pin/:pinId', async (req, res) => {
  try {
    const pinId = Number(req.params.pinId);
    const code =
      typeof req.query.code === 'string' ? req.query.code : undefined;
    const status = await checkPlexAuthPin(pinId, code);
    res.json(status);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to check Plex PIN',
    });
  }
});

librariesRouter.get('/plex/status', async (_req, res) => {
  const plexConfig = getServerSettings().plexConfig;
  if (!plexConfig?.authToken) {
    res.json({
      connected: false,
      plexConfig: null,
      servers: [],
      sections: [],
    });
    return;
  }

  let servers: PlexServerDevice[] = [];
  let sections: PlexRemoteSection[] = [];
  let serverError: string | null = null;

  try {
    servers = await discoverPlexServers();
  } catch (err) {
    serverError =
      err instanceof Error ? err.message : 'Failed to discover Plex servers';
  }

  if (plexConfig.serverUri) {
    try {
      const existingLibs = scannerService.getLibraries();
      sections = await fetchPlexMusicSections(existingLibs);
    } catch (err) {
      serverError =
        err instanceof Error
          ? `Could not reach Plex server at ${plexConfig.serverUri}: ${err.message}`
          : `Could not reach Plex server at ${plexConfig.serverUri}`;
    }
  }

  res.json({
    connected: true,
    plexConfig,
    servers,
    sections,
    serverError,
  });
});

librariesRouter.post('/plex/server', requireAuth('admin'), async (req, res) => {
  const { clientIdentifier, customUri } = (req.body || {}) as {
    clientIdentifier?: string;
    customUri?: string;
  };

  const settings = getServerSettings();
  const currentPlex = settings.plexConfig;
  if (!currentPlex?.authToken) {
    res.status(400).json({ error: 'Not signed in to Plex.' });
    return;
  }

  try {
    const servers = await discoverPlexServers();
    const matched = clientIdentifier
      ? servers.find((s) => s.clientIdentifier === clientIdentifier)
      : servers[0];

    let nextUri = customUri ? customUri.trim().replace(/\/+$/, '') : '';
    if (!nextUri && matched) {
      nextUri = await findBestServerConnectionUri(matched);
    }

    const nextPlex = {
      ...currentPlex,
      clientId: ensurePlexClientId(),
      serverName: matched?.name || currentPlex.serverName || 'Plex Server',
      serverMachineId:
        matched?.clientIdentifier || currentPlex.serverMachineId || 'server',
      serverUri: nextUri || currentPlex.serverUri,
      serverAccessToken:
        matched?.accessToken || currentPlex.serverAccessToken || currentPlex.authToken,
    };

    saveServerSettings({ plexConfig: nextPlex });

    const existingLibs = scannerService.getLibraries();
    const sections = await fetchPlexMusicSections(existingLibs);

    res.json({
      plexConfig: nextPlex,
      sections,
    });
  } catch (err) {
    res.status(400).json({
      error:
        err instanceof Error
          ? err.message
          : 'Failed to connect to selected Plex server',
    });
  }
});

librariesRouter.post('/plex/libraries', requireAuth('admin'), (req, res) => {
  const { sectionKey, title } = (req.body || {}) as {
    sectionKey?: string;
    title?: string;
  };

  if (!sectionKey || typeof sectionKey !== 'string') {
    res.status(400).json({ error: 'Plex library sectionKey is required.' });
    return;
  }

  const plexConfig = getServerSettings().plexConfig;
  const machineId = plexConfig?.serverMachineId || 'server';
  const library = scannerService.addPlexLibrary(
    sectionKey,
    title || `Plex Library ${sectionKey}`,
    machineId
  );

  res.status(201).json({ library });
});

librariesRouter.post('/plex/disconnect', requireAuth('admin'), (_req, res) => {
  const current = getServerSettings();
  saveServerSettings({
    plexConfig: {
      clientId: current.plexConfig?.clientId || ensurePlexClientId(),
    },
  });
  res.json({ disconnected: true });
});

