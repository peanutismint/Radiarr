import { parseFile } from 'music-metadata';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  computeTrackEnergyLevel,
  extractCanonicalGenreDisplays,
  resolveTrackEraMetadata,
} from '../../shared/metadataNormalizer.ts';
import type { TrackEnergyLevel } from '../../shared/types.ts';

const execFileAsync = promisify(execFile);

export interface ProbedTrackMetadata {
  title: string;
  artist: string;
  albumArtist: string | null;
  album: string;
  trackNumber: number;
  discNumber: number;
  year: number | null;
  originalYear: number | null;
  genre: string | null;
  bpm: number | null;
  mood: string | null;
  energyLevel: TrackEnergyLevel;
  isReissueOrComp: boolean;
  gainDb: number | null;
  durationMs: number;
  hasEmbeddedArt: boolean;
  embeddedPictureData?: Uint8Array;
  tagsIncomplete: boolean;
  missingFields: string[];
}

interface FfprobeStream {
  codec_type?: string;
  duration?: string;
  disposition?: {
    attached_pic?: number;
  };
  tags?: Record<string, string>;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: {
    duration?: string;
    tags?: Record<string, string>;
  };
}

function findTag(tags: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const val = tags[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

function parseLeadingInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const match = raw.match(/^\s*(\d+)/);
  if (!match) return fallback;
  const parsed = parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseYear(raw: string | null): number | null {
  if (!raw) return null;
  const match = raw.match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

function parseBpm(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 20 && raw < 300) {
    return Math.round(raw);
  }
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = parseFloat(raw.trim());
    if (Number.isFinite(parsed) && parsed > 20 && parsed < 300) {
      return Math.round(parsed);
    }
  }
  return null;
}

function buildMetadataFromExtracted(
  filePath: string,
  libraryRootPath: string,
  rawTitle: string | null,
  rawArtist: string | null,
  rawAlbumArtist: string | null,
  rawAlbum: string | null,
  rawTrackNum: number | null,
  rawDiscNum: number | null,
  releaseYear: number | null,
  explicitOrigYear: number | null,
  rawGenre: string | null,
  rawBpm: number | null,
  rawMood: string | null,
  durationMs: number,
  hasEmbeddedArt: boolean,
  embeddedPictureData?: Uint8Array,
  gainDb: number | null = null
): ProbedTrackMetadata {
  const relPath = path.relative(libraryRootPath, filePath);
  const parts = relPath.split(path.sep);
  const fileBaseName = path.basename(filePath, path.extname(filePath));
  const cleanedBaseName =
    fileBaseName.replace(/^\d+[\s._-]+/, '').trim() || fileBaseName;

  const parentFolder = parts.length >= 2 ? parts[parts.length - 2] : 'Unknown Album';
  const grandParentFolder =
    parts.length >= 3
      ? parts[parts.length - 3]
      : parts.length >= 2
        ? parts[0]
        : 'Unknown Artist';

  const title = rawTitle || cleanedBaseName;
  const artist = rawArtist || rawAlbumArtist || grandParentFolder;
  const album = rawAlbum || parentFolder;

  const eraMeta = resolveTrackEraMetadata({
    year: releaseYear,
    originalYear: explicitOrigYear,
    albumYear: releaseYear,
    title,
    album,
    artist,
    albumArtist: rawAlbumArtist,
  });

  const year = eraMeta.originalYear ?? eraMeta.effectiveYear;
  const canonicalGenres = extractCanonicalGenreDisplays(
    rawGenre,
    eraMeta.isReissueOrComp
  );
  const cleanedGenre =
    canonicalGenres.length > 0 ? canonicalGenres.join(', ') : rawGenre;

  const missingFields: string[] = [];
  if (!rawTitle) missingFields.push('title');
  if (!rawArtist && !rawAlbumArtist) missingFields.push('artist');
  if (!rawAlbum) missingFields.push('album');
  if (rawTrackNum === null) missingFields.push('track');
  if (year === null) missingFields.push('year');
  if (!cleanedGenre) missingFields.push('genre');

  const filenameTrackMatch = fileBaseName.match(/^(\d{1,3})[\s._-]/);
  const fallbackTrackNum = filenameTrackMatch
    ? parseInt(filenameTrackMatch[1], 10)
    : 1;
  const trackNumber =
    rawTrackNum && rawTrackNum > 0 ? rawTrackNum : fallbackTrackNum;
  const discNumber = rawDiscNum && rawDiscNum > 0 ? rawDiscNum : 1;

  const energyLevel = computeTrackEnergyLevel({
    title,
    album,
    genre: cleanedGenre,
    mood: rawMood,
    bpm: rawBpm,
    durationMs,
  });

  return {
    title,
    artist,
    albumArtist: rawAlbumArtist,
    album,
    trackNumber,
    discNumber,
    year,
    originalYear: eraMeta.originalYear,
    genre: cleanedGenre,
    bpm: rawBpm,
    mood: rawMood,
    energyLevel,
    isReissueOrComp: eraMeta.isReissueOrComp,
    gainDb,
    durationMs,
    hasEmbeddedArt,
    embeddedPictureData,
    tagsIncomplete: missingFields.length > 0,
    missingFields,
  };
}

export async function probeAudioFile(
  filePath: string,
  libraryRootPath: string
): Promise<ProbedTrackMetadata> {
  // Fast Path: In-process header & tag reader (music-metadata) - avoids spawning OS subprocesses per file
  try {
    const mm = await parseFile(filePath, {
      duration: true,
      skipPostHeaders: true,
    });
    const durSec = mm.format.duration;
    if (typeof durSec === 'number' && Number.isFinite(durSec) && durSec > 0) {
      const durationMs = Math.max(1, Math.round(durSec * 1000));
      const c = mm.common;
      const rawTitle = c.title?.trim() || null;
      const rawArtist = c.artist?.trim() || (c.artists && c.artists[0]?.trim()) || null;
      const rawAlbumArtist = c.albumartist?.trim() || null;
      const rawAlbum = c.album?.trim() || null;
      const rawTrackNum =
        typeof c.track?.no === 'number' && c.track.no > 0 ? c.track.no : null;
      const rawDiscNum =
        typeof c.disk?.no === 'number' && c.disk.no > 0 ? c.disk.no : null;

      const origYear =
        typeof c.originalyear === 'number'
          ? c.originalyear
          : parseYear(c.originaldate || null);
      const releaseYear =
        typeof c.year === 'number' ? c.year : parseYear(c.date || null);

      const rawGenre =
        c.genre && c.genre.length > 0
          ? c.genre
              .map((g) => g.trim())
              .filter(Boolean)
              .join(', ') || null
          : null;

      const rawBpm = parseBpm(c.bpm);
      const moodParts: string[] = [];
      if (typeof c.mood === 'string' && c.mood.trim()) {
        moodParts.push(c.mood.trim());
      }
      if (Array.isArray(c.grouping) && c.grouping.length > 0) {
        moodParts.push(...c.grouping.map((g) => String(g).trim()).filter(Boolean));
      } else if (typeof c.grouping === 'string' && c.grouping.trim()) {
        moodParts.push(c.grouping.trim());
      }
      const rawMood = moodParts.length > 0 ? moodParts.join('; ') : null;

      // Extract ReplayGain / R128 track loudness tag if present
      let gainDb: number | null = null;
      if (c.replaygain_track_gain) {
        if (typeof c.replaygain_track_gain.dB === 'number' && Number.isFinite(c.replaygain_track_gain.dB)) {
          gainDb = c.replaygain_track_gain.dB;
        } else if (typeof c.replaygain_track_gain.ratio === 'number' && c.replaygain_track_gain.ratio > 0) {
          gainDb = Math.round(20 * Math.log10(c.replaygain_track_gain.ratio) * 10) / 10;
        }
      }
      if (gainDb === null && mm.native) {
        for (const tagList of Object.values(mm.native)) {
          for (const tag of tagList) {
            if (tag.id && tag.value && typeof tag.value === 'string') {
              const idLower = tag.id.toLowerCase();
              if (idLower.includes('replaygain_track_gain') || idLower.includes('r128_track_gain')) {
                const m = tag.value.match(/([+-]?\d+(?:\.\d+)?)/);
                if (m) {
                  const parsed = parseFloat(m[1]);
                  if (Number.isFinite(parsed) && parsed > -40 && parsed < 40) {
                    gainDb = parsed;
                    break;
                  }
                }
              }
            }
          }
          if (gainDb !== null) break;
        }
      }

      const firstPic = c.picture?.[0];
      const hasEmbeddedArt = Boolean(firstPic && firstPic.data?.length);

      return buildMetadataFromExtracted(
        filePath,
        libraryRootPath,
        rawTitle,
        rawArtist,
        rawAlbumArtist,
        rawAlbum,
        rawTrackNum,
        rawDiscNum,
        releaseYear ?? origYear ?? null,
        origYear ?? null,
        rawGenre,
        rawBpm,
        rawMood,
        durationMs,
        hasEmbeddedArt,
        firstPic?.data,
        gainDb
      );
    }
  } catch {
    // Fall through to ffprobe subprocess fallback if header lacks duration or cannot be parsed by music-metadata
  }

  // Fallback Path: ffprobe CLI subprocess
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'quiet',
      '-probesize',
      '256k',
      '-analyzeduration',
      '0',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ],
    { timeout: 15000 }
  );

  const parsed: FfprobeOutput = JSON.parse(stdout);
  const streams = parsed.streams || [];
  const audioStream = streams.find((s) => s.codec_type === 'audio');

  if (!audioStream) {
    throw new Error('No playable audio stream found');
  }

  // Measure duration from the audio stream or container format
  const streamDurSec = audioStream.duration ? parseFloat(audioStream.duration) : NaN;
  const formatDurSec = parsed.format?.duration ? parseFloat(parsed.format.duration) : NaN;
  const durationSec = Number.isFinite(streamDurSec) && streamDurSec > 0 ? streamDurSec : formatDurSec;

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error('Could not measure valid audio duration');
  }

  const durationMs = Math.max(1, Math.round(durationSec * 1000));

  // Normalize all tags from both format and audio stream (Ogg/Opus often store tags on the stream)
  const normalizedTags: Record<string, string> = {};
  if (audioStream.tags) {
    for (const [k, v] of Object.entries(audioStream.tags)) {
      if (typeof v === 'string') normalizedTags[k.toLowerCase()] = v;
    }
  }
  if (parsed.format?.tags) {
    for (const [k, v] of Object.entries(parsed.format.tags)) {
      if (typeof v === 'string') normalizedTags[k.toLowerCase()] = v;
    }
  }

  const rawTitle = findTag(normalizedTags, ['title', 'nam', '©nam']);
  const rawArtist = findTag(normalizedTags, ['artist', 'author', '©art', 'performer']);
  const rawAlbumArtist = findTag(normalizedTags, [
    'album_artist',
    'albumartist',
    'aart',
    'wm/albumartist',
    'tpe2',
  ]);
  const rawAlbum = findTag(normalizedTags, ['album', '©alb', 'wm/albumtitle']);
  const rawTrack = findTag(normalizedTags, ['track', 'tracknumber', 'trkn', 'wm/tracknumber']);
  const rawDisc = findTag(normalizedTags, ['disc', 'discnumber', 'disk', 'tpos', 'wm/partofset']);

  // Prefer original release year if present, otherwise year/date tag
  const rawOrigYear = findTag(normalizedTags, [
    'originalyear',
    'originaldate',
    'tdor',
    'tory',
    'wm/originalreleaseyear',
  ]);
  const rawYear = findTag(normalizedTags, ['date', 'year', 'tyer', 'tdrc', '©day', 'wm/year']);
  const parsedOrigYear = parseYear(rawOrigYear);
  const parsedReleaseYear = parseYear(rawYear);

  const rawGenre = findTag(normalizedTags, ['genre', '©gen', 'wm/genre']);
  const rawBpmStr = findTag(normalizedTags, ['bpm', 'tbpm', 'tmpo', 'wm/beatsperminute']);
  const rawMood = findTag(normalizedTags, ['mood', 'tmoo', 'style', 'grouping', 'contentgroup', 'tit1']);

  const hasEmbeddedArt = streams.some(
    (s) => s.codec_type === 'video' || s.disposition?.attached_pic === 1
  );

  const parsedTrackNum = rawTrack ? parseLeadingInt(rawTrack, 0) : null;
  const parsedDiscNum = rawDisc ? parseLeadingInt(rawDisc, 0) : null;

  const rawGainStr = findTag(normalizedTags, [
    'replaygain_track_gain',
    'r128_track_gain',
    'replaygain_album_gain',
  ]);
  let fallbackGainDb: number | null = null;
  if (rawGainStr) {
    const m = rawGainStr.match(/([+-]?\d+(?:\.\d+)?)/);
    if (m) {
      const parsed = parseFloat(m[1]);
      if (Number.isFinite(parsed) && parsed > -40 && parsed < 40) {
        fallbackGainDb = parsed;
      }
    }
  }

  return buildMetadataFromExtracted(
    filePath,
    libraryRootPath,
    rawTitle,
    rawArtist,
    rawAlbumArtist,
    rawAlbum,
    parsedTrackNum && parsedTrackNum > 0 ? parsedTrackNum : null,
    parsedDiscNum && parsedDiscNum > 0 ? parsedDiscNum : null,
    parsedReleaseYear ?? parsedOrigYear ?? null,
    parsedOrigYear ?? null,
    rawGenre,
    parseBpm(rawBpmStr),
    rawMood,
    durationMs,
    hasEmbeddedArt,
    undefined,
    fallbackGainDb
  );
}

