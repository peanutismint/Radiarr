import crypto from 'node:crypto';
import path from 'node:path';
import {
  computeTrackEnergyLevel,
  extractCanonicalGenreDisplays,
  resolveTrackEraMetadata,
} from '../../shared/metadataNormalizer.ts';
import {
  PlexConfig,
  PlexRemoteSection,
  PlexServerConnection,
  PlexServerDevice,
  SUPPORTED_EXTENSIONS,
  TrackEnergyLevel,
} from '../../shared/types.ts';
import { getServerSettings, saveServerSettings } from '../routes/settings.ts';

const PLEX_PRODUCT_HEADERS = {
  Accept: 'application/json',
  'X-Plex-Product': 'Radiarr',
  'X-Plex-Version': '1.0.0',
  'X-Plex-Platform': 'Web',
  'X-Plex-Device': 'Radiarr Server',
  'X-Plex-Device-Name': 'Radiarr',
};

const SUPPORTED_EXT_SET = new Set<string>(SUPPORTED_EXTENSIONS);

export interface ScannedPlexTrackItem {
  trackId: string;
  albumId: string;
  albumTitle: string;
  albumArtist: string;
  albumYear: number | null;
  artPath: string | null;
  artistArtPath?: string | null;
  filePath: string;
  ext: string;
  fileSize: number;
  mtimeMs: number;
  title: string;
  artist: string;
  trackNumber: number;
  discNumber: number;
  year: number | null;
  originalYear: number | null;
  genre: string | null;
  bpm: number | null;
  mood: string | null;
  energyLevel: TrackEnergyLevel;
  isReissueOrComp: boolean;
  durationMs: number;
  tagsIncomplete: boolean;
  missingFields: string[];
}

function hashId(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 16);
}

export function ensurePlexClientId(): string {
  const current = getServerSettings();
  if (current.plexConfig?.clientId) {
    return current.plexConfig.clientId;
  }
  const clientId = `radiarr-${crypto.randomUUID()}`;
  saveServerSettings({
    plexConfig: {
      ...(current.plexConfig || {}),
      clientId,
    },
  });
  return clientId;
}

/**
 * Creates a strong=true Plex OAuth pin so the user can authenticate on app.plex.tv/auth
 * with a single click ("Allow" / "Sign In") without ever typing a 4-digit PIN.
 */
export async function createPlexAuthPin(forwardUrl?: string): Promise<{
  pinId: number;
  code: string;
  authUrl: string;
}> {
  const clientId = ensurePlexClientId();

  const res = await fetch('https://plex.tv/api/v2/pins?strong=true', {
    method: 'POST',
    headers: {
      ...PLEX_PRODUCT_HEADERS,
      'X-Plex-Client-Identifier': clientId,
    },
  });

  if (!res.ok) {
    throw new Error(`Plex PIN request failed (${res.status})`);
  }

  const data = (await res.json()) as { id: number; code: string };

  // Construct the hash query parameters expected by https://app.plex.tv/auth#?...
  const params = new URLSearchParams({
    clientID: clientId,
    code: data.code,
    'context[device][product]': 'Radiarr',
    'context[device][platform]': 'Web',
    'context[device][device]': 'Radiarr Server',
  });

  if (forwardUrl) {
    params.set('forwardUrl', forwardUrl);
  }

  const authUrl = `https://app.plex.tv/auth#?${params.toString()}`;
  return {
    pinId: data.id,
    code: data.code,
    authUrl,
  };
}

/**
 * Checks whether a Plex PIN has been claimed by the user.
 * If claimed, fetches user info + discovers Plex servers and saves plexConfig.
 */
export async function checkPlexAuthPin(
  pinId: number,
  code?: string
): Promise<{
  authenticated: boolean;
  plexConfig: PlexConfig;
  servers?: PlexServerDevice[];
}> {
  const clientId = ensurePlexClientId();
  const url = new URL(`https://plex.tv/api/v2/pins/${encodeURIComponent(String(pinId))}`);
  if (code) {
    url.searchParams.set('code', code);
  }

  const res = await fetch(url.toString(), {
    headers: {
      ...PLEX_PRODUCT_HEADERS,
      'X-Plex-Client-Identifier': clientId,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to check Plex PIN (${res.status})`);
  }

  const pinData = (await res.json()) as { authToken?: string | null };
  if (!pinData.authToken) {
    return {
      authenticated: false,
      plexConfig: getServerSettings().plexConfig || { clientId },
    };
  }

  const authToken = pinData.authToken;

  // Fetch Plex account profile
  let username = 'Plex User';
  let email = '';
  let thumb = '';
  try {
    const userRes = await fetch('https://plex.tv/api/v2/user', {
      headers: {
        ...PLEX_PRODUCT_HEADERS,
        'X-Plex-Client-Identifier': clientId,
        'X-Plex-Token': authToken,
      },
    });
    if (userRes.ok) {
      const userData = (await userRes.json()) as {
        username?: string;
        title?: string;
        email?: string;
        thumb?: string;
      };
      username = userData.username || userData.title || 'Plex User';
      email = userData.email || '';
      thumb = userData.thumb || '';
    }
  } catch {
    // ignore profile lookup error
  }

  // Discover user's Plex Media Servers
  const existingConfig = getServerSettings().plexConfig || { clientId };
  let nextConfig: PlexConfig = {
    ...existingConfig,
    clientId,
    authToken,
    username,
    email,
    thumb,
  };

  saveServerSettings({ plexConfig: nextConfig });

  let servers: PlexServerDevice[] = [];
  try {
    servers = await discoverPlexServers();
    if (servers.length > 0 && !nextConfig.serverUri) {
      const first = servers[0];
      const reachableUri = await findBestServerConnectionUri(first);
      nextConfig = {
        ...nextConfig,
        serverName: first.name,
        serverMachineId: first.clientIdentifier,
        serverUri: reachableUri,
        serverAccessToken: first.accessToken || authToken,
      };
      saveServerSettings({ plexConfig: nextConfig });
    }
  } catch {
    // ignore server discovery error during auth
  }

  return {
    authenticated: true,
    plexConfig: nextConfig,
    servers,
  };
}

/**
 * Queries plex.tv for all Plex Media Server resources accessible to the authenticated user.
 */
export async function discoverPlexServers(): Promise<PlexServerDevice[]> {
  const settings = getServerSettings();
  const plexConfig = settings.plexConfig;
  if (!plexConfig?.authToken) {
    return [];
  }

  const clientId = ensurePlexClientId();
  const res = await fetch(
    'https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1',
    {
      headers: {
        ...PLEX_PRODUCT_HEADERS,
        'X-Plex-Client-Identifier': clientId,
        'X-Plex-Token': plexConfig.authToken,
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch Plex servers (${res.status})`);
  }

  const resources = (await res.json()) as Array<{
    name: string;
    provides?: string;
    clientIdentifier: string;
    accessToken?: string;
    connections?: Array<{
      uri: string;
      address: string;
      port: number;
      protocol: string;
      local: boolean;
      relay?: boolean;
    }>;
  }>;

  const servers: PlexServerDevice[] = [];
  for (const r of resources) {
    if (!r.provides || !r.provides.split(',').includes('server')) {
      continue;
    }

    const connections: PlexServerConnection[] = (r.connections || []).map((c) => ({
      uri: c.uri.replace(/\/+$/, ''),
      address: c.address,
      port: Number(c.port),
      protocol: c.protocol,
      local: Boolean(c.local),
      relay: Boolean(c.relay),
    }));

    // Order connections: non-relay direct first, then local, then relay
    connections.sort((a, b) => {
      if (a.relay !== b.relay) return a.relay ? 1 : -1;
      if (a.local !== b.local) return a.local ? -1 : 1;
      return 0;
    });

    const preferredUri =
      connections[0]?.uri || `http://${r.connections?.[0]?.address || 'localhost'}:32400`;

    servers.push({
      name: r.name,
      clientIdentifier: r.clientIdentifier,
      accessToken: r.accessToken || plexConfig.authToken,
      preferredUri,
      connections,
    });
  }

  return servers;
}

/**
 * Probes candidate connection URIs for a Plex server in parallel and returns the fastest reachable URI.
 */
export async function findBestServerConnectionUri(
  server: PlexServerDevice
): Promise<string> {
  if (!server.connections || server.connections.length === 0) {
    return server.preferredUri;
  }

  const probeConnection = async (conn: PlexServerConnection): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const res = await fetch(`${conn.uri}/identity`, {
        headers: {
          Accept: 'application/json',
          'X-Plex-Token': server.accessToken,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Status ${res.status}`);
      }
      return conn.uri;
    } finally {
      clearTimeout(timer);
    }
  };

  // Try non-relay connections first
  const directConns = server.connections.filter((c) => !c.relay);
  const relayConns = server.connections.filter((c) => c.relay);

  try {
    if (directConns.length > 0) {
      return await Promise.any(directConns.map((c) => probeConnection(c)));
    }
  } catch {
    // Fall back to relay connections
  }

  try {
    if (relayConns.length > 0) {
      return await Promise.any(relayConns.map((c) => probeConnection(c)));
    }
  } catch {
    // Fall back to preferredUri
  }

  return server.preferredUri;
}

/**
 * Fetches all Music library sections (type === 'artist') from the currently selected Plex server.
 */
export async function fetchPlexMusicSections(
  existingLibraries: Array<{ id: string; path: string; sourceType: string }>
): Promise<PlexRemoteSection[]> {
  const plexConfig = getServerSettings().plexConfig;
  if (!plexConfig?.serverUri) {
    return [];
  }

  const token = plexConfig.serverAccessToken || plexConfig.authToken;
  if (!token) {
    return [];
  }

  const baseUri = plexConfig.serverUri.replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${baseUri}/library/sections`, {
      headers: {
        ...PLEX_PRODUCT_HEADERS,
        'X-Plex-Token': token,
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Plex server returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      MediaContainer?: {
        Directory?: Array<{
          key: string;
          title: string;
          type: string;
        }>;
      };
    };

    const directories = data.MediaContainer?.Directory || [];
    const musicDirs = directories.filter((d) => d.type === 'artist');

    return musicDirs.map((d) => {
      const expectedPathPrefix = `plex://${plexConfig.serverMachineId || 'server'}/${d.key}`;
      const match = existingLibraries.find(
        (l) =>
          l.sourceType === 'plex' &&
          (l.path === expectedPathPrefix || l.path.endsWith(`/${d.key}`))
      );

      return {
        key: String(d.key),
        title: d.title,
        type: d.type,
        connectedLibraryId: match ? match.id : null,
      };
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches all albums and tracks from a Plex Music library section (type=9 & type=10).
 */
export async function fetchPlexLibraryCatalog(
  sectionKey: string
): Promise<{
  tracks: ScannedPlexTrackItem[];
  skippedByExt: Record<string, number>;
}> {
  const plexConfig = getServerSettings().plexConfig;
  const token = plexConfig?.serverAccessToken || plexConfig?.authToken;
  if (!plexConfig?.serverUri || !token) {
    throw new Error('Plex server is not connected.');
  }

  const baseUri = plexConfig.serverUri.replace(/\/+$/, '');
  const machineId = plexConfig.serverMachineId || 'server';

  // 1. Fetch albums (type=9) to capture album-level genres, release years, moods/styles, and cover art thumbs
  const albumMetaMap = new Map<
    string,
    {
      title: string;
      artist: string;
      year: number | null;
      originalYear: number | null;
      genres: string[];
      moods: string[];
      thumb: string | null;
    }
  >();

  const parseIsoYear = (iso?: string | null): number | null => {
    if (!iso || typeof iso !== 'string') return null;
    const m = iso.match(/\b(19\d{2}|20\d{2})\b/);
    return m ? parseInt(m[1], 10) : null;
  };

  try {
    const albumsRes = await fetch(
      `${baseUri}/library/sections/${encodeURIComponent(sectionKey)}/all?type=9`,
      {
        headers: {
          ...PLEX_PRODUCT_HEADERS,
          'X-Plex-Token': token,
        },
      }
    );
    if (albumsRes.ok) {
      const albumsData = (await albumsRes.json()) as {
        MediaContainer?: {
          Metadata?: Array<{
            ratingKey: string;
            title?: string;
            parentTitle?: string;
            year?: number;
            originallyAvailableAt?: string;
            thumb?: string;
            Genre?: Array<{ tag: string }>;
            Mood?: Array<{ tag: string }>;
            Style?: Array<{ tag: string }>;
          }>;
        };
      };
      for (const alb of albumsData.MediaContainer?.Metadata || []) {
        const genres = (alb.Genre || [])
          .map((g) => g.tag?.trim())
          .filter((g): g is string => Boolean(g));
        const moods = [...(alb.Mood || []), ...(alb.Style || [])]
          .map((m) => m.tag?.trim())
          .filter((m): m is string => Boolean(m));
        albumMetaMap.set(String(alb.ratingKey), {
          title: alb.title || 'Unknown Album',
          artist: alb.parentTitle || 'Unknown Artist',
          year: typeof alb.year === 'number' ? alb.year : null,
          originalYear: parseIsoYear(alb.originallyAvailableAt),
          genres,
          moods,
          thumb: alb.thumb || null,
        });
      }
    }
  } catch {
    // Non-fatal: track metadata below still includes parentTitle, grandparentTitle, thumb, etc.
  }

  // 2. Fetch all tracks (type=10) in this library section
  const tracksRes = await fetch(
    `${baseUri}/library/sections/${encodeURIComponent(sectionKey)}/all?type=10`,
    {
      headers: {
        ...PLEX_PRODUCT_HEADERS,
        'X-Plex-Token': token,
      },
    }
  );

  if (!tracksRes.ok) {
    throw new Error(
      `Failed to fetch tracks from Plex library section ${sectionKey} (HTTP ${tracksRes.status})`
    );
  }

  const tracksData = (await tracksRes.json()) as {
    MediaContainer?: {
      Metadata?: Array<{
        ratingKey: string;
        parentRatingKey?: string;
        title?: string;
        grandparentTitle?: string; // Album Artist
        originalTitle?: string; // Track Artist
        parentTitle?: string; // Album Title
        index?: number; // Track Number
        parentIndex?: number; // Disc Number
        year?: number;
        parentYear?: number;
        originallyAvailableAt?: string;
        duration?: number;
        thumb?: string;
        parentThumb?: string;
        updatedAt?: number;
        addedAt?: number;
        Genre?: Array<{ tag: string }>;
        Mood?: Array<{ tag: string }>;
        Style?: Array<{ tag: string }>;
        Media?: Array<{
          container?: string;
          Part?: Array<{
            key: string;
            size?: number;
            file?: string;
            container?: string;
          }>;
        }>;
      }>;
    };
  };

  const rawItems = tracksData.MediaContainer?.Metadata || [];
  const results: ScannedPlexTrackItem[] = [];
  const skippedByExt: Record<string, number> = {};

  for (const item of rawItems) {
    const media = item.Media?.[0];
    const part = media?.Part?.[0];
    if (!part?.key) continue;

    const rawExt =
      (part.file ? path.extname(part.file) : '') ||
      (part.container ? `.${part.container}` : '') ||
      (media?.container ? `.${media.container}` : '') ||
      '.mp3';
    const ext = rawExt.toLowerCase();

    if (!SUPPORTED_EXT_SET.has(ext)) {
      skippedByExt[ext] = (skippedByExt[ext] || 0) + 1;
      continue;
    }

    const parentAlbum = item.parentRatingKey
      ? albumMetaMap.get(String(item.parentRatingKey))
      : undefined;

    const albumTitle = (
      item.parentTitle ||
      parentAlbum?.title ||
      'Singles'
    ).trim();
    const albumArtist = (
      item.grandparentTitle ||
      parentAlbum?.artist ||
      item.originalTitle ||
      'Unknown Artist'
    ).trim();
    const trackArtist = (
      item.originalTitle ||
      item.grandparentTitle ||
      parentAlbum?.artist ||
      'Unknown Artist'
    ).trim();
    const trackTitle = (item.title || 'Untitled Track').trim();

    const albumYear =
      typeof parentAlbum?.year === 'number'
        ? parentAlbum.year
        : typeof item.parentYear === 'number'
          ? item.parentYear
          : null;
    const rawTrackYear =
      typeof item.year === 'number' ? item.year : albumYear;
    const explicitOrigYear =
      parseIsoYear(item.originallyAvailableAt) ??
      parentAlbum?.originalYear ??
      null;

    const eraMeta = resolveTrackEraMetadata({
      year: rawTrackYear,
      originalYear: explicitOrigYear,
      albumYear,
      title: trackTitle,
      album: albumTitle,
      artist: trackArtist,
      albumArtist,
    });

    const trackYear = eraMeta.originalYear ?? eraMeta.effectiveYear;

    const trackGenres = (item.Genre || [])
      .map((g) => g.tag?.trim())
      .filter((g): g is string => Boolean(g));
    const effectiveGenres =
      trackGenres.length > 0 ? trackGenres : parentAlbum?.genres || [];
    const rawGenreStr =
      effectiveGenres.length > 0 ? effectiveGenres.join(', ') : null;
    const canonicalGenres = extractCanonicalGenreDisplays(
      rawGenreStr,
      eraMeta.isReissueOrComp
    );
    const genreStr =
      canonicalGenres.length > 0 ? canonicalGenres.join(', ') : rawGenreStr;

    const trackMoods = [...(item.Mood || []), ...(item.Style || [])]
      .map((m) => m.tag?.trim())
      .filter((m): m is string => Boolean(m));
    const effectiveMoods =
      trackMoods.length > 0 ? trackMoods : parentAlbum?.moods || [];
    const moodStr = effectiveMoods.length > 0 ? effectiveMoods.join('; ') : null;

    const durationMs = Math.max(1000, Number(item.duration || 180000));
    const energyLevel = computeTrackEnergyLevel({
      title: trackTitle,
      album: albumTitle,
      genre: genreStr,
      mood: moodStr,
      bpm: null,
      durationMs,
    });

    const thumbPath =
      item.thumb || item.parentThumb || parentAlbum?.thumb || null;
    const artPath = thumbPath ? `plex://${thumbPath}` : null;
    const artistThumbPath = (item as any).grandparentThumb || (item as any).grandparentArt || null;
    const artistArtPath = artistThumbPath ? `plex://${artistThumbPath}` : null;

    const albumId = hashId(
      `plex::${machineId}::${albumArtist.toLowerCase()}::${albumTitle.toLowerCase()}`
    );
    const virtualFilePath = `plex://${machineId}/${sectionKey}${part.key.startsWith('/') ? part.key : '/' + part.key}`;
    const trackId = hashId(virtualFilePath);

    const missingFields: string[] = [];
    if (!item.title) missingFields.push('title');
    if (!item.grandparentTitle && !item.originalTitle) missingFields.push('artist');
    if (!item.parentTitle) missingFields.push('album');

    results.push({
      trackId,
      albumId,
      albumTitle,
      albumArtist,
      albumYear: eraMeta.originalYear ?? albumYear,
      artPath,
      artistArtPath,
      filePath: virtualFilePath,
      ext,
      fileSize: Number(part.size || 0),
      mtimeMs: Number((item.updatedAt || item.addedAt || 1) * 1000),
      title: trackTitle,
      artist: trackArtist,
      trackNumber: Math.max(1, Number(item.index || 1)),
      discNumber: Math.max(1, Number(item.parentIndex || 1)),
      year: trackYear,
      originalYear: eraMeta.originalYear,
      genre: genreStr,
      bpm: null,
      mood: moodStr,
      energyLevel,
      isReissueOrComp: eraMeta.isReissueOrComp,
      durationMs,
      tagsIncomplete: missingFields.length > 0,
      missingFields,
    });
  }

  return { tracks: results, skippedByExt };
}

/**
 * Resolves a virtual `plex://<machineId>/<sectionKey>/library/parts/...` track path
 * into a full authenticated Plex HTTP stream URL.
 */
export function resolvePlexStreamUrl(virtualFilePath: string): string | null {
  if (!virtualFilePath.startsWith('plex://')) return null;

  const plexConfig = getServerSettings().plexConfig;
  const token = plexConfig?.serverAccessToken || plexConfig?.authToken;
  if (!plexConfig?.serverUri || !token) return null;

  const withoutScheme = virtualFilePath.slice('plex://'.length);
  const libIndex = withoutScheme.indexOf('/library/');
  const partPath =
    libIndex !== -1
      ? withoutScheme.slice(libIndex)
      : '/' + withoutScheme.split('/').slice(2).join('/');

  const baseUri = plexConfig.serverUri.replace(/\/+$/, '');
  const url = new URL(`${baseUri}${partPath}`);
  url.searchParams.set('X-Plex-Token', token);
  return url.toString();
}

/**
 * Resolves a virtual `plex:///library/metadata/.../thumb/...` art path
 * into a full authenticated Plex HTTP image URL.
 */
export function resolvePlexArtUrl(virtualArtPath: string): string | null {
  if (!virtualArtPath.startsWith('plex://')) return null;

  const plexConfig = getServerSettings().plexConfig;
  const token = plexConfig?.serverAccessToken || plexConfig?.authToken;
  if (!plexConfig?.serverUri || !token) return null;

  const rawThumb = virtualArtPath.slice('plex://'.length);
  const thumbPath = rawThumb.startsWith('/') ? rawThumb : `/${rawThumb}`;
  const baseUri = plexConfig.serverUri.replace(/\/+$/, '');

  const url = new URL(`${baseUri}${thumbPath}`);
  url.searchParams.set('X-Plex-Token', token);
  return url.toString();
}
