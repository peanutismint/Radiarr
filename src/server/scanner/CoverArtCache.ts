import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { ART_CACHE_DIR } from '../config.ts';

const execFileAsync = promisify(execFile);

export const FOLDER_ART_CANDIDATES = [
  'cover.jpg',
  'cover.jpeg',
  'cover.png',
  'folder.jpg',
  'folder.jpeg',
  'folder.png',
  'front.jpg',
  'front.jpeg',
  'front.png',
];

export const ARTIST_ART_CANDIDATES = [
  'artist.jpg',
  'artist.jpeg',
  'artist.png',
  'artist.webp',
  'band.jpg',
  'band.jpeg',
  'band.png',
  'band.webp',
  'fanart.jpg',
  'fanart.jpeg',
  'fanart.png',
  'fanart.webp',
  'poster.jpg',
  'poster.jpeg',
  'poster.png',
  'artist-poster.jpg',
  'artist-thumb.jpg',
  'photo.jpg',
  'photo.jpeg',
  'press.jpg',
  'press.jpeg',
];

// Cache resolved art status per albumId in memory so we only check disk or run ffmpeg ONCE per album
const resolvedAlbumArtCache = new Map<string, string | null>();
const inFlightAlbumArt = new Map<string, Promise<string | null>>();
const directoryArtSourceCache = new Map<string, string | null>();
const resolvedArtistArtCache = new Map<string, string | null>();

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts embedded art or folder image (cover/folder/front) and caches it in
 * /config/art-cache/<albumId>.jpg.
 * If embeddedPictureData was already extracted in-process by music-metadata,
 * writes it directly to disk without spawning an ffmpeg subprocess.
 * Never modifies the source music folder.
 */
export async function ensureAlbumCoverArt(
  albumId: string,
  audioFilePath: string,
  hasEmbeddedArt: boolean,
  embeddedPictureData?: Uint8Array
): Promise<string | null> {
  if (resolvedAlbumArtCache.has(albumId)) {
    return resolvedAlbumArtCache.get(albumId) ?? null;
  }

  const existingPromise = inFlightAlbumArt.get(albumId);
  if (existingPromise) {
    return existingPromise;
  }

  const workPromise = (async (): Promise<string | null> => {
    const cachedFileName = `${albumId}.jpg`;
    const targetCachePath = path.join(ART_CACHE_DIR, cachedFileName);

    if (await fileExists(targetCachePath)) {
      resolvedAlbumArtCache.set(albumId, cachedFileName);
      return cachedFileName;
    }

    // 1. Fast Path: If embedded artwork bytes were already extracted in memory by music-metadata, write directly!
    if (embeddedPictureData && embeddedPictureData.byteLength > 0) {
      try {
        await fs.writeFile(targetCachePath, embeddedPictureData);
        resolvedAlbumArtCache.set(albumId, cachedFileName);
        return cachedFileName;
      } catch {
        // Fall through to folder art or ffmpeg
      }
    }

    // 2. Check for cover, folder, or front image in the album's directory (cached per folder)
    const albumDir = path.dirname(audioFilePath);
    try {
      let foundSource = directoryArtSourceCache.get(albumDir);
      if (foundSource === undefined) {
        const entries = await fs.readdir(albumDir);
        const lowerMap = new Map<string, string>();
        for (const e of entries) {
          lowerMap.set(e.toLowerCase(), path.join(albumDir, e));
        }
        foundSource = null;
        for (const candidate of FOLDER_ART_CANDIDATES) {
          const match = lowerMap.get(candidate);
          if (match) {
            foundSource = match;
            break;
          }
        }
        directoryArtSourceCache.set(albumDir, foundSource);
      }

      if (foundSource) {
        await fs.copyFile(foundSource, targetCachePath);
        resolvedAlbumArtCache.set(albumId, cachedFileName);
        return cachedFileName;
      }
    } catch {
      // Fall through
    }

    // 3. Fallback: If ffprobe detected embedded art (and music-metadata didn't provide bytes), extract via ffmpeg
    if (hasEmbeddedArt) {
      try {
        await execFileAsync(
          'ffmpeg',
          [
            '-y',
            '-v',
            'quiet',
            '-i',
            audioFilePath,
            '-an',
            '-vf',
            'scale=300:300:force_original_aspect_ratio=increase,crop=300:300',
            '-frames:v',
            '1',
            targetCachePath,
          ],
          { timeout: 10000 }
        );
        if (await fileExists(targetCachePath)) {
          resolvedAlbumArtCache.set(albumId, cachedFileName);
          return cachedFileName;
        }
      } catch {
        // Ignore
      }
    }

    resolvedAlbumArtCache.set(albumId, null);
    return null;
  })();

  inFlightAlbumArt.set(albumId, workPromise);
  try {
    return await workPromise;
  } finally {
    inFlightAlbumArt.delete(albumId);
  }
}

/**
 * Searches the track's album directory and the parent artist directory for generic
 * band/artist press photos (e.g., artist.jpg, band.jpg, fanart.jpg, poster.jpg, press.jpg).
 * Caches the extracted image in /config/art-cache/artist-<hash>.jpg.
 */
export async function ensureArtistGenericArt(
  artistName: string,
  audioFilePath: string
): Promise<string | null> {
  const normKey = artistName.trim().toLowerCase();
  if (!normKey) return null;

  if (resolvedArtistArtCache.has(normKey)) {
    return resolvedArtistArtCache.get(normKey) ?? null;
  }

  const hashKey = crypto.createHash('sha1').update(normKey).digest('hex').slice(0, 16);
  const cachedFileName = `artist-${hashKey}.jpg`;
  const targetCachePath = path.join(ART_CACHE_DIR, cachedFileName);

  if (await fileExists(targetCachePath)) {
    resolvedArtistArtCache.set(normKey, cachedFileName);
    return cachedFileName;
  }

  const albumDir = path.dirname(audioFilePath);
  const artistDir = path.dirname(albumDir);
  const dirsToCheck = [artistDir, albumDir];

  for (const dir of dirsToCheck) {
    try {
      const entries = await fs.readdir(dir);
      const lowerMap = new Map<string, string>();
      for (const e of entries) {
        lowerMap.set(e.toLowerCase(), path.join(dir, e));
      }
      for (const candidate of ARTIST_ART_CANDIDATES) {
        const match = lowerMap.get(candidate);
        if (match) {
          try {
            if (match.toLowerCase().endsWith('.jpg') || match.toLowerCase().endsWith('.jpeg')) {
              await fs.copyFile(match, targetCachePath);
            } else {
              await execFileAsync(
                'ffmpeg',
                [
                  '-y',
                  '-v',
                  'quiet',
                  '-i',
                  match,
                  '-vf',
                  'scale=400:400:force_original_aspect_ratio=increase,crop=400:400',
                  targetCachePath,
                ],
                { timeout: 10000 }
              );
            }
            if (await fileExists(targetCachePath)) {
              resolvedArtistArtCache.set(normKey, cachedFileName);
              return cachedFileName;
            }
          } catch {
            // continue checking
          }
        }
      }
    } catch {
      // directory read failure
    }
  }

  resolvedArtistArtCache.set(normKey, null);
  return null;
}

export function getResolvedArtistArt(artistName: string): string | null {
  return resolvedArtistArtCache.get(artistName.trim().toLowerCase()) ?? null;
}

export function setResolvedArtistArt(artistName: string, cachedFileName: string | null): void {
  resolvedArtistArtCache.set(artistName.trim().toLowerCase(), cachedFileName);
}
