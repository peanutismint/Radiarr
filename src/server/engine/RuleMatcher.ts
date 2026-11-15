import {
  computeTrackEnergyLevel,
  extractNormalizedGenreKeys,
  normalizeGenreKey,
  resolveTrackEraMetadata,
} from '../../shared/metadataNormalizer.ts';
import {
  StationRules,
  TrackEnergyLevel,
  TrackRecord,
} from '../../shared/types.ts';
import { db } from '../db/index.ts';

function normalizeSet(values?: string[]): Set<string> | null {
  if (!values || values.length === 0) return null;
  const cleaned = values.map((v) => v.trim().toLowerCase()).filter(Boolean);
  return cleaned.length > 0 ? new Set(cleaned) : null;
}

function normalizeGenreRuleSet(values?: string[]): Set<string> | null {
  if (!values || values.length === 0) return null;
  const keys = values
    .map((v) => normalizeGenreKey(v) || v.trim().toLowerCase())
    .filter(Boolean);
  return keys.length > 0 ? new Set(keys) : null;
}

/**
 * Evaluates a StationRules object against a list of candidate tracks in memory.
 * Kept as a pure function so unit tests can run against in-memory tracks or SQLite tracks.
 */
export function filterTracksByRules(
  tracks: readonly TrackRecord[],
  rules: StationRules,
  options?: { ignorePinnedSnapshot?: boolean }
): TrackRecord[] {
  if (
    !options?.ignorePinnedSnapshot &&
    rules.smartUpdate === false &&
    Array.isArray(rules.pinnedTrackIds)
  ) {
    const pinnedSet = new Set(rules.pinnedTrackIds);
    return tracks.filter((t) => pinnedSet.has(t.id));
  }

  const libSet = normalizeSet(rules.libraryIds);
  const artistSet = normalizeSet(rules.artists);
  const albumSet = normalizeSet(rules.albums);
  const genreSet = normalizeGenreRuleSet(rules.genres);
  const yearMin =
    typeof rules.yearMin === 'number' && Number.isFinite(rules.yearMin)
      ? rules.yearMin
      : null;
  const yearMax =
    typeof rules.yearMax === 'number' && Number.isFinite(rules.yearMax)
      ? rules.yearMax
      : null;

  return tracks.filter((t) => {
    if (libSet && !libSet.has(t.libraryId.toLowerCase())) {
      return false;
    }

    if (artistSet) {
      const trackArtist = t.artist.trim().toLowerCase();
      const trackAlbumArtist = (t.albumArtist || '').trim().toLowerCase();
      if (!artistSet.has(trackArtist) && (!trackAlbumArtist || !artistSet.has(trackAlbumArtist))) {
        return false;
      }
    }

    if (albumSet) {
      const trackAlbum = t.album.trim().toLowerCase();
      if (!albumSet.has(trackAlbum) && !albumSet.has(t.albumId.toLowerCase())) {
        return false;
      }
    }

    const eraMeta = resolveTrackEraMetadata({
      year: t.year,
      originalYear: t.originalYear ?? null,
      albumYear: t.albumYear,
      title: t.title,
      album: t.album,
      artist: t.artist,
      albumArtist: t.albumArtist,
    });

    if (genreSet) {
      if (!t.genre) return false;
      const isReissueOrComp = Boolean(t.isReissueOrComp ?? eraMeta.isReissueOrComp);
      const trackGenreKeys = extractNormalizedGenreKeys(t.genre, isReissueOrComp);
      const rawTokens = t.genre
        .split(/[,;/|]/)
        .map((g) => g.trim().toLowerCase())
        .filter(Boolean);
      const hasGenreMatch =
        trackGenreKeys.some((gk) => genreSet.has(gk)) ||
        (!isReissueOrComp && rawTokens.some((rt) => genreSet.has(rt)));
      if (!hasGenreMatch) return false;
    }

    if (yearMin !== null || yearMax !== null) {
      // Guard against remaster / greatest-hits "era drift" on pure Era stations:
      // If a track on a Remaster or Greatest Hits compilation only has a modern reissue year
      // and no verified original release year, exclude it from modern era filters unless the
      // station explicitly targets that artist or album.
      if (
        !artistSet &&
        !albumSet &&
        eraMeta.isUnverifiedModernReissue &&
        (yearMin === null || yearMin >= 1990)
      ) {
        return false;
      }

      const effectiveYear =
        t.originalYear ?? eraMeta.originalYear ?? eraMeta.effectiveYear;
      if (yearMin !== null) {
        if (effectiveYear === null || effectiveYear < yearMin) return false;
      }
      if (yearMax !== null) {
        if (effectiveYear === null || effectiveYear > yearMax) return false;
      }
    }

    return true;
  });
}

/**
 * In-memory catalog cache of all tracks from enabled libraries + per-rule match memoization.
 * Invalidated whenever libraries, tracks, or albums are added/updated/deleted.
 */
let cachedEnabledTracks: TrackRecord[] | null = null;
const cachedMatchesByRuleKey = new Map<string, TrackRecord[]>();

export function invalidateTrackCatalogCache(): void {
  cachedEnabledTracks = null;
  cachedMatchesByRuleKey.clear();
}

export function getAllEnabledTracksCached(): TrackRecord[] {
  if (cachedEnabledTracks !== null) {
    return cachedEnabledTracks;
  }

  const rows = db
    .prepare(`
      SELECT
        t.id,
        t.library_id,
        t.album_id,
        t.file_path,
        t.ext,
        t.file_size,
        t.mtime_ms,
        t.title,
        t.artist,
        t.album_artist,
        t.album,
        a.year AS album_year,
        a.art_path,
        t.track_number,
        t.disc_number,
        t.year,
        t.original_year,
        t.genre,
        t.bpm,
        t.mood,
        t.energy_level,
        t.is_reissue_or_comp,
        t.gain_db,
        t.duration_ms
      FROM tracks t
      JOIN libraries l ON l.id = t.library_id
      JOIN albums a ON a.id = t.album_id
      WHERE l.enabled = 1
      ORDER BY t.id ASC
    `)
    .all() as Array<{
    id: string;
    library_id: string;
    album_id: string;
    file_path: string;
    ext: string;
    file_size: number;
    mtime_ms: number;
    title: string;
    artist: string;
    album_artist: string | null;
    album: string;
    album_year: number | null;
    art_path: string | null;
    track_number: number;
    disc_number: number;
    year: number | null;
    original_year: number | null;
    genre: string | null;
    bpm: number | null;
    mood: string | null;
    energy_level: number | null;
    is_reissue_or_comp: number | null;
    gain_db: number | null;
    duration_ms: number;
  }>;

  // Compute album_track_count in O(N) in a single pass instead of an O(N^2) correlated SQL subquery
  const albumTrackCounts = new Map<string, number>();
  for (const r of rows) {
    albumTrackCounts.set(r.album_id, (albumTrackCounts.get(r.album_id) || 0) + 1);
  }

  cachedEnabledTracks = rows.map((r) => {
    const rawEnergy = Number(r.energy_level);
    const energyLevel: TrackEnergyLevel =
      rawEnergy === 1 || rawEnergy === 2 || rawEnergy === 3
        ? rawEnergy
        : computeTrackEnergyLevel({
            title: r.title,
            album: r.album,
            genre: r.genre,
            mood: r.mood,
            bpm: r.bpm !== null ? Number(r.bpm) : null,
            durationMs: Number(r.duration_ms),
          });

    return {
      id: r.id,
      libraryId: r.library_id,
      albumId: r.album_id,
      filePath: r.file_path,
      ext: r.ext,
      fileSize: Number(r.file_size),
      mtimeMs: Number(r.mtime_ms),
      title: r.title,
      artist: r.artist,
      albumArtist: r.album_artist,
      album: r.album,
      albumYear: r.album_year !== null ? Number(r.album_year) : null,
      albumTrackCount: Math.max(1, albumTrackCounts.get(r.album_id) || 1),
      hasArt: Boolean(r.art_path),
      trackNumber: Number(r.track_number),
      discNumber: Number(r.disc_number),
      year: r.year !== null ? Number(r.year) : null,
      originalYear: r.original_year !== null ? Number(r.original_year) : null,
      genre: r.genre,
      bpm: r.bpm !== null ? Number(r.bpm) : null,
      mood: r.mood,
      energyLevel,
      isReissueOrComp: r.is_reissue_or_comp === 1,
      gainDb: typeof r.gain_db === 'number' ? Number(r.gain_db) : null,
      durationMs: Number(r.duration_ms),
    };
  });

  return cachedEnabledTracks;
}

/**
 * Returns all tracks from enabled libraries matching the given rules, using the in-memory
 * catalog cache and rule memoization so EPG, station stats, and suggestions resolve in < 1ms.
 */
export function getMatchingTracksFromDb(
  rules: StationRules,
  options?: { ignorePinnedSnapshot?: boolean }
): TrackRecord[] {
  const allTracks = getAllEnabledTracksCached();
  const cacheKey = `${options?.ignorePinnedSnapshot ? 'ignorePin:' : ''}${JSON.stringify(rules || {})}`;

  const memoized = cachedMatchesByRuleKey.get(cacheKey);
  if (memoized) {
    return memoized;
  }

  const matched = filterTracksByRules(allTracks, rules, options);
  if (cachedMatchesByRuleKey.size > 500) {
    cachedMatchesByRuleKey.clear();
  }
  cachedMatchesByRuleKey.set(cacheKey, matched);
  return matched;
}

