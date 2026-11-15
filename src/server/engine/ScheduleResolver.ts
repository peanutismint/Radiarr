import {
  computeTrackEnergyLevel,
  isOvernightDaypartHour,
  partitionDaypartTrackPools,
} from '../../shared/metadataNormalizer.ts';
import {
  DIRECT_PLAY_EXTENSIONS,
  ScheduledTrackSlot,
  StationRecord,
  TrackRecord,
} from '../../shared/types.ts';
import { generateCycleTracks } from './CycleGenerator.ts';

const DIRECT_PLAY_SET = new Set<string>(DIRECT_PLAY_EXTENSIONS);

export interface ResolvedPlaybackState {
  current: ScheduledTrackSlot;
  positionMs: number;
  previous: ScheduledTrackSlot;
  next: ScheduledTrackSlot;
}

export function getEffectiveSlotDurationMs(
  trackDurationMs: number,
  station: Pick<StationRecord, 'crossfadeEnabled' | 'crossfadeSeconds'>
): number {
  if (!station.crossfadeEnabled || !(station.crossfadeSeconds > 0)) {
    return trackDurationMs;
  }
  const fadeMs = Math.round(station.crossfadeSeconds * 1000);
  // Only overlap if the track is at least 3x the crossfade duration so short tracks/interludes play normally
  if (trackDurationMs <= fadeMs * 3) {
    return trackDurationMs;
  }
  return trackDurationMs - fadeMs;
}

export function toScheduledSlot(
  track: TrackRecord,
  startMs: number,
  cycleNumber: number,
  indexInCycle: number,
  segmentId = 'base',
  slotDurationMs = track.durationMs
): ScheduledTrackSlot {
  const directPlay = DIRECT_PLAY_SET.has(track.ext.toLowerCase());
  const energyLevel =
    track.energyLevel ??
    computeTrackEnergyLevel({
      title: track.title,
      album: track.album,
      genre: track.genre,
      mood: track.mood,
      bpm: track.bpm,
      durationMs: track.durationMs,
    });

  return {
    track: {
      id: track.id,
      albumId: track.albumId,
      title: track.title,
      artist: track.artist,
      album: track.album,
      trackNumber: track.trackNumber,
      albumTrackCount: track.albumTrackCount || 1,
      year: track.originalYear ?? track.year ?? track.albumYear,
      originalYear: track.originalYear ?? null,
      genre: track.genre,
      energyLevel,
      gainDb: track.gainDb ?? null,
      durationMs: track.durationMs,
      ext: track.ext,
      directPlay,
      hasArt: track.hasArt,
      artUrl: track.hasArt ? `/api/art/${track.albumId}` : null,
      audioUrl: `/api/audio/${track.id}`,
    },
    startMs,
    endMs: startMs + slotDurationMs,
    cycleNumber,
    indexInCycle,
    daypartId: segmentId === 'night' || segmentId === 'day' ? segmentId : undefined,
  };
}

/**
 * Generates contiguous daypart-aware track slots covering `[fromMs, toMs]` (plus 1 slot before and 1 slot after)
 * when `station.daypartsEnabled === true`.
 * Between 8:00 PM and 6:00 AM local server time, slots draw from the station's Overnight Chill pool (`segmentId = 'night'`).
 * Between 6:00 AM and 8:00 PM, slots draw from the station's Daytime pool (`segmentId = 'day'`).
 * Transitions always occur cleanly at song boundaries so a playing track is never cut off at 8:00 PM or 6:00 AM.
 */
function resolveDaypartSlotsRange(
  station: StationRecord,
  matchingTracks: readonly TrackRecord[],
  fromMs: number,
  toMs: number
): ScheduledTrackSlot[] {
  const { dayPool, nightPool } = partitionDaypartTrackPools(matchingTracks);
  if (dayPool.length === 0 || nightPool.length === 0) {
    return [];
  }

  const cycleCache = new Map<string, TrackRecord[]>();
  const getCycle = (seg: 'day' | 'night', cycleNum: number): TrackRecord[] => {
    const key = `${seg}:${cycleNum}`;
    let cached = cycleCache.get(key);
    if (!cached) {
      const pool = seg === 'night' ? nightPool : dayPool;
      cached = generateCycleTracks(
        station.seed,
        seg,
        cycleNum,
        station.playMode,
        station.rules,
        pool
      );
      cycleCache.set(key, cached);
    }
    return cached;
  };

  // Anchor within 24 hours of fromMs using exact 24-hour steps from station.epochMs
  // so local time-of-day (8 PM - 6 AM) alignment is preserved and resolution is instant O(1)
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  let effectiveEpochMs = station.epochMs;
  if (fromMs - effectiveEpochMs > ONE_DAY_MS) {
    const jumps = Math.floor((fromMs - effectiveEpochMs) / ONE_DAY_MS);
    effectiveEpochMs += jumps * ONE_DAY_MS;
  } else if (effectiveEpochMs - toMs > ONE_DAY_MS) {
    const jumps = Math.floor((effectiveEpochMs - toMs) / ONE_DAY_MS);
    effectiveEpochMs -= jumps * ONE_DAY_MS;
  }

  const backwardSlots: ScheduledTrackSlot[] = [];
  if (fromMs <= effectiveEpochMs) {
    let cursorEndMs = effectiveEpochMs;
    const revState = {
      day: { cycleNumber: -1, indexInCycle: getCycle('day', -1).length - 1 },
      night: { cycleNumber: -1, indexInCycle: getCycle('night', -1).length - 1 },
    };

    // Walk backward until we have at least one slot before `fromMs`
    let guard = 0;
    while (guard < 10000) {
      guard += 1;
      const seg: 'day' | 'night' = isOvernightDaypartHour(
        new Date(cursorEndMs - 1).getHours()
      )
        ? 'night'
        : 'day';
      const cur = revState[seg];
      const tracks = getCycle(seg, cur.cycleNumber);
      const track = tracks[cur.indexInCycle];
      const dur = Math.max(1000, getEffectiveSlotDurationMs(track.durationMs, station));
      const startMs = cursorEndMs - dur;
      const slot = toScheduledSlot(
        track,
        startMs,
        cur.cycleNumber,
        cur.indexInCycle,
        seg,
        dur
      );
      backwardSlots.push(slot);

      cur.indexInCycle -= 1;
      if (cur.indexInCycle < 0) {
        cur.cycleNumber -= 1;
        cur.indexInCycle = getCycle(seg, cur.cycleNumber).length - 1;
      }

      const coveredOneBefore = startMs < fromMs && backwardSlots.length >= 2;
      cursorEndMs = startMs;
      if (coveredOneBefore) {
        break;
      }
    }
    backwardSlots.reverse();
  }

  const forwardSlots: ScheduledTrackSlot[] = [];
  let cursorStartMs = effectiveEpochMs;
  const fwdState = {
    day: { cycleNumber: 0, indexInCycle: 0 },
    night: { cycleNumber: 0, indexInCycle: 0 },
  };

  let prevForwardSlot: ScheduledTrackSlot | null = null;
  let guard = 0;
  while (guard < 20000) {
    guard += 1;
    const seg: 'day' | 'night' = isOvernightDaypartHour(
      new Date(cursorStartMs).getHours()
    )
      ? 'night'
      : 'day';
    const cur = fwdState[seg];
    const tracks = getCycle(seg, cur.cycleNumber);
    const track = tracks[cur.indexInCycle];
    const dur = Math.max(1000, getEffectiveSlotDurationMs(track.durationMs, station));
    const slot = toScheduledSlot(
      track,
      cursorStartMs,
      cur.cycleNumber,
      cur.indexInCycle,
      seg,
      dur
    );

    if (slot.endMs > fromMs) {
      if (forwardSlots.length === 0 && prevForwardSlot && backwardSlots.length === 0) {
        forwardSlots.push(prevForwardSlot);
      }
      forwardSlots.push(slot);
    } else {
      prevForwardSlot = slot;
    }

    cur.indexInCycle += 1;
    if (cur.indexInCycle >= tracks.length) {
      cur.cycleNumber += 1;
      cur.indexInCycle = 0;
    }

    const hadSlotAfterTo = cursorStartMs >= toMs && forwardSlots.length >= 2;
    cursorStartMs = slot.endMs;
    if (hadSlotAfterTo) {
      break;
    }
  }

  return [...backwardSlots, ...forwardSlots];
}

/**
 * Resolves the exact track playing at `targetTimeMs` (plus the immediately preceding
 * and following tracks).
 *
 * When `station.daypartsEnabled` is false, uses O(1) cycle modulo arithmetic.
 * When `station.daypartsEnabled` is true, resolves via the deterministic 8 PM – 6 AM
 * daypart schedule so overnight hours automatically prefer quieter/slower songs.
 */
export function resolveStationAtTime(
  station: StationRecord,
  matchingTracks: readonly TrackRecord[],
  targetTimeMs: number
): ResolvedPlaybackState | null {
  if (matchingTracks.length === 0) {
    return null;
  }

  if (station.daypartsEnabled) {
    const slots = resolveDaypartSlotsRange(
      station,
      matchingTracks,
      targetTimeMs,
      targetTimeMs + 1
    );
    const currentIdx = slots.findIndex(
      (s) => s.startMs <= targetTimeMs && s.endMs > targetTimeMs
    );
    if (currentIdx !== -1) {
      const current = slots[currentIdx];
      const previous = slots[Math.max(0, currentIdx - 1)];
      const next = slots[Math.min(slots.length - 1, currentIdx + 1)];
      return {
        current,
        positionMs: Math.max(0, targetTimeMs - current.startMs),
        previous,
        next,
      };
    }
  }

  const cycleDurationMs = matchingTracks.reduce(
    (sum, t) => sum + getEffectiveSlotDurationMs(t.durationMs, station),
    0
  );
  if (cycleDurationMs <= 0) {
    return null;
  }

  const elapsedMs = targetTimeMs - station.epochMs;
  const cycleNumber = Math.floor(elapsedMs / cycleDurationMs);
  const offsetInCycleMs = ((elapsedMs % cycleDurationMs) + cycleDurationMs) % cycleDurationMs;

  const cycleTracks = generateCycleTracks(
    station.seed,
    'base',
    cycleNumber,
    station.playMode,
    station.rules,
    matchingTracks
  );

  let accumulatedMs = 0;
  let currentIndex = 0;
  let currentStartInCycleMs = 0;

  for (let i = 0; i < cycleTracks.length; i++) {
    const dur = getEffectiveSlotDurationMs(cycleTracks[i].durationMs, station);
    if (accumulatedMs + dur > offsetInCycleMs || i === cycleTracks.length - 1) {
      currentIndex = i;
      currentStartInCycleMs = accumulatedMs;
      break;
    }
    accumulatedMs += dur;
  }

  const cycleStartMs = station.epochMs + cycleNumber * cycleDurationMs;
  const currentTrack = cycleTracks[currentIndex];
  const currentStartMs = cycleStartMs + currentStartInCycleMs;
  const currentSlotDurationMs = getEffectiveSlotDurationMs(currentTrack.durationMs, station);
  const currentSlot = toScheduledSlot(
    currentTrack,
    currentStartMs,
    cycleNumber,
    currentIndex,
    'base',
    currentSlotDurationMs
  );

  // Resolve previous track (handles cycle boundary cleanly)
  let previousSlot: ScheduledTrackSlot;
  if (currentIndex > 0) {
    const prevTrack = cycleTracks[currentIndex - 1];
    const prevSlotDurationMs = getEffectiveSlotDurationMs(prevTrack.durationMs, station);
    previousSlot = toScheduledSlot(
      prevTrack,
      currentStartMs - prevSlotDurationMs,
      cycleNumber,
      currentIndex - 1,
      'base',
      prevSlotDurationMs
    );
  } else {
    const prevCycleNumber = cycleNumber - 1;
    const prevCycleTracks = generateCycleTracks(
      station.seed,
      'base',
      prevCycleNumber,
      station.playMode,
      station.rules,
      matchingTracks
    );
    const prevIndex = prevCycleTracks.length - 1;
    const prevTrack = prevCycleTracks[prevIndex];
    const prevSlotDurationMs = getEffectiveSlotDurationMs(prevTrack.durationMs, station);
    previousSlot = toScheduledSlot(
      prevTrack,
      currentStartMs - prevSlotDurationMs,
      prevCycleNumber,
      prevIndex,
      'base',
      prevSlotDurationMs
    );
  }

  // Resolve next track (handles cycle boundary cleanly)
  let nextSlot: ScheduledTrackSlot;
  if (currentIndex + 1 < cycleTracks.length) {
    const nextTrack = cycleTracks[currentIndex + 1];
    const nextSlotDurationMs = getEffectiveSlotDurationMs(nextTrack.durationMs, station);
    nextSlot = toScheduledSlot(
      nextTrack,
      currentSlot.endMs,
      cycleNumber,
      currentIndex + 1,
      'base',
      nextSlotDurationMs
    );
  } else {
    const nextCycleNumber = cycleNumber + 1;
    const nextCycleTracks = generateCycleTracks(
      station.seed,
      'base',
      nextCycleNumber,
      station.playMode,
      station.rules,
      matchingTracks
    );
    const nextTrack = nextCycleTracks[0];
    const nextSlotDurationMs = getEffectiveSlotDurationMs(nextTrack.durationMs, station);
    nextSlot = toScheduledSlot(
      nextTrack,
      currentSlot.endMs,
      nextCycleNumber,
      0,
      'base',
      nextSlotDurationMs
    );
  }

  return {
    current: currentSlot,
    positionMs: Math.max(0, targetTimeMs - currentStartMs),
    previous: previousSlot,
    next: nextSlot,
  };
}

/**
 * Resolves all scheduled track slots overlapping the window `[fromMs, toMs]`
 * for the live EPG timeline and XMLTV export.
 */
export function resolveStationWindow(
  station: StationRecord,
  matchingTracks: readonly TrackRecord[],
  fromMs: number,
  toMs: number
): ScheduledTrackSlot[] {
  if (matchingTracks.length === 0 || toMs <= fromMs) {
    return [];
  }

  if (station.daypartsEnabled) {
    const allSlots = resolveDaypartSlotsRange(station, matchingTracks, fromMs, toMs);
    return allSlots
      .filter((s) => s.endMs > fromMs && s.startMs < toMs)
      .slice(0, 500);
  }

  const cycleDurationMs = matchingTracks.reduce(
    (sum, t) => sum + getEffectiveSlotDurationMs(t.durationMs, station),
    0
  );
  if (cycleDurationMs <= 0) {
    return [];
  }

  const initial = resolveStationAtTime(station, matchingTracks, fromMs);
  if (!initial) return [];

  const slots: ScheduledTrackSlot[] = [];
  let cursorCycle = initial.current.cycleNumber;
  let cursorIndex = initial.current.indexInCycle;
  let cursorStartMs = initial.current.startMs;

  let currentCycleTracks = generateCycleTracks(
    station.seed,
    'base',
    cursorCycle,
    station.playMode,
    station.rules,
    matchingTracks
  );

  // Cap at 500 slots per window call as a safety guard
  while (cursorStartMs < toMs && slots.length < 500) {
    const track = currentCycleTracks[cursorIndex];
    const slotDurationMs = getEffectiveSlotDurationMs(track.durationMs, station);
    const slot = toScheduledSlot(
      track,
      cursorStartMs,
      cursorCycle,
      cursorIndex,
      'base',
      slotDurationMs
    );
    slots.push(slot);

    cursorStartMs = slot.endMs;
    cursorIndex += 1;

    if (cursorIndex >= currentCycleTracks.length) {
      cursorCycle += 1;
      cursorIndex = 0;
      currentCycleTracks = generateCycleTracks(
        station.seed,
        'base',
        cursorCycle,
        station.playMode,
        station.rules,
        matchingTracks
      );
    }
  }

  return slots;
}

