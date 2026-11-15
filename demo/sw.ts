// Radiarr browser demo: a service worker that plays the part of the Radiarr server.
//
// It runs Radiarr's real server code (scheduling engine, station rules, guide, settings) against an
// in-browser SQLite database holding a fictional music library. Requests from the web UI to /api/*
// are answered here instead of by a server, so the demo can be hosted on GitHub Pages.
//
// Anything that needs a real server (Plex, scanning folders, FFmpeg, backups, user accounts) is
// politely refused. Visitors' changes are saved in their own browser only.

import './shims/globals.ts';
import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
import type { SqlJsStatic } from 'sql.js';
import { setActiveDatabase, getActiveDatabase } from './shims/sqlite.ts';
import { ExpressRouter, DemoResponse, type DemoRequest, type Handler } from './shims/express.ts';

import { initDatabase, backfillTrackMetadataAndEnergy } from '../src/server/db/index.ts';
import { loadUserSession } from '../src/server/middleware/authMiddleware.ts';
import { authRouter } from '../src/server/routes/auth.ts';
import { librariesRouter } from '../src/server/routes/libraries.ts';
import { stationsRouter } from '../src/server/routes/stations.ts';
import { settingsRouter } from '../src/server/routes/settings.ts';
import { diagnosticsRouter } from '../src/server/routes/diagnostics.ts';
import { usersRouter } from '../src/server/routes/users.ts';
import { restoreBackupPayload } from '../src/server/services/BackupService.ts';
import { scheduleEngine } from '../src/server/engine/ScheduleEngine.ts';
import { scannerService } from '../src/server/scanner/ScannerService.ts';

import { buildCatalog, DEMO_STATIONS, type DemoAlbum } from './catalog.ts';
import { synthesizeTrackResponse } from './audio.ts';
import { albumCoverSvg, artistPhotoSvg } from './art.ts';

// Minimal service worker typings (the project's TypeScript setup targets web pages, not workers).
interface ExtendableEvent extends Event { waitUntil(p: Promise<unknown>): void }
interface FetchEvent extends ExtendableEvent { request: Request; respondWith(r: Promise<Response> | Response): void }
interface ExtendableMessageEvent extends ExtendableEvent { data: unknown }
declare const self: {
  location: Location;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: 'install', fn: (e: ExtendableEvent) => void): void;
  addEventListener(type: 'activate', fn: (e: ExtendableEvent) => void): void;
  addEventListener(type: 'message', fn: (e: ExtendableMessageEvent) => void): void;
  addEventListener(type: 'fetch', fn: (e: FetchEvent) => void): void;
};

// Bump when the catalogue or starter stations change, so returning visitors get the new library.
const DEMO_DATA_VERSION = 'demo-v1';

const catalog = buildCatalog();
const albumsById = new Map(catalog.albums.map((a) => [a.id, a]));
const albumsByArtist = new Map<string, DemoAlbum>();
for (const a of catalog.albums) if (!albumsByArtist.has(a.artist)) albumsByArtist.set(a.artist, a);
const trackDurations = new Map(catalog.tracks.map((t) => [t.id, t.durationMs]));

// Scanning would find no files in the browser and remove the whole library, so never run it.
(scannerService as unknown as { triggerScan: () => Promise<unknown> }).triggerScan = async () => ({
  started: false,
  message: 'Scanning is not available in the demo.',
});

// ---------------------------------------------------------------------------
// Saving the visitor's database between visits (IndexedDB)
// ---------------------------------------------------------------------------

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('radiarr-demo', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv').objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function persist(): Promise<void> {
  try {
    await idbSet('db', getActiveDatabase().export());
    await idbSet('version', DEMO_DATA_VERSION);
  } catch (err) {
    console.warn('[demo] could not save changes', err);
  }
}

// ---------------------------------------------------------------------------
// Creating the fictional library
// ---------------------------------------------------------------------------

function seedLibrary(): void {
  initDatabase();
  const now = Date.now();
  restoreBackupPayload({
    data: {
      libraries: [{ id: 'demo-library', name: 'Demo Library', source_type: 'local', path: '/demo/music', enabled: 1, last_scanned_at: now }],
      albums: catalog.albums.map((a) => ({ id: a.id, title: a.title, artist: a.artist, year: a.year, art_path: `demo:${a.id}` })),
      tracks: catalog.tracks.map((t) => ({
        id: t.id,
        library_id: 'demo-library',
        album_id: t.albumId,
        file_path: `/demo/music/${t.artist}/${t.album}/${String(t.trackNumber).padStart(2, '0')} - ${t.title}.mp3`,
        ext: '.mp3',
        file_size: Math.round(t.durationMs * 24),
        mtime_ms: now,
        title: t.title,
        artist: t.artist,
        album_artist: t.artist,
        album: t.album,
        track_number: t.trackNumber,
        disc_number: 1,
        year: t.year,
        genre: t.genre,
        duration_ms: t.durationMs,
      })),
    },
  });
  backfillTrackMetadataAndEnergy();
  DEMO_STATIONS.forEach((s, i) => {
    scheduleEngine.createStation({
      name: s.name,
      channelNumber: i + 1,
      playMode: s.playMode,
      rules: s.rules,
      enabled: true,
      crossfadeEnabled: Boolean(s.crossfadeSeconds),
      crossfadeSeconds: s.crossfadeSeconds ?? 5,
    } as Parameters<typeof scheduleEngine.createStation>[0]);
  });
}

let SQL: SqlJsStatic | null = null;

async function loadDatabase(forceFresh = false): Promise<void> {
  const sql = (SQL ??= await initSqlJs({ locateFile: () => new URL('sql-wasm.wasm', self.location.href).href }));
  if (!forceFresh) {
    const [saved, version] = await Promise.all([idbGet<Uint8Array>('db'), idbGet<string>('version')]);
    if (saved && version === DEMO_DATA_VERSION) {
      setActiveDatabase(new sql.Database(saved));
      initDatabase(); // applies any schema upgrades
      return;
    }
  }
  setActiveDatabase(new sql.Database());
  seedLibrary();
  await persist();
}

let ready: Promise<void> | null = null;
const ensureReady = () => (ready ??= loadDatabase());

// ---------------------------------------------------------------------------
// Demo-only routes: audio, artwork, reset, and polite refusals
// ---------------------------------------------------------------------------

const NOT_IN_DEMO =
  'This is not available in the online demo. Install Radiarr with Docker or the desktop app to use it with your own music.';
const refuse: Handler = (_req, res) => {
  res.status(403).json({ error: NOT_IN_DEMO, message: NOT_IN_DEMO });
};
const svg = (res: DemoResponse, body: string) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.end(body);
};

const demoRouter = new ExpressRouter();

demoRouter.get(['/art/artist/:artistName'], (req, res) => {
  const album = albumsByArtist.get(req.params.artistName);
  if (!album) return res.status(404).end();
  svg(res, artistPhotoSvg(album.artist, [album.colors[1], album.colors[0]]));
});
demoRouter.get('/art/:albumId', (req, res) => {
  const album = albumsById.get(req.params.albumId);
  if (!album) return res.status(404).end();
  svg(res, albumCoverSvg(album.title, album.artist, album.colors));
});

demoRouter.post('/__demo/reset', async (_req, res) => {
  await loadDatabase(true);
  res.json({ ok: true });
});

// Things that need a real server.
demoRouter.post(['/plex/auth/pin', '/plex/server', '/plex/libraries', '/plex/disconnect'], refuse);
demoRouter.post(['/scan', '/libraries', '/libraries/upload', '/settings/nas-mount'], refuse);
demoRouter.patch('/libraries/:id', refuse);
demoRouter.delete('/libraries/:id', refuse);
demoRouter.post(['/backup/restore', '/backup/restore-stored/:filename', '/backup/create-now', '/backup/auto-config'], refuse);
demoRouter.delete('/backup/stored/:filename', refuse);
demoRouter.get('/backup/download/:filename', refuse);
demoRouter.put('/auth/toggle', refuse);
demoRouter.post(['/auth/setup-initial-admin', '/auth/login'], refuse);
demoRouter.post(['/users', '/users/:id'], refuse);
demoRouter.put('/users/:id', refuse);
demoRouter.delete('/users/:id', refuse);
demoRouter.post('/diagnostics/test-stream/:trackId', refuse);
demoRouter.get(['/stations/:id/stream.mp3', '/stations/:id/stream'], refuse);

const MOUNTS: [string, ExpressRouter][] = [
  ['/api', demoRouter],
  ['/api/auth', authRouter as unknown as ExpressRouter],
  ['/api/users', usersRouter as unknown as ExpressRouter],
  ['/api', librariesRouter as unknown as ExpressRouter],
  ['/api', stationsRouter as unknown as ExpressRouter],
  ['/api', settingsRouter as unknown as ExpressRouter],
  ['/api', diagnosticsRouter as unknown as ExpressRouter],
];

// POST requests that only read data, so there is nothing to save afterwards.
const READ_ONLY_POSTS = [/^\/api\/stations\/[^/]+\/navigate$/, /^\/api\/stations\/preview$/, /^\/api\/diagnostics\//];

// ---------------------------------------------------------------------------
// Dispatching requests through the real route handlers
// ---------------------------------------------------------------------------

async function dispatch(request: Request, url: URL): Promise<Response> {
  await ensureReady();

  const method = request.method.toUpperCase();
  const path = url.pathname;

  const AUDIO = /^\/api\/(?:audio|tracks)\/([^/]+)(?:\/(?:stream|audio))?$/;
  const audioMatch = method === 'GET' && path.match(AUDIO);
  if (audioMatch) {
    const id = decodeURIComponent(audioMatch[1]);
    const duration = trackDurations.get(id);
    if (!duration) return new Response('Not found', { status: 404 });
    return synthesizeTrackResponse(id, duration, request.headers.get('range'));
  }

  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
  let body: unknown = {};
  if (method !== 'GET' && method !== 'HEAD') {
    const text = await request.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
  }

  const req = {
    method,
    path,
    url: path + url.search,
    originalUrl: path + url.search,
    query: Object.fromEntries(url.searchParams.entries()),
    params: {},
    body,
    headers,
    protocol: url.protocol.replace(':', ''),
    secure: url.protocol === 'https:',
    get: (name: string) => (name.toLowerCase() === 'host' ? url.host : headers[name.toLowerCase()]),
    header: (name: string) => headers[name.toLowerCase()],
  } as DemoRequest;
  const res = new DemoResponse();

  const chain: { handler: Handler; params: Record<string, string> }[] = [
    { handler: loadUserSession as unknown as Handler, params: {} },
  ];
  for (const [prefix, router] of MOUNTS) {
    if (path !== prefix && !path.startsWith(prefix + '/')) continue;
    const sub = path.slice(prefix.length) || '/';
    for (const m of router.match(method, sub)) {
      for (const handler of m.handlers) chain.push({ handler, params: m.params });
    }
  }

  let index = 0;
  let failure: unknown = null;
  const next = (err?: unknown): void => {
    if (err) {
      failure = err;
      return;
    }
    if (res.writableEnded) return;
    const step = chain[index++];
    if (!step) {
      res.status(404).json({ error: `Not found: ${method} ${path}` });
      return;
    }
    req.params = step.params;
    try {
      const out = step.handler(req, res, next);
      if (out && typeof (out as Promise<unknown>).catch === 'function') {
        (out as Promise<unknown>).catch((e) => {
          failure = e;
          if (!res.writableEnded) res.status(500).json({ error: String((e as Error)?.message ?? e) });
        });
      }
    } catch (e) {
      failure = e;
    }
  };
  next();

  if (failure && !res.writableEnded) {
    res.status(500).json({ error: String((failure as Error)?.message ?? failure) });
  }
  await Promise.race([res.done, new Promise((r) => setTimeout(r, 15000))]);
  if (!res.writableEnded) res.status(504).json({ error: 'The demo took too long to answer.' });

  if (method !== 'GET' && method !== 'HEAD' && res.statusCode < 400 && !READ_ONLY_POSTS.some((r) => r.test(path))) {
    await persist();
  }
  return res.toResponse();
}

// ---------------------------------------------------------------------------
// Service worker lifecycle
// ---------------------------------------------------------------------------

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data === 'claim') event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/api/')) return;
  event.respondWith(
    dispatch(event.request, url).catch(
      (err) =>
        new Response(JSON.stringify({ error: String(err?.message ?? err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
    )
  );
});
