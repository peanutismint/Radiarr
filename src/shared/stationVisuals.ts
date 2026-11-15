import type { PlayMode, StationCategory, StationRules } from './types.ts';

export interface StationCategoryVisuals {
  category: StationCategory;
  label: string;
  shortLabel: string;
  color: string;
  badgeBgClass: string;
  badgeTextClass: string;
  badgeBorderClass: string;
}

export const STATION_CATEGORY_FORMULA: Record<StationCategory, StationCategoryVisuals> = {
  discography: {
    category: 'discography',
    label: 'Discography / Album',
    shortLabel: 'Discography',
    color: '#4f46e5', // Deep Indigo
    badgeBgClass: 'bg-indigo-500/12 dark:bg-indigo-500/20',
    badgeTextClass: 'text-indigo-700 dark:text-indigo-300',
    badgeBorderClass: 'border-indigo-500/25',
  },
  artist_mix: {
    category: 'artist_mix',
    label: 'Artist Shuffle',
    shortLabel: 'Artist Mix',
    color: '#e11d48', // Crimson / Rose
    badgeBgClass: 'bg-rose-500/12 dark:bg-rose-500/20',
    badgeTextClass: 'text-rose-700 dark:text-rose-300',
    badgeBorderClass: 'border-rose-500/25',
  },
  era: {
    category: 'era',
    label: 'Era / Decade Mix',
    shortLabel: 'Era Mix',
    color: '#d97706', // Amber / Gold
    badgeBgClass: 'bg-amber-500/12 dark:bg-amber-500/20',
    badgeTextClass: 'text-amber-700 dark:text-amber-300',
    badgeBorderClass: 'border-amber-500/25',
  },
  genre: {
    category: 'genre',
    label: 'Genre Radio',
    shortLabel: 'Genre',
    color: '#059669', // Emerald / Teal
    badgeBgClass: 'bg-emerald-500/12 dark:bg-emerald-500/20',
    badgeTextClass: 'text-emerald-700 dark:text-emerald-300',
    badgeBorderClass: 'border-emerald-500/25',
  },
  curated: {
    category: 'curated',
    label: 'Locked Curated Pool',
    shortLabel: 'Curated',
    color: '#7c3aed', // Violet
    badgeBgClass: 'bg-violet-500/12 dark:bg-violet-500/20',
    badgeTextClass: 'text-violet-700 dark:text-violet-300',
    badgeBorderClass: 'border-violet-500/25',
  },
  library: {
    category: 'library',
    label: 'All-Library Shuffle',
    shortLabel: 'Library Mix',
    color: '#0891b2', // Cyan / Sky
    badgeBgClass: 'bg-cyan-500/12 dark:bg-cyan-500/20',
    badgeTextClass: 'text-cyan-700 dark:text-cyan-300',
    badgeBorderClass: 'border-cyan-500/25',
  },
};

export const CUSTOM_SWATCH_PALETTE: readonly { hex: string; name: string }[] = [
  { hex: '#4f46e5', name: 'Indigo (Discography)' },
  { hex: '#e11d48', name: 'Rose (Artist Mix)' },
  { hex: '#d97706', name: 'Amber (Era Mix)' },
  { hex: '#059669', name: 'Emerald (Genre)' },
  { hex: '#0891b2', name: 'Cyan (Library)' },
  { hex: '#7c3aed', name: 'Violet (Curated)' },
  { hex: '#2563eb', name: 'Cobalt Blue' },
  { hex: '#db2777', name: 'Magenta' },
  { hex: '#ea580c', name: 'Tangerine' },
  { hex: '#0d9488', name: 'Deep Teal' },
  { hex: '#475569', name: 'Slate Studio' },
  { hex: '#dc2626', name: 'Broadcast Red' },
] as const;

/**
 * Deterministic formula mapping a station's playMode & rules to its semantic StationCategory.
 */
export function inferStationCategory(
  playMode: PlayMode,
  rules: StationRules,
  smartUpdateOverride?: boolean
): StationCategory {
  const smartUpdate =
    typeof smartUpdateOverride === 'boolean'
      ? smartUpdateOverride
      : rules?.smartUpdate !== false;

  const hasArtists = Boolean(rules?.artists && rules.artists.length > 0);
  const hasAlbums = Boolean(rules?.albums && rules.albums.length > 0);
  const hasGenres = Boolean(rules?.genres && rules.genres.length > 0);
  const hasEra =
    (typeof rules?.yearMin === 'number' && Number.isFinite(rules.yearMin)) ||
    (typeof rules?.yearMax === 'number' && Number.isFinite(rules.yearMax));

  // 1. Discography / Full Album playback (chronological straight mode, album_shuffle, or specific albums selected)
  if (playMode === 'straight' || playMode === 'album_shuffle' || hasAlbums) {
    return 'discography';
  }

  // 2. Artist Shuffle (shuffled tracks filtered by artist)
  if (hasArtists) {
    return 'artist_mix';
  }

  // 3. Era / Decade Mix (year range active)
  if (hasEra) {
    return 'era';
  }

  // 4. Genre Radio
  if (hasGenres) {
    return 'genre';
  }

  // 5. Locked / Curated Snapshot Pool
  if (!smartUpdate) {
    return 'curated';
  }

  // 6. Default: All-Library Shuffle
  return 'library';
}

export function getCategoryVisuals(
  playMode: PlayMode,
  rules: StationRules,
  smartUpdateOverride?: boolean
): StationCategoryVisuals {
  const category = inferStationCategory(playMode, rules, smartUpdateOverride);
  return STATION_CATEGORY_FORMULA[category];
}

export function resolveStationTileColor(
  playMode: PlayMode,
  rules: StationRules,
  storedTileColor?: string | null,
  customColorOverride?: boolean
): string {
  const isCustom =
    typeof customColorOverride === 'boolean'
      ? customColorOverride
      : Boolean(rules?.customColor);

  if (isCustom && storedTileColor && storedTileColor.trim()) {
    return storedTileColor.trim();
  }

  return getCategoryVisuals(playMode, rules).color;
}

/**
 * Builds concise, human-scannable rule summary pills for a station (e.g., ["2 artists", "2000–2009", "Rock"]).
 */
export function buildStationRuleSummaryPills(rules: StationRules): string[] {
  const pills: string[] = [];

  if (rules.artists && rules.artists.length > 0) {
    if (rules.artists.length === 1) {
      pills.push(rules.artists[0]);
    } else {
      pills.push(`${rules.artists[0]} +${rules.artists.length - 1}`);
    }
  }

  if (rules.albums && rules.albums.length > 0) {
    if (rules.albums.length === 1) {
      pills.push(rules.albums[0]);
    } else {
      pills.push(`${rules.albums.length} albums`);
    }
  }

  if (rules.genres && rules.genres.length > 0) {
    if (rules.genres.length <= 2) {
      pills.push(rules.genres.join(', '));
    } else {
      pills.push(`${rules.genres[0]} +${rules.genres.length - 1}`);
    }
  }

  const hasMin = typeof rules.yearMin === 'number' && Number.isFinite(rules.yearMin);
  const hasMax = typeof rules.yearMax === 'number' && Number.isFinite(rules.yearMax);
  if (hasMin && hasMax) {
    if (rules.yearMin === rules.yearMax) {
      pills.push(`${rules.yearMin}`);
    } else if (
      rules.yearMin! % 10 === 0 &&
      rules.yearMax === rules.yearMin! + 9
    ) {
      pills.push(`${rules.yearMin}s`);
    } else {
      pills.push(`${rules.yearMin}–${rules.yearMax}`);
    }
  } else if (hasMin) {
    pills.push(`${rules.yearMin}+`);
  } else if (hasMax) {
    pills.push(`≤${rules.yearMax}`);
  }

  return pills;
}

/**
 * Computes the reordered station ID array when moving multiple selected stations en masse
 * ('top', 'bottom', 'up', or 'down').
 */
export function computeBatchMovedIds(
  orderedIds: string[],
  selectedIds: string[],
  direction: 'top' | 'bottom' | 'up' | 'down'
): string[] {
  const selectedSet = new Set(selectedIds);
  if (selectedSet.size === 0) return [...orderedIds];

  if (direction === 'top') {
    const selected = orderedIds.filter((id) => selectedSet.has(id));
    const unselected = orderedIds.filter((id) => !selectedSet.has(id));
    return [...selected, ...unselected];
  }

  if (direction === 'bottom') {
    const selected = orderedIds.filter((id) => selectedSet.has(id));
    const unselected = orderedIds.filter((id) => !selectedSet.has(id));
    return [...unselected, ...selected];
  }

  if (direction === 'up') {
    const result = [...orderedIds];
    for (let i = 0; i < result.length; i++) {
      if (selectedSet.has(result[i])) {
        if (i > 0 && !selectedSet.has(result[i - 1])) {
          const temp = result[i - 1];
          result[i - 1] = result[i];
          result[i] = temp;
        }
      }
    }
    return result;
  }

  if (direction === 'down') {
    const result = [...orderedIds];
    for (let i = result.length - 1; i >= 0; i--) {
      if (selectedSet.has(result[i])) {
        if (i < result.length - 1 && !selectedSet.has(result[i + 1])) {
          const temp = result[i + 1];
          result[i + 1] = result[i];
          result[i] = temp;
        }
      }
    }
    return result;
  }

  return [...orderedIds];
}

/**
 * Computes the reordered station ID array when dragging and dropping a batch of selected stations
 * relative to a target station ('before' or 'after').
 * Preserves the relative order of both selected and unselected stations.
 */
export function computeBatchMovedToTarget(
  orderedIds: string[],
  selectedIds: string[],
  targetId: string,
  position: 'before' | 'after'
): string[] {
  const selectedSet = new Set(selectedIds);
  if (selectedSet.size === 0) return [...orderedIds];

  const selected = orderedIds.filter((id) => selectedSet.has(id));
  const unselected = orderedIds.filter((id) => !selectedSet.has(id));

  if (unselected.length === 0) {
    return [...orderedIds];
  }

  let insertIndex: number;

  if (!selectedSet.has(targetId)) {
    const targetIdx = unselected.indexOf(targetId);
    if (targetIdx === -1) return [...orderedIds];
    insertIndex = position === 'before' ? targetIdx : targetIdx + 1;
  } else {
    // Target is within the selected group. Find the anchor in unselected relative to target in orderedIds.
    const origTargetIdx = orderedIds.indexOf(targetId);
    if (origTargetIdx === -1) return [...orderedIds];

    if (position === 'before') {
      let anchorId: string | null = null;
      for (let i = origTargetIdx - 1; i >= 0; i--) {
        if (!selectedSet.has(orderedIds[i])) {
          anchorId = orderedIds[i];
          break;
        }
      }
      if (anchorId) {
        insertIndex = unselected.indexOf(anchorId) + 1;
      } else {
        insertIndex = 0;
      }
    } else {
      let anchorId: string | null = null;
      for (let i = origTargetIdx + 1; i < orderedIds.length; i++) {
        if (!selectedSet.has(orderedIds[i])) {
          anchorId = orderedIds[i];
          break;
        }
      }
      if (anchorId) {
        insertIndex = unselected.indexOf(anchorId);
      } else {
        insertIndex = unselected.length;
      }
    }
  }

  const result = [...unselected];
  result.splice(insertIndex, 0, ...selected);
  return result;
}

export interface AutoplayResolutionInput {
  enabledStations: Array<{ id: string; name: string; channelNumber: number }>;
  autoplayEnabled: boolean;
  autoplayMode: 'random_station' | 'last_station' | 'default_station';
  defaultStationId: string | null;
  lastStationId: string | null;
  randomSeed?: number;
}

/**
 * Resolves which station should be tuned and whether audio playback should auto-start on page load.
 */
export function resolveInitialAutoplayStation(
  input: AutoplayResolutionInput
): { targetStationId: string; shouldAutoPlay: boolean } {
  const {
    enabledStations,
    autoplayEnabled,
    autoplayMode,
    defaultStationId,
    lastStationId,
    randomSeed,
  } = input;

  if (enabledStations.length === 0) {
    return { targetStationId: '', shouldAutoPlay: false };
  }

  let targetStationId = enabledStations[0].id;

  if (autoplayEnabled) {
    if (autoplayMode === 'default_station') {
      const match = enabledStations.find((s) => s.id === defaultStationId);
      targetStationId = match ? match.id : enabledStations[0].id;
    } else if (autoplayMode === 'last_station') {
      const match = enabledStations.find((s) => s.id === lastStationId);
      targetStationId = match ? match.id : enabledStations[0].id;
    } else if (autoplayMode === 'random_station') {
      const rand = typeof randomSeed === 'number' ? randomSeed : Math.random();
      const idx = Math.floor(rand * enabledStations.length);
      targetStationId =
        enabledStations[Math.min(enabledStations.length - 1, Math.max(0, idx))].id;
    }
    return { targetStationId, shouldAutoPlay: true };
  }

  // Not auto-playing: prime the player bar on default, last, or channel 1
  const defaultMatch = defaultStationId
    ? enabledStations.find((s) => s.id === defaultStationId)
    : null;
  const lastMatch = lastStationId
    ? enabledStations.find((s) => s.id === lastStationId)
    : null;
  targetStationId = defaultMatch
    ? defaultMatch.id
    : lastMatch
      ? lastMatch.id
      : enabledStations[0].id;

  return { targetStationId, shouldAutoPlay: false };
}
