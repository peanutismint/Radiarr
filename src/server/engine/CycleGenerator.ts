import { PlayMode, StationRules, TrackRecord } from '../../shared/types.ts';
import { createPrng, deriveCycleSeed, seededShuffle } from './prng.ts';

function compareNullableYear(a: number | null, b: number | null): number {
  const ya = a ?? 99999;
  const yb = b ?? 99999;
  return ya - yb;
}

function fastStringCompare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Generates the exact ordered track sequence for one full cycle of a station or daypart segment.
 *
 * Play modes (Section 5.2):
 * - 'straight':
 *     - If rules specify artist(s): albums by release year (ties by album title), tracks by disc and track number.
 *     - Otherwise (genre/era): sorted by year, album, then disc and track number.
 * - 'album_shuffle':
 *     - Albums in seeded random order, but each album plays start to finish in disc/track order.
 * - 'shuffle':
 *     - Seeded random tracks ("shuffle bag": no track repeats within a cycle until every eligible track has played once).
 */
export function generateCycleTracks(
  stationSeed: number,
  segmentId: string,
  cycleNumber: number,
  playMode: PlayMode,
  rules: StationRules,
  matchingTracks: readonly TrackRecord[]
): TrackRecord[] {
  if (matchingTracks.length === 0) {
    return [];
  }

  if (playMode === 'straight') {
    const isArtistStation = Boolean(rules.artists && rules.artists.length > 0);
    const sorted = [...matchingTracks];
    sorted.sort((a, b) => {
      const yearA = isArtistStation ? (a.albumYear ?? a.year) : (a.year ?? a.albumYear);
      const yearB = isArtistStation ? (b.albumYear ?? b.year) : (b.year ?? b.albumYear);
      const yearCmp = compareNullableYear(yearA, yearB);
      if (yearCmp !== 0) return yearCmp;

      const albumCmp = fastStringCompare(a.album.toLowerCase(), b.album.toLowerCase());
      if (albumCmp !== 0) return albumCmp;

      if (a.discNumber !== b.discNumber) return a.discNumber - b.discNumber;
      if (a.trackNumber !== b.trackNumber) return a.trackNumber - b.trackNumber;
      return fastStringCompare(a.id, b.id);
    });
    return sorted;
  }

  if (playMode === 'album_shuffle') {
    // Group tracks by albumId and sort tracks within each album by disc and track number
    const albumGroups = new Map<string, TrackRecord[]>();
    for (const track of matchingTracks) {
      let group = albumGroups.get(track.albumId);
      if (!group) {
        group = [];
        albumGroups.set(track.albumId, group);
      }
      group.push(track);
    }

    const canonicalAlbumIds = [...albumGroups.keys()].sort();
    for (const id of canonicalAlbumIds) {
      const group = albumGroups.get(id)!;
      group.sort((a, b) => {
        if (a.discNumber !== b.discNumber) return a.discNumber - b.discNumber;
        if (a.trackNumber !== b.trackNumber) return a.trackNumber - b.trackNumber;
        return fastStringCompare(a.id, b.id);
      });
    }

    const cycleSeed = deriveCycleSeed(stationSeed, segmentId, cycleNumber);
    const prng = createPrng(cycleSeed);
    const shuffledAlbumIds = seededShuffle(canonicalAlbumIds, prng);

    // Avoid repeating the exact same album across a cycle boundary when there are multiple albums
    if (canonicalAlbumIds.length > 1) {
      const prevSeed = deriveCycleSeed(stationSeed, segmentId, cycleNumber - 1);
      const prevShuffledIds = seededShuffle(canonicalAlbumIds, createPrng(prevSeed));
      const lastAlbumPrevCycle = prevShuffledIds[prevShuffledIds.length - 1];
      if (shuffledAlbumIds[0] === lastAlbumPrevCycle) {
        const tmp = shuffledAlbumIds[0];
        shuffledAlbumIds[0] = shuffledAlbumIds[1];
        shuffledAlbumIds[1] = tmp;
      }
    }

    const result: TrackRecord[] = [];
    for (const albumId of shuffledAlbumIds) {
      result.push(...albumGroups.get(albumId)!);
    }
    return result;
  }

  // 'shuffle' mode (shuffle bag)
  const canonicalTracks = [...matchingTracks].sort((a, b) => fastStringCompare(a.id, b.id));
  const cycleSeed = deriveCycleSeed(stationSeed, segmentId, cycleNumber);
  const shuffled = seededShuffle(canonicalTracks, createPrng(cycleSeed));

  // Avoid playing the exact same track twice in a row at the boundary between cycleNumber - 1 and cycleNumber
  if (canonicalTracks.length > 1) {
    const prevSeed = deriveCycleSeed(stationSeed, segmentId, cycleNumber - 1);
    const prevShuffled = seededShuffle(canonicalTracks, createPrng(prevSeed));
    const lastTrackPrevCycle = prevShuffled[prevShuffled.length - 1];
    if (shuffled[0].id === lastTrackPrevCycle.id) {
      const tmp = shuffled[0];
      shuffled[0] = shuffled[1];
      shuffled[1] = tmp;
    }
  }

  return shuffled;
}
