import { useCallback, useEffect, useState } from 'react';

export type TimeFormatPreference = '12h' | '24h';
export type GuideDensityPreference = 'compact' | 'standard' | 'comfortable';
export type GuideVisibleMinutesPreference = 15 | 25 | 45;
export type NowPlayingBackdropPreference =
  | 'artwork_blur'
  | 'color_glow'
  | 'solid_dark';
export type NowPlayingSleeveShapePreference = 'rounded' | 'square';
export type BadgeShapePreference = 'rounded' | 'circle';
export type RemoteTrackButtonBehavior =
  | 'station_switch_hold_track'
  | 'track_skip_hold_station'
  | 'always_track_skip'
  | 'always_station_switch';
export type AutoplayMode =
  | 'random_station'
  | 'last_station'
  | 'default_station';

export interface AppearancePreferences {
  timeFormat: TimeFormatPreference;
  guideDensity: GuideDensityPreference;
  guideVisibleMinutes: GuideVisibleMinutesPreference;
  guideShowRuleSummary: boolean;
  nowPlayingBackdrop: NowPlayingBackdropPreference;
  nowPlayingSleeveShape: NowPlayingSleeveShapePreference;
  showAdjacentStations: boolean;
  defaultCarMode: boolean;
  reverseStationDirection: boolean;
  realtimeLock: boolean;
  remoteTrackButtonBehavior: RemoteTrackButtonBehavior;
  remoteHoldThresholdMs: number;
  badgeShowCategoryIcon: boolean;
  badgeShape: BadgeShapePreference;
  autoplayEnabled: boolean;
  autoplayMode: AutoplayMode;
  defaultStationId: string | null;
  autoResumeAfterInterruption: boolean;
  stationShuffleEnabled: boolean;
  clearCurationSearchOnClose: boolean;
}

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  timeFormat: '12h',
  guideDensity: 'standard',
  guideVisibleMinutes: 25,
  guideShowRuleSummary: true,
  nowPlayingBackdrop: 'artwork_blur',
  nowPlayingSleeveShape: 'rounded',
  showAdjacentStations: true,
  defaultCarMode: false,
  reverseStationDirection: false,
  realtimeLock: false,
  remoteTrackButtonBehavior: 'station_switch_hold_track',
  remoteHoldThresholdMs: 800,
  badgeShowCategoryIcon: true,
  badgeShape: 'rounded',
  autoplayEnabled: false,
  autoplayMode: 'last_station',
  defaultStationId: null,
  autoResumeAfterInterruption: true,
  stationShuffleEnabled: false,
  clearCurationSearchOnClose: true,
};

const STORAGE_KEY = 'radiarr_appearance_prefs';
const CHANGE_EVENT = 'radiarr_appearance_changed';

export function formatBroadcastWallTime(
  ms: number,
  timeFormat: TimeFormatPreference = '12h'
): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: timeFormat === '24h' ? '2-digit' : 'numeric',
    minute: '2-digit',
    hour12: timeFormat === '12h',
  });
}

export function getStoredAppearancePreferences(): AppearancePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<AppearancePreferences>;
    return {
      timeFormat:
        parsed.timeFormat === '24h' || parsed.timeFormat === '12h'
          ? parsed.timeFormat
          : DEFAULT_APPEARANCE_PREFERENCES.timeFormat,
      guideDensity:
        parsed.guideDensity === 'compact' ||
        parsed.guideDensity === 'standard' ||
        parsed.guideDensity === 'comfortable'
          ? parsed.guideDensity
          : DEFAULT_APPEARANCE_PREFERENCES.guideDensity,
      guideVisibleMinutes:
        parsed.guideVisibleMinutes === 15 ||
        parsed.guideVisibleMinutes === 25 ||
        parsed.guideVisibleMinutes === 45
          ? parsed.guideVisibleMinutes
          : DEFAULT_APPEARANCE_PREFERENCES.guideVisibleMinutes,
      guideShowRuleSummary:
        typeof parsed.guideShowRuleSummary === 'boolean'
          ? parsed.guideShowRuleSummary
          : DEFAULT_APPEARANCE_PREFERENCES.guideShowRuleSummary,
      nowPlayingBackdrop:
        parsed.nowPlayingBackdrop === 'artwork_blur' ||
        parsed.nowPlayingBackdrop === 'color_glow' ||
        parsed.nowPlayingBackdrop === 'solid_dark'
          ? parsed.nowPlayingBackdrop
          : DEFAULT_APPEARANCE_PREFERENCES.nowPlayingBackdrop,
      nowPlayingSleeveShape:
        parsed.nowPlayingSleeveShape === 'square' ||
        parsed.nowPlayingSleeveShape === 'rounded'
          ? parsed.nowPlayingSleeveShape
          : DEFAULT_APPEARANCE_PREFERENCES.nowPlayingSleeveShape,
      showAdjacentStations:
        typeof parsed.showAdjacentStations === 'boolean'
          ? parsed.showAdjacentStations
          : DEFAULT_APPEARANCE_PREFERENCES.showAdjacentStations,
      defaultCarMode:
        typeof parsed.defaultCarMode === 'boolean'
          ? parsed.defaultCarMode
          : DEFAULT_APPEARANCE_PREFERENCES.defaultCarMode,
      reverseStationDirection:
        typeof parsed.reverseStationDirection === 'boolean'
          ? parsed.reverseStationDirection
          : DEFAULT_APPEARANCE_PREFERENCES.reverseStationDirection,
      realtimeLock:
        typeof parsed.realtimeLock === 'boolean'
          ? parsed.realtimeLock
          : DEFAULT_APPEARANCE_PREFERENCES.realtimeLock,
      remoteTrackButtonBehavior:
        parsed.remoteTrackButtonBehavior === 'station_switch_hold_track' ||
        parsed.remoteTrackButtonBehavior === 'track_skip_hold_station' ||
        parsed.remoteTrackButtonBehavior === 'always_track_skip' ||
        parsed.remoteTrackButtonBehavior === 'always_station_switch'
          ? parsed.remoteTrackButtonBehavior
          : DEFAULT_APPEARANCE_PREFERENCES.remoteTrackButtonBehavior,
      remoteHoldThresholdMs:
        typeof parsed.remoteHoldThresholdMs === 'number' &&
        parsed.remoteHoldThresholdMs >= 300 &&
        parsed.remoteHoldThresholdMs <= 3000
          ? parsed.remoteHoldThresholdMs
          : DEFAULT_APPEARANCE_PREFERENCES.remoteHoldThresholdMs,
      badgeShowCategoryIcon:
        typeof parsed.badgeShowCategoryIcon === 'boolean'
          ? parsed.badgeShowCategoryIcon
          : DEFAULT_APPEARANCE_PREFERENCES.badgeShowCategoryIcon,
      badgeShape:
        parsed.badgeShape === 'circle' || parsed.badgeShape === 'rounded'
          ? parsed.badgeShape
          : DEFAULT_APPEARANCE_PREFERENCES.badgeShape,
      autoplayEnabled:
        typeof parsed.autoplayEnabled === 'boolean'
          ? parsed.autoplayEnabled
          : DEFAULT_APPEARANCE_PREFERENCES.autoplayEnabled,
      autoplayMode:
        parsed.autoplayMode === 'random_station' ||
        parsed.autoplayMode === 'last_station' ||
        parsed.autoplayMode === 'default_station'
          ? parsed.autoplayMode
          : DEFAULT_APPEARANCE_PREFERENCES.autoplayMode,
      defaultStationId:
        typeof parsed.defaultStationId === 'string'
          ? parsed.defaultStationId
          : parsed.defaultStationId === null
            ? null
            : DEFAULT_APPEARANCE_PREFERENCES.defaultStationId,
      autoResumeAfterInterruption:
        typeof parsed.autoResumeAfterInterruption === 'boolean'
          ? parsed.autoResumeAfterInterruption
          : DEFAULT_APPEARANCE_PREFERENCES.autoResumeAfterInterruption,
      stationShuffleEnabled:
        typeof parsed.stationShuffleEnabled === 'boolean'
          ? parsed.stationShuffleEnabled
          : DEFAULT_APPEARANCE_PREFERENCES.stationShuffleEnabled,
      clearCurationSearchOnClose:
        typeof parsed.clearCurationSearchOnClose === 'boolean'
          ? parsed.clearCurationSearchOnClose
          : DEFAULT_APPEARANCE_PREFERENCES.clearCurationSearchOnClose,
    };
  } catch {
    return DEFAULT_APPEARANCE_PREFERENCES;
  }
}

export function useAppearance() {
  const [appearance, setAppearanceState] = useState<AppearancePreferences>(() =>
    getStoredAppearancePreferences()
  );

  useEffect(() => {
    const sync = () => {
      setAppearanceState(getStoredAppearancePreferences());
    };
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const updateAppearance = useCallback(
    (patch: Partial<AppearancePreferences>) => {
      const current = getStoredAppearancePreferences();
      const next: AppearancePreferences = {
        ...current,
        ...patch,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      setAppearanceState(next);
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    },
    []
  );

  const resetAppearance = useCallback(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(DEFAULT_APPEARANCE_PREFERENCES)
      );
    } catch {
      // ignore storage errors
    }
    setAppearanceState(DEFAULT_APPEARANCE_PREFERENCES);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }, []);

  return {
    appearance,
    updateAppearance,
    resetAppearance,
  };
}

