/**
 * Utilities for Master Station Shuffle mode.
 * Provides a non-repeating shuffle bag so users visit every station
 * in random order without consecutive repeats before reshuffling.
 */

export interface StationItem {
  id: string;
}

/**
 * Given a list of enabled stations, the currently active station, and an active shuffle queue,
 * returns the next station ID to tune to and the remaining unplayed queue.
 *
 * Guarantees:
 * 1. Never returns the currently active station (when >= 2 stations exist).
 * 2. Cycles through all enabled stations before repeating any station.
 * 3. Prunes stations from the queue if they are disabled or removed from the catalog.
 */
export function pickNextShuffleStation<T extends StationItem>(
  stations: T[],
  currentStationId: string | null,
  existingQueue: string[] = []
): { nextStation: T | null; nextStationId: string | null; updatedQueue: string[] } {
  if (!stations || stations.length === 0) {
    return { nextStation: null, nextStationId: null, updatedQueue: [] };
  }

  if (stations.length === 1) {
    return {
      nextStation: stations[0],
      nextStationId: stations[0].id,
      updatedQueue: [],
    };
  }

  // Valid candidates are enabled stations that are not currently playing
  const validOtherCandidates = stations.filter((s) => s.id !== currentStationId);
  if (validOtherCandidates.length === 0) {
    return {
      nextStation: stations[0],
      nextStationId: stations[0].id,
      updatedQueue: [],
    };
  }

  // Keep only elements in existingQueue that are still in validOtherCandidates
  const validIdSet = new Set(validOtherCandidates.map((s) => s.id));
  let queue = existingQueue.filter((id) => validIdSet.has(id));

  // If queue is exhausted, generate a fresh Fisher-Yates shuffled bag
  if (queue.length === 0) {
    const candidateIds = validOtherCandidates.map((s) => s.id);
    for (let i = candidateIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidateIds[i], candidateIds[j]] = [candidateIds[j], candidateIds[i]];
    }
    queue = candidateIds;
  }

  const nextId = queue[0];
  const updatedQueue = queue.slice(1);
  const nextStation = stations.find((s) => s.id === nextId) || validOtherCandidates[0];

  return {
    nextStation,
    nextStationId: nextStation.id,
    updatedQueue,
  };
}
