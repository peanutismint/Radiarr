import type { TrackEnergyLevel, TrackRecord } from './types.ts';

/**
 * Canonical genre alias table to unify hyphenation, spacing, and spelling variants
 * across ID3v2, Vorbis/FLAC, MP4, and Plex tags.
 */
const GENRE_CANONICAL_MAP: Record<string, { key: string; display: string }> = {
  synthpop: { key: 'synthpop', display: 'Synthpop' },
  'synth pop': { key: 'synthpop', display: 'Synthpop' },
  'synth-pop': { key: 'synthpop', display: 'Synthpop' },
  synthwave: { key: 'synthwave', display: 'Synthwave' },
  'synth wave': { key: 'synthwave', display: 'Synthwave' },
  'synth-wave': { key: 'synthwave', display: 'Synthwave' },
  retrowave: { key: 'synthwave', display: 'Synthwave' },
  chillwave: { key: 'chillwave', display: 'Chillwave' },
  'chill wave': { key: 'chillwave', display: 'Chillwave' },
  'chill-wave': { key: 'chillwave', display: 'Chillwave' },
  hiphop: { key: 'hip-hop', display: 'Hip-Hop' },
  'hip hop': { key: 'hip-hop', display: 'Hip-Hop' },
  'hip-hop': { key: 'hip-hop', display: 'Hip-Hop' },
  postpunk: { key: 'post-punk', display: 'Post-Punk' },
  'post punk': { key: 'post-punk', display: 'Post-Punk' },
  'post-punk': { key: 'post-punk', display: 'Post-Punk' },
  postrock: { key: 'post-rock', display: 'Post-Rock' },
  'post rock': { key: 'post-rock', display: 'Post-Rock' },
  'post-rock': { key: 'post-rock', display: 'Post-Rock' },
  indierock: { key: 'indie rock', display: 'Indie Rock' },
  'indie rock': { key: 'indie rock', display: 'Indie Rock' },
  'indie-rock': { key: 'indie rock', display: 'Indie Rock' },
  indiepop: { key: 'indie pop', display: 'Indie Pop' },
  'indie pop': { key: 'indie pop', display: 'Indie Pop' },
  'indie-pop': { key: 'indie pop', display: 'Indie Pop' },
  indiefolk: { key: 'indie folk', display: 'Indie Folk' },
  'indie folk': { key: 'indie folk', display: 'Indie Folk' },
  'indie-folk': { key: 'indie folk', display: 'Indie Folk' },
  altrock: { key: 'alternative rock', display: 'Alternative Rock' },
  'alt rock': { key: 'alternative rock', display: 'Alternative Rock' },
  'alt-rock': { key: 'alternative rock', display: 'Alternative Rock' },
  'alternative rock': { key: 'alternative rock', display: 'Alternative Rock' },
  lofi: { key: 'lo-fi', display: 'Lo-Fi' },
  'lo fi': { key: 'lo-fi', display: 'Lo-Fi' },
  'lo-fi': { key: 'lo-fi', display: 'Lo-Fi' },
  rnb: { key: 'r&b', display: 'R&B' },
  'r&b': { key: 'r&b', display: 'R&B' },
  'r & b': { key: 'r&b', display: 'R&B' },
  'rhythm and blues': { key: 'r&b', display: 'R&B' },
  'rhythm & blues': { key: 'r&b', display: 'R&B' },
  dnb: { key: 'drum & bass', display: 'Drum & Bass' },
  'd&b': { key: 'drum & bass', display: 'Drum & Bass' },
  'drum and bass': { key: 'drum & bass', display: 'Drum & Bass' },
  'drum & bass': { key: 'drum & bass', display: 'Drum & Bass' },
  dreampop: { key: 'dream pop', display: 'Dream Pop' },
  'dream pop': { key: 'dream pop', display: 'Dream Pop' },
  'dream-pop': { key: 'dream pop', display: 'Dream Pop' },
  electropop: { key: 'electropop', display: 'Electropop' },
  'electro pop': { key: 'electropop', display: 'Electropop' },
  'electro-pop': { key: 'electropop', display: 'Electropop' },
  softrock: { key: 'soft rock', display: 'Soft Rock' },
  'soft rock': { key: 'soft rock', display: 'Soft Rock' },
  'soft-rock': { key: 'soft rock', display: 'Soft Rock' },
  hardrock: { key: 'hard rock', display: 'Hard Rock' },
  'hard rock': { key: 'hard rock', display: 'Hard Rock' },
  'hard-rock': { key: 'hard rock', display: 'Hard Rock' },
  poppunk: { key: 'pop punk', display: 'Pop Punk' },
  'pop punk': { key: 'pop punk', display: 'Pop Punk' },
  'pop-punk': { key: 'pop punk', display: 'Pop Punk' },
  newwave: { key: 'new wave', display: 'New Wave' },
  'new wave': { key: 'new wave', display: 'New Wave' },
  'new-wave': { key: 'new wave', display: 'New Wave' },
  singersongwriter: { key: 'singer-songwriter', display: 'Singer-Songwriter' },
  'singer songwriter': { key: 'singer-songwriter', display: 'Singer-Songwriter' },
  'singer-songwriter': { key: 'singer-songwriter', display: 'Singer-Songwriter' },
};

const IGNORED_NOISE_GENRES = new Set([
  'other',
  'unknown',
  'general',
  'music',
  'misc',
  'miscellaneous',
  'unclassified',
  'none',
]);

/**
 * Normalizes a raw genre token into a canonical lowercase comparison key.
 */
export function normalizeGenreKey(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^\(\d+\)\s*/, '') // strip ID3v1 numeric prefix e.g. "(17)Rock"
    .replace(/\s+/g, ' ')
    .toLowerCase();

  if (!cleaned || IGNORED_NOISE_GENRES.has(cleaned)) return '';
  if (/^\d{2,4}s?$/.test(cleaned)) return ''; // ignore decade strings accidentally placed in genre tag

  const mapped = GENRE_CANONICAL_MAP[cleaned];
  if (mapped) return mapped.key;

  const dehyphenated = cleaned.replace(/[-_]+/g, ' ').trim();
  if (GENRE_CANONICAL_MAP[dehyphenated]) {
    return GENRE_CANONICAL_MAP[dehyphenated].key;
  }

  return cleaned;
}

/**
 * Returns a clean human-readable display label for a genre token.
 */
export function canonicalizeGenreDisplay(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^\(\d+\)\s*/, '')
    .replace(/\s+/g, ' ');
  const lower = cleaned.toLowerCase();
  if (!lower || IGNORED_NOISE_GENRES.has(lower)) return '';
  if (/^\d{2,4}s?$/.test(lower)) return '';

  const mapped =
    GENRE_CANONICAL_MAP[lower] ||
    GENRE_CANONICAL_MAP[lower.replace(/[-_]+/g, ' ').trim()];
  if (mapped) return mapped.display;

  return cleaned;
}

/**
 * Splits and normalizes a track's genre string into canonical keys.
 * When `isReissueOrComp` is true (such as a Various Artists compilation or Greatest Hits album
 * with many broad genres), caps to the first 2 primary genres to prevent compilation bleed.
 */
export function extractNormalizedGenreKeys(
  genreStr: string | null | undefined,
  isReissueOrComp = false
): string[] {
  if (!genreStr) return [];
  const parts = genreStr.split(/[,;/|]/);
  const keys: string[] = [];
  for (const part of parts) {
    const key = normalizeGenreKey(part);
    if (key && !keys.includes(key)) {
      keys.push(key);
    }
  }
  if (isReissueOrComp && keys.length > 2) {
    return keys.slice(0, 2);
  }
  return keys;
}

export function extractCanonicalGenreDisplays(
  genreStr: string | null | undefined,
  isReissueOrComp = false
): string[] {
  if (!genreStr) return [];
  const parts = genreStr.split(/[,;/|]/);
  const seenKeys = new Set<string>();
  const displays: string[] = [];
  for (const part of parts) {
    const key = normalizeGenreKey(part);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    const disp = canonicalizeGenreDisplay(part);
    if (disp) displays.push(disp);
  }
  if (isReissueOrComp && displays.length > 2) {
    return displays.slice(0, 2);
  }
  return displays;
}

const REMASTER_OR_REISSUE_REGEX =
  /\b(remaster(?:ed)?|anniversary(?:\s+edition)?|deluxe(?:\s+edition|\s+version)?|expanded(?:\s+edition)?|reissue|special\s+edition|collector'?s\s+edition|legacy\s+edition|super\s+deluxe)\b/i;

const COMPILATION_ALBUM_REGEX =
  /\b(greatest\s+hits|best\s+of|anthology|the\s+collection|essential|complete\s+recordings|retrospective|box\s+set|platinum\s+collection|definitive\s+collection|singles\s+collection|ultimate\s+collection|very\s+best\s+of|now\s+that'?s\s+what\s+i\s+call)\b/i;

const VARIOUS_ARTISTS_REGEX =
  /^(various(?:\s+artists)?|v\.?a\.?|soundtrack|original\s+(?:motion\s+picture\s+)?soundtrack|ost)$/i;

/**
 * Detects whether a track or album carries remaster, reissue, anthology, or compilation markers.
 */
export function detectReissueOrCompilation(input: {
  title?: string | null;
  album?: string | null;
  artist?: string | null;
  albumArtist?: string | null;
}): boolean {
  const title = (input.title || '').trim();
  const album = (input.album || '').trim();
  const albumArtist = (input.albumArtist || '').trim();

  if (albumArtist && VARIOUS_ARTISTS_REGEX.test(albumArtist)) {
    return true;
  }
  if (COMPILATION_ALBUM_REGEX.test(album)) {
    return true;
  }
  if (REMASTER_OR_REISSUE_REGEX.test(album) || REMASTER_OR_REISSUE_REGEX.test(title)) {
    return true;
  }
  return false;
}

/**
 * Extracts a remaster/reissue year when explicitly stated in the title or album name,
 * e.g. "(2018 Remaster)", "[Remastered 2015]", "- 2019 Deluxe Edition".
 */
export function extractExplicitRemasterYear(
  title?: string | null,
  album?: string | null
): number | null {
  const combined = `${title || ''} ${album || ''}`;
  const m1 = combined.match(
    /\b(19\d{2}|20\d{2})\s+(?:digital\s+)?(?:remaster(?:ed)?|reissue|deluxe|anniversary|expanded|mix)\b/i
  );
  if (m1) return parseInt(m1[1], 10);

  const m2 = combined.match(
    /\b(?:remaster(?:ed)?|reissue(?:d)?|deluxe|expanded)\s+(?:in\s+)?(19\d{2}|20\d{2})\b/i
  );
  if (m2) return parseInt(m2[1], 10);

  return null;
}

/**
 * Extracts a non-remaster original year mentioned in album/track titles such as "Neon Horizon (1984)".
 */
export function extractCleanTitleYear(album?: string | null): number | null {
  if (!album) return null;
  if (REMASTER_OR_REISSUE_REGEX.test(album) || COMPILATION_ALBUM_REGEX.test(album)) {
    return null;
  }
  const m = album.match(/[([]\s*(19\d{2}|20\d{2})\s*[)\]]/);
  if (m) {
    const yr = parseInt(m[1], 10);
    if (yr >= 1920 && yr <= 2035) return yr;
  }
  return null;
}

/**
 * Resolves the most accurate original release year for a track and flags whether
 * the track's year tag is likely an unverified modern remaster/compilation year.
 */
export function resolveTrackEraMetadata(input: {
  year: number | null;
  originalYear?: number | null;
  albumYear?: number | null;
  title?: string | null;
  album?: string | null;
  artist?: string | null;
  albumArtist?: string | null;
}): {
  originalYear: number | null;
  effectiveYear: number | null;
  isReissueOrComp: boolean;
  isUnverifiedModernReissue: boolean;
} {
  const isReissueOrComp = detectReissueOrCompilation(input);
  const explicitOrig =
    typeof input.originalYear === 'number' &&
    input.originalYear >= 1900 &&
    input.originalYear <= 2035
      ? input.originalYear
      : null;

  const cleanAlbumTitleYear = extractCleanTitleYear(input.album);
  const remasterStampYear = extractExplicitRemasterYear(input.title, input.album);

  // If explicit originalYear tag exists, trust it
  if (explicitOrig !== null) {
    return {
      originalYear: explicitOrig,
      effectiveYear: explicitOrig,
      isReissueOrComp,
      isUnverifiedModernReissue: false,
    };
  }

  // If both track year and album year exist and one is earlier (e.g. 1978 track on a 2005 compilation)
  if (
    typeof input.year === 'number' &&
    typeof input.albumYear === 'number' &&
    input.year !== input.albumYear
  ) {
    const earlier = Math.min(input.year, input.albumYear);
    if (earlier >= 1900 && earlier <= 2035) {
      return {
        originalYear: earlier,
        effectiveYear: earlier,
        isReissueOrComp,
        isUnverifiedModernReissue: false,
      };
    }
  }

  // If album title has a clean original year like "Neon Horizon (1984)"
  if (cleanAlbumTitleYear !== null) {
    const tagYear = input.year ?? input.albumYear ?? null;
    if (tagYear === null || cleanAlbumTitleYear <= tagYear) {
      return {
        originalYear: cleanAlbumTitleYear,
        effectiveYear: cleanAlbumTitleYear,
        isReissueOrComp,
        isUnverifiedModernReissue: false,
      };
    }
  }

  const fallbackYear = input.year ?? input.albumYear ?? null;

  // Check if the only available year is actually a modern remaster/compilation reissue stamp
  let isUnverifiedModernReissue = false;
  if (fallbackYear !== null && isReissueOrComp) {
    if (remasterStampYear !== null && fallbackYear === remasterStampYear) {
      isUnverifiedModernReissue = true;
    } else if (
      COMPILATION_ALBUM_REGEX.test(input.album || '') &&
      fallbackYear >= 1995
    ) {
      isUnverifiedModernReissue = true;
    } else if (
      REMASTER_OR_REISSUE_REGEX.test(input.album || '') &&
      fallbackYear >= 2000
    ) {
      isUnverifiedModernReissue = true;
    }
  }

  return {
    originalYear: isUnverifiedModernReissue ? null : fallbackYear,
    effectiveYear: fallbackYear,
    isReissueOrComp,
    isUnverifiedModernReissue,
  };
}

const CHILL_KEYWORDS_REGEX =
  /\b(acoustic|unplugged|ballad|ambient|chill|chillout|chillwave|downtempo|lullaby|nocturne|piano|lounge|lo-fi|lofi|slow|slowcore|mellow|soft|dream\s*pop|shoegaze|classical|instrumental|meditation|sleep|peaceful|quiet|intimate|calm|relax(?:ed|ing)?|late\s+night|after\s+hours|bossa\s+nova|cool\s+jazz|folk|singer-songwriter|chamber|prelude|interlude|adagio|andante|moonlight|sunset|twilight|rain|autumn|velvet|golden\s+hour|whisper|harbor|satellites)\b/i;

const UPBEAT_KEYWORDS_REGEX =
  /\b(upbeat|energetic|party|club(?:\s+mix)?|dance|edm|house|techno|trance|drum\s*(?:&|and)\s*bass|dnb|dubstep|hardcore|hardstyle|hyperpop|punk|pop\s*punk|thrash|speed\s+metal|heavy\s+metal|workout|running|cardio|anthem|banger|rave|disco|funk|ska|fast|aggressive|high\s+energy|festival|extended\s+mix|velocity|hyperion|runner|subzero|telegraphs)\b/i;

const CHILL_GENRES_SET = new Set([
  'ambient',
  'chillwave',
  'chillout',
  'chill',
  'downtempo',
  'lo-fi',
  'lounge',
  'classical',
  'folk',
  'indie folk',
  'singer-songwriter',
  'dream pop',
  'shoegaze',
  'slowcore',
  'soft rock',
  'jazz',
  'bossa nova',
  'acoustic',
  'new age',
  'soundtrack',
  'blues',
  'soul',
]);

const UPBEAT_GENRES_SET = new Set([
  'dance',
  'edm',
  'house',
  'techno',
  'trance',
  'drum & bass',
  'dubstep',
  'hardcore',
  'hyperpop',
  'punk',
  'pop punk',
  'metal',
  'heavy metal',
  'thrash metal',
  'hard rock',
  'disco',
  'funk',
  'ska',
  'club',
]);

/**
 * Computes a deterministic 3-tier energy profile for a track:
 *   1 = Quiet / Slow / Chill (preferred during 8:00 PM – 6:00 AM overnight dayparting)
 *   2 = Balanced / Mid-Tempo
 *   3 = Upbeat / High-Energy
 */
export function computeTrackEnergyLevel(input: {
  title?: string | null;
  album?: string | null;
  genre?: string | null;
  mood?: string | null;
  bpm?: number | null;
  durationMs?: number | null;
}): TrackEnergyLevel {
  const title = (input.title || '').trim();
  const album = (input.album || '').trim();
  const mood = (input.mood || '').trim();
  const genre = (input.genre || '').trim();

  // 1. Explicit track title or mood overrides (e.g. "Acoustic Version", "Piano Ballad", "Club Mix")
  const titleAndMood = `${title} ${mood}`;
  const hasChillCue = CHILL_KEYWORDS_REGEX.test(titleAndMood);
  const hasUpbeatCue = UPBEAT_KEYWORDS_REGEX.test(titleAndMood);

  if (hasChillCue && !hasUpbeatCue) {
    return 1;
  }
  if (hasUpbeatCue && !hasChillCue) {
    return 3;
  }

  // 2. Explicit BPM tag when available
  if (typeof input.bpm === 'number' && Number.isFinite(input.bpm) && input.bpm > 0) {
    if (input.bpm <= 96) return 1;
    if (input.bpm >= 122) return 3;
  }

  // 3. Genre & Album mood cues
  const genreKeys = extractNormalizedGenreKeys(genre, false);
  let chillGenreVotes = 0;
  let upbeatGenreVotes = 0;
  for (const gk of genreKeys) {
    if (CHILL_GENRES_SET.has(gk)) chillGenreVotes += 1;
    if (UPBEAT_GENRES_SET.has(gk)) upbeatGenreVotes += 1;
  }

  if (CHILL_KEYWORDS_REGEX.test(album)) chillGenreVotes += 1;
  if (UPBEAT_KEYWORDS_REGEX.test(album)) upbeatGenreVotes += 1;

  if (chillGenreVotes > upbeatGenreVotes) return 1;
  if (upbeatGenreVotes > chillGenreVotes) return 3;

  // 4. Default balanced mid-tempo
  return 2;
}

/**
 * Returns true if the given wall-clock hour (0–23) or timestamp (ms) falls in the standard
 * overnight radio dayparting window (8:00 PM – 6:00 AM local server time).
 */
export function isOvernightDaypartHour(hourOrTimeMs: number): boolean {
  const hour =
    hourOrTimeMs >= 0 && hourOrTimeMs < 24
      ? Math.floor(hourOrTimeMs)
      : new Date(hourOrTimeMs).getHours();
  return hour >= 20 || hour < 6;
}

/**
 * Partitions a station's matching track pool into Daytime (6:00 AM – 8:00 PM)
 * and Overnight Chill (8:00 PM – 6:00 AM) pools with graceful fallback for small libraries.
 */
export function partitionDaypartTrackPools(
  matchingTracks: readonly TrackRecord[]
): {
  dayPool: TrackRecord[];
  nightPool: TrackRecord[];
  chillCount: number;
  balancedCount: number;
  upbeatCount: number;
} {
  const chillTracks: TrackRecord[] = [];
  const balancedTracks: TrackRecord[] = [];
  const upbeatTracks: TrackRecord[] = [];

  for (const t of matchingTracks) {
    const level =
      t.energyLevel ??
      computeTrackEnergyLevel({
        title: t.title,
        album: t.album,
        genre: t.genre,
        mood: t.mood,
        bpm: t.bpm,
        durationMs: t.durationMs,
      });

    if (level === 1) {
      chillTracks.push(t);
    } else if (level === 3) {
      upbeatTracks.push(t);
    } else {
      balancedTracks.push(t);
    }
  }

  // Overnight Pool (8:00 PM – 6:00 AM):
  // Prefers energyLevel === 1 (Quiet/Slow). If fewer than 3 tracks are strictly level 1,
  // blends in balanced tracks (energyLevel <= 2) so the station has healthy overnight variety.
  // If still empty, falls back to the full station catalog.
  let nightPool: TrackRecord[];
  if (chillTracks.length >= 3 || (chillTracks.length > 0 && matchingTracks.length <= 4)) {
    nightPool = chillTracks;
  } else if (chillTracks.length + balancedTracks.length > 0) {
    nightPool = [...chillTracks, ...balancedTracks];
  } else {
    nightPool = [...matchingTracks];
  }

  // Daytime Pool (6:00 AM – 8:00 PM):
  // Prefers balanced + upbeat tracks (energyLevel >= 2) when abundant, or uses the full pool
  // so no tracks are starved on small stations.
  const midAndUpbeat = [...balancedTracks, ...upbeatTracks];
  const dayPool =
    midAndUpbeat.length >= 3 ? midAndUpbeat : [...matchingTracks];

  return {
    dayPool,
    nightPool,
    chillCount: chillTracks.length,
    balancedCount: balancedTracks.length,
    upbeatCount: upbeatTracks.length,
  };
}
