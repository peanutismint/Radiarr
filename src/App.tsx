import {
  AlertTriangle,
  Check,
  Copy,
  Disc,
  ListMusic,
  Monitor,
  Moon,
  Radio,
  Settings as SettingsIcon,
  Sun,
  Volume2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CurationView } from './client/components/CurationView.tsx';
import { GuideView } from './client/components/GuideView.tsx';
import { LoginView } from './client/components/LoginView.tsx';
import { NowPlayingView } from './client/components/NowPlayingView.tsx';
import { PlayerBar } from './client/components/PlayerBar.tsx';
import { SettingsView } from './client/components/SettingsView.tsx';
import { UserMenu } from './client/components/UserMenu.tsx';
import { useAuth } from './client/context/AuthContext.tsx';
import { apiFetch } from './client/utils/apiInterceptor.ts';
import { useAppearance } from './client/hooks/useAppearance.ts';
import { useTheme } from './client/hooks/useTheme.ts';
import { pickNextShuffleStation } from './client/utils/stationShuffle.ts';
import { resolveInitialAutoplayStation } from './shared/stationVisuals.ts';
import {
  APP_VERSION,
  type EpgResponse,
  type ScanResultsOverview,
  type ServerSettings,
  type StationWithStats,
  type TuneInResponse,
} from './shared/types.ts';

type NavTab = 'now_playing' | 'guide' | 'curation' | 'settings';

export default function App() {
  const { theme, setTheme } = useTheme();
  const { appearance, updateAppearance } = useAppearance();
  const {
    user,
    authEnabled,
    loading: authLoading,
    canEditStations,
    canAccessSettings,
  } = useAuth();
  const [activeTab, setActiveTab] = useState<NavTab>('guide');
  const [curationEditStationId, setCurationEditStationId] = useState<string | null>(null);
  const [copiedFeed, setCopiedFeed] = useState<'m3u' | 'xmltv' | null>(null);

  const handleCopyFeedUrl = useCallback(async (type: 'm3u' | 'xmltv') => {
    const path = type === 'm3u' ? '/api/channels.m3u' : '/api/xmltv.xml';
    const fullUrl = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopiedFeed(type);
      window.setTimeout(() => {
        setCopiedFeed((prev) => (prev === type ? null : prev));
      }, 2000);
    } catch {
      // ignore clipboard errors
    }
  }, []);

  // Guide & Server Clock state
  const [epg, setEpg] = useState<EpgResponse | null>(null);
  const [epgLoading, setEpgLoading] = useState<boolean>(true);
  const clockSkewMsRef = useRef<number>(0);
  const [nowServerMs, setNowServerMs] = useState<number>(() => Date.now());

  // Player state (dual <audio> decks for seamless preloading and crossfade transitions)
  const deckARef = useRef<HTMLAudioElement | null>(null);
  const deckBRef = useRef<HTMLAudioElement | null>(null);
  const activeDeckRef = useRef<'A' | 'B'>('A');
  const preloadedUrlRef = useRef<string | null>(null);
  const crossfadeTimerRef = useRef<number | null>(null);
  const crossfadeRefreshTimeoutRef = useRef<number | null>(null);
  const lastCrossfadedSlotKeyRef = useRef<string | null>(null);

  const getActiveAudio = useCallback((): HTMLAudioElement | null => {
    return activeDeckRef.current === 'A' ? deckARef.current : deckBRef.current;
  }, []);

  const getInactiveAudio = useCallback((): HTMLAudioElement | null => {
    return activeDeckRef.current === 'A' ? deckBRef.current : deckARef.current;
  }, []);

  const [tuneState, setTuneState] = useState<TuneInResponse | null>(null);
  const [activeStationId, setActiveStationId] = useState<string | null>(null);
  const [offsetMs, setOffsetMs] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState<boolean>(false);
  const [currentTrackPositionMs, setCurrentTrackPositionMs] = useState<number>(0);
  const currentTrackPositionMsRef = useRef<number>(0);

  const updateTrackPosition = useCallback((ms: number) => {
    currentTrackPositionMsRef.current = ms;
    setCurrentTrackPositionMs(ms);
  }, []);

  const [volume, setVolume] = useState<number>(() => {
    const saved = localStorage.getItem('radiarr_volume');
    const parsed = saved !== null ? parseFloat(saved) : NaN;
    return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.85;
  });
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    return localStorage.getItem('radiarr_muted') === 'true';
  });

  const volumeRef = useRef<number>(volume);
  const isMutedRef = useRef<boolean>(isMuted);

  // Bluetooth & steering wheel remote hold vs tap tracking
  const remoteTapTimerRef = useRef<number | null>(null);
  const remoteHoldTriggeredRef = useRef<boolean>(false);
  const remoteDirectionRef = useRef<'prev' | 'next' | null>(null);
  const lastRemotePulseTimeRef = useRef<number>(0);

  // Audio interruption tracking (phone calls, Siri, navigation audio ducking)
  const isPlayingRef = useRef<boolean>(isPlaying);
  const userExplicitlyPausedRef = useRef<boolean>(false);
  const wasPlayingBeforeInterruptionRef = useRef<boolean>(false);
  const interruptionTimeRef = useRef<number>(0);

  // Dual-deck priming & iOS AudioSession configuration for uninterrupted background & lock-screen playback
  const decksPrimedRef = useRef<boolean>(false);
  const primeAudioDecks = useCallback(() => {
    // Register iOS audioSession as 'playback' so iOS allows continuous lock-screen and pocket audio
    if (typeof navigator !== 'undefined' && 'audioSession' in navigator) {
      try {
        (navigator as unknown as { audioSession: { type: string } }).audioSession.type = 'playback';
      } catch {
        // ignore
      }
    }

    if (decksPrimedRef.current) return;

    // Prime both deck A and deck B audio elements within a trusted user-gesture context.
    // This allows iOS Safari and Android Chrome to seamlessly switch between decks during
    // song transitions even when the screen is locked and the device is in a pocket.
    const deckA = deckARef.current;
    const deckB = deckBRef.current;
    for (const deck of [deckA, deckB]) {
      if (deck && !deck.src) {
        try {
          // Minimal silent WAV data URI to grant user activation blessing
          deck.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
          deck.load();
        } catch {
          // ignore
        }
      }
    }
    decksPrimedRef.current = true;
  }, []);

  // Configure AudioSession initially and attach global user gesture listeners to prime audio on first interaction
  useEffect(() => {
    primeAudioDecks();
    const handleFirstGesture = () => {
      primeAudioDecks();
    };
    window.addEventListener('pointerdown', handleFirstGesture, { passive: true, capture: true });
    window.addEventListener('touchstart', handleFirstGesture, { passive: true, capture: true });
    window.addEventListener('click', handleFirstGesture, { passive: true, capture: true });
    return () => {
      window.removeEventListener('pointerdown', handleFirstGesture, { capture: true });
      window.removeEventListener('touchstart', handleFirstGesture, { capture: true });
      window.removeEventListener('click', handleFirstGesture, { capture: true });
    };
  }, [primeAudioDecks]);

  const tuneStateRef = useRef<TuneInResponse | null>(tuneState);
  useEffect(() => {
    tuneStateRef.current = tuneState;
  }, [tuneState]);

  const appearanceRef = useRef(appearance);
  useEffect(() => {
    appearanceRef.current = appearance;
  }, [appearance]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const stopCrossfadeRamp = useCallback(
    (pauseInactive = true) => {
      if (crossfadeTimerRef.current !== null) {
        window.clearInterval(crossfadeTimerRef.current);
        crossfadeTimerRef.current = null;
      }
      if (crossfadeRefreshTimeoutRef.current !== null) {
        window.clearTimeout(crossfadeRefreshTimeoutRef.current);
        crossfadeRefreshTimeoutRef.current = null;
      }
      const active = getActiveAudio();
      const inactive = getInactiveAudio();
      const targetVol = Math.max(0, Math.min(1, volumeRef.current));
      if (active) {
        active.volume = targetVol;
        active.muted = isMutedRef.current;
      }
      if (inactive && pauseInactive) {
        inactive.pause();
        inactive.volume = 0;
      }
    },
    [getActiveAudio, getInactiveAudio]
  );

  // Sync volume and mute state natively with the audio decks
  useEffect(() => {
    volumeRef.current = volume;
    isMutedRef.current = isMuted;
    const active = getActiveAudio();
    const inactive = getInactiveAudio();
    const targetVol = Math.max(0, Math.min(1, volume));
    if (active && crossfadeTimerRef.current === null) {
      active.volume = targetVol;
      active.muted = isMuted;
    } else if (active) {
      active.muted = isMuted;
    }
    if (inactive) {
      inactive.muted = isMuted;
    }
    localStorage.setItem('radiarr_volume', String(volume));
    localStorage.setItem('radiarr_muted', String(isMuted));
  }, [volume, isMuted, getActiveAudio, getInactiveAudio]);

  const handleVolumeChange = (nextVolume: number) => {
    const clamped = Math.max(0, Math.min(1, nextVolume));
    setVolume(clamped);
    if (clamped > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  const handleToggleMute = () => {
    setIsMuted((prev) => !prev);
  };

  // Settings & Scanner state
  const [overview, setOverview] = useState<ScanResultsOverview | null>(null);
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [playbackNotice, setPlaybackNotice] = useState<{
    type: 'error' | 'info';
    message: string;
  } | null>(null);
  const retriedTranscodeTrackIdsRef = useRef<Set<string>>(new Set());

  // Enabled stations in channel order
  const enabledStations: StationWithStats[] = epg
    ? epg.stations.map((s) => s.station)
    : [];

  // 1. Fetch EPG window once (and when user refreshes or station revision changes)
  const fetchEpgWindow = useCallback(async () => {
    try {
      const res = await apiFetch('/api/epg');
      if (!res.ok) return;
      const data: EpgResponse = await res.json();
      clockSkewMsRef.current = data.serverTimeMs - Date.now();
      setNowServerMs(Date.now() + clockSkewMsRef.current);
      setEpg(data);
    } catch {
      // ignore transient network errors
    } finally {
      setEpgLoading(false);
    }
  }, []);

  const fetchSettingsAndScan = useCallback(async () => {
    try {
      const [scanRes, settingsRes] = await Promise.all([
        apiFetch('/api/scan/status'),
        apiFetch('/api/settings'),
      ]);
      if (scanRes.ok) {
        const scanData: ScanResultsOverview = await scanRes.json();
        setOverview(scanData);
      }
      if (settingsRes.ok) {
        const settingsData: { settings: ServerSettings } = await settingsRes.json();
        setSettings(settingsData.settings);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void fetchEpgWindow();
    void fetchSettingsAndScan();
  }, [fetchEpgWindow, fetchSettingsAndScan]);

  useEffect(() => {
    if (!overview?.progress.isScanning) return;
    const timer = setInterval(() => {
      void fetchSettingsAndScan();
    }, 1000);
    return () => clearInterval(timer);
  }, [overview?.progress.isScanning, fetchSettingsAndScan]);

  // Advance client-side server clock every 250ms so the EPG progress bars and "NOW" line move smoothly without polling
  useEffect(() => {
    const timer = setInterval(() => {
      const currentServer = Date.now() + clockSkewMsRef.current;
      setNowServerMs(currentServer);
      if (epg && currentServer > epg.toMs - 5 * 60 * 1000) {
        void fetchEpgWindow();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [epg, fetchEpgWindow]);

  // 2. Tune in to a station using the dual <audio> decks
  const tuneToStation = useCallback(
    async (
      stationId: string,
      targetOffsetMs: number,
      autoPlay: boolean,
      options?: {
        metadataOnly?: boolean;
        targetTimeMs?: number;
        startFromBeginning?: boolean;
        preserveOffsetMs?: number;
        preFetchedTune?: TuneInResponse;
      }
    ) => {
      primeAudioDecks();
      try {
        if (!options?.metadataOnly) {
          stopCrossfadeRamp(true);
        }

        let data: TuneInResponse;
        if (options?.preFetchedTune) {
          data = options.preFetchedTune;
        } else {
          const query =
            typeof options?.targetTimeMs === 'number' &&
            Number.isFinite(options.targetTimeMs)
              ? `targetTimeMs=${Math.round(options.targetTimeMs)}`
              : `offsetMs=${Math.round(targetOffsetMs)}`;

          const res = await apiFetch(
            `/api/stations/${encodeURIComponent(stationId)}/tune?${query}`
          );
          if (!res.ok) return;
          data = (await res.json()) as TuneInResponse;
        }

        clockSkewMsRef.current = data.serverTimeMs - Date.now();
        setNowServerMs(data.serverTimeMs);
        setActiveStationId(stationId);
        try {
          localStorage.setItem('radiarr_last_station_id', stationId);
        } catch {
          // ignore storage errors
        }

        const effectiveOffsetMs =
          typeof options?.preserveOffsetMs === 'number' &&
          Number.isFinite(options.preserveOffsetMs)
            ? options.preserveOffsetMs
            : data.offsetMs;
        setOffsetMs(effectiveOffsetMs);

        // If the station's revision or matching track pool changed since we fetched the EPG, refresh the EPG immediately
        setEpg((prevEpg) => {
          if (prevEpg) {
            const match = prevEpg.stations.find((s) => s.station.id === stationId);
            if (match) {
              const epgActiveSlot = match.slots.find(
                (slot) =>
                  slot.startMs <= data.effectiveTimeMs &&
                  slot.endMs > data.effectiveTimeMs
              );
              const trackMismatch =
                data.nowPlaying &&
                (!epgActiveSlot ||
                  epgActiveSlot.track.id !== data.nowPlaying.track.id ||
                  epgActiveSlot.startMs !== data.nowPlaying.startMs);

              if (
                match.station.revision !== data.revision ||
                match.station.matchingTrackCount !==
                  data.station.matchingTrackCount ||
                trackMismatch
              ) {
                void fetchEpgWindow();
              }
            }
          }
          return prevEpg;
        });

        if (options?.metadataOnly) {
          setTuneState((prev) => {
            if (
              prev?.nowPlaying &&
              data.nowPlaying &&
              prev.nowPlaying.track.id === data.nowPlaying.track.id
            ) {
              return {
                ...data,
                offsetMs: effectiveOffsetMs,
                nowPlaying: {
                  ...data.nowPlaying,
                  positionMs: prev.nowPlaying.positionMs,
                },
              };
            }
            return {
              ...data,
              offsetMs: effectiveOffsetMs,
            };
          });
          return;
        }

        const forceStartAtZero =
          Boolean(options?.startFromBeginning) ||
          (data.nowPlaying !== null && data.nowPlaying.positionMs < 2500);
        const effectivePositionMs = forceStartAtZero
          ? 0
          : data.nowPlaying?.positionMs ?? 0;

        setTuneState(
          data.nowPlaying
            ? {
                ...data,
                offsetMs: effectiveOffsetMs,
                nowPlaying: {
                  ...data.nowPlaying,
                  positionMs: effectivePositionMs,
                },
              }
            : data
        );

        if (!data.nowPlaying) {
          const active = getActiveAudio();
          if (active) {
            active.pause();
          }
          setIsPlaying(false);
          updateTrackPosition(0);
          return;
        }

        const targetUrl = data.nowPlaying.track.audioUrl;
        const targetPosSec = Math.max(0, effectivePositionMs / 1000);
        updateTrackPosition(effectivePositionMs);

        // If the upcoming track was already preloaded in the inactive deck and we're starting at 0:00, swap to it immediately
        const inactive = getInactiveAudio();
        const inactiveSrcPath = inactive?.src ? new URL(inactive.src).pathname : '';
        if (inactive && inactiveSrcPath === targetUrl && targetPosSec <= 0.05) {
          const outgoing = getActiveAudio();
          if (outgoing) {
            outgoing.pause();
            outgoing.volume = 0;
          }
          activeDeckRef.current = activeDeckRef.current === 'A' ? 'B' : 'A';
        }
        preloadedUrlRef.current = null;

        const audio = getActiveAudio();
        if (!audio) return;

        const targetVol = Math.max(0, Math.min(1, volumeRef.current));
        audio.volume = targetVol;
        audio.muted = isMutedRef.current;

        const currentSrcPath = audio.src ? new URL(audio.src).pathname : '';
        const isSameUrl = currentSrcPath === targetUrl;

        const triggerAudioPlayback = () => {
          if (!autoPlay) return;
          const playPromise = audio.play();
          if (playPromise !== undefined) {
            playPromise
              .then(() => {
                setIsPlaying(true);
                setAutoplayBlocked(false);
              })
              .catch(() => {
                setIsPlaying(false);
                setAutoplayBlocked(true);
              });
          }
        };

        if (!isSameUrl) {
          audio.src = targetUrl;
          audio.load();
          if (targetPosSec <= 0.05) {
            triggerAudioPlayback();
          } else {
            let seekDone = false;
            const applySeek = () => {
              if (seekDone) return;
              try {
                audio.currentTime = targetPosSec;
                seekDone = true;
              } catch {
                // defer
              }
            };
            if (audio.readyState >= 1) {
              applySeek();
            } else {
              const onMetadata = () => {
                audio.removeEventListener('loadedmetadata', onMetadata);
                applySeek();
              };
              audio.addEventListener('loadedmetadata', onMetadata);
            }
            triggerAudioPlayback();
          }
        } else {
          const isAlreadyPlayingThisDeck = !audio.paused && !audio.ended;
          const driftToleranceSec =
            isAlreadyPlayingThisDeck && !options?.startFromBeginning ? 8.0 : 0.6;
          try {
            if (targetPosSec <= 0.05 && options?.startFromBeginning) {
              if (audio.currentTime > 0.05) {
                audio.currentTime = 0;
              }
            } else if (
              Math.abs(audio.currentTime - targetPosSec) > driftToleranceSec
            ) {
              audio.currentTime = targetPosSec;
            }
          } catch {
            // ignore
          }
          triggerAudioPlayback();
        }
      } catch {
        // ignore network error
      }
    },
    [
      fetchEpgWindow,
      getActiveAudio,
      getInactiveAudio,
      stopCrossfadeRamp,
      primeAudioDecks,
      updateTrackPosition,
    ]
  );

  // Refresh the EPG when a scan finishes without interrupting an actively playing song mid-track
  const prevScanningRef = useRef<boolean>(false);
  const prevTrackTotalRef = useRef<number>(0);

  useEffect(() => {
    const isScanning = Boolean(overview?.progress.isScanning);
    const currentTracks = overview?.totals.tracks ?? 0;
    const scanJustFinished = prevScanningRef.current && !isScanning;
    const initialTracksLoaded =
      !isScanning &&
      prevTrackTotalRef.current === 0 &&
      currentTracks > 0;

    if (scanJustFinished) {
      void fetchEpgWindow();
      // Only re-tune the audio player if the station was previously empty and now has tracks
      if (activeStationId && !tuneState?.nowPlaying) {
        void tuneToStation(activeStationId, offsetMs, isPlaying);
      }
    } else if (initialTracksLoaded) {
      if (!activeStationId) {
        void fetchEpgWindow();
      }
    }

    prevScanningRef.current = isScanning;
    prevTrackTotalRef.current = currentTracks;
  }, [
    overview?.progress.isScanning,
    overview?.totals.tracks,
    fetchEpgWindow,
    activeStationId,
    offsetMs,
    isPlaying,
    tuneState?.nowPlaying,
    tuneToStation,
  ]);

  const initialAutoplayHandledRef = useRef<boolean>(false);

  // Auto-select or autoplay station upon initial load based on autoplay preferences
  useEffect(() => {
    if (initialAutoplayHandledRef.current) return;
    if (enabledStations.length === 0) return;

    initialAutoplayHandledRef.current = true;

    const LAST_STATION_STORAGE_KEY = 'radiarr_last_station_id';
    let lastStationId: string | null = null;
    try {
      lastStationId = localStorage.getItem(LAST_STATION_STORAGE_KEY);
    } catch {
      // ignore
    }

    const { targetStationId, shouldAutoPlay } = resolveInitialAutoplayStation({
      enabledStations,
      autoplayEnabled: appearance.autoplayEnabled,
      autoplayMode: appearance.autoplayMode,
      defaultStationId: appearance.defaultStationId,
      lastStationId,
    });

    void tuneToStation(targetStationId, 0, shouldAutoPlay);
  }, [
    enabledStations,
    appearance.autoplayEnabled,
    appearance.autoplayMode,
    appearance.defaultStationId,
    tuneToStation,
  ]);

  // If browser autoplay policy paused audio on reload, unlock on very first touch, click, or keypress
  useEffect(() => {
    if (!autoplayBlocked) return;
    const unlockAudio = () => {
      primeAudioDecks();
      const audio = getActiveAudio();
      if (audio && !isPlaying) {
        audio
          .play()
          .then(() => {
            setIsPlaying(true);
            setAutoplayBlocked(false);
          })
          .catch(() => {});
      }
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
  }, [autoplayBlocked, isPlaying, getActiveAudio, primeAudioDecks]);

  // Auto-resume playback when an external interruption (phone call, Siri, navigation audio ducking) ends
  useEffect(() => {
    if (!appearance.autoResumeAfterInterruption) return;

    const handleResumeFromInterruption = () => {
      if (!wasPlayingBeforeInterruptionRef.current) return;
      const elapsed = Date.now() - interruptionTimeRef.current;
      // Allow resumption if interruption occurred within the last 30 minutes
      if (elapsed > 30 * 60 * 1000) {
        wasPlayingBeforeInterruptionRef.current = false;
        return;
      }

      const audio = getActiveAudio();
      if (!audio) return;

      wasPlayingBeforeInterruptionRef.current = false;
      userExplicitlyPausedRef.current = false;

      if (audio.paused) {
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              setIsPlaying(true);
              setAutoplayBlocked(false);
            })
            .catch(() => {
              // If browser strictly requires a touch after phone call, activate unlocker
              setAutoplayBlocked(true);
            });
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleResumeFromInterruption();
      }
    };

    const handleWindowFocus = () => {
      handleResumeFromInterruption();
    };

    const handlePageShow = () => {
      handleResumeFromInterruption();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [appearance.autoResumeAfterInterruption, getActiveAudio]);

  // Master Station Shuffle bag reference to cycle through all stations randomly without consecutive repeats
  const stationShuffleQueueRef = useRef<string[]>([]);

  // 3. Switch to Previous / Next Station in channel order (or random station if Master Station Shuffle is active)
  const switchStationByDelta = useCallback(
    (delta: -1 | 1) => {
      if (enabledStations.length === 0) return;

      // Master Station Shuffle: jumping up or down picks a random station from the list
      if (appearance.stationShuffleEnabled) {
        const { nextStation, updatedQueue } = pickNextShuffleStation(
          enabledStations,
          activeStationId,
          stationShuffleQueueRef.current
        );
        stationShuffleQueueRef.current = updatedQueue;
        if (nextStation) {
          void tuneToStation(nextStation.id, 0, true);
        }
        return;
      }

      // Sequential Channel Order (wrapping around)
      const currentIndex = enabledStations.findIndex(
        (s) => s.id === activeStationId
      );
      const nextIndex =
        currentIndex === -1
          ? 0
          : (currentIndex + delta + enabledStations.length) %
            enabledStations.length;
      const nextStation = enabledStations[nextIndex];
      void tuneToStation(nextStation.id, 0, true);
    },
    [
      enabledStations,
      activeStationId,
      appearance.stationShuffleEnabled,
      tuneToStation,
    ]
  );

  const handleToggleStationShuffle = useCallback(() => {
    updateAppearance({
      stationShuffleEnabled: !appearance.stationShuffleEnabled,
    });
  }, [appearance.stationShuffleEnabled, updateAppearance]);

  const handleTrackNavigate = useCallback(
    async (direction: 'prev' | 'next') => {
      if (!activeStationId || appearance.realtimeLock) return;
      stopCrossfadeRamp(true);
      try {
        const currentTimeMs = tuneState?.nowPlaying
          ? tuneState.nowPlaying.startMs + currentTrackPositionMsRef.current
          : undefined;
        const res = await apiFetch(
          `/api/stations/${encodeURIComponent(activeStationId)}/navigate`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ offsetMs, direction, currentTimeMs }),
          }
        );
        if (!res.ok) return;
        const data: { offsetMs: number; tune: TuneInResponse } = await res.json();
        await tuneToStation(activeStationId, data.offsetMs, isPlaying, {
          startFromBeginning: true,
          preFetchedTune: data.tune,
        });
      } catch {
        // ignore
      }
    },
    [
      activeStationId,
      offsetMs,
      isPlaying,
      appearance.realtimeLock,
      tuneState?.nowPlaying,
      tuneToStation,
      stopCrossfadeRamp,
    ]
  );

  // 4. Dual-deck audio event listeners: timeupdate, preload upcoming track, crossfade ramp, and gapless track-ended transition
  useEffect(() => {
    const deckA = deckARef.current;
    const deckB = deckBRef.current;
    if (!deckA || !deckB) return;

    const triggerGaplessTransition = () => {
      if (!activeStationId || !tuneState?.nowPlaying || !tuneState.upNext) {
        if (activeStationId) {
          void tuneToStation(activeStationId, offsetMs, true, {
            startFromBeginning: true,
          });
        }
        return;
      }

      const outgoing = getActiveAudio();
      const incoming = getInactiveAudio();
      if (!outgoing || !incoming) return;

      const nextSlot = tuneState.upNext;
      const nextUrl = nextSlot.track.audioUrl;

      // Immediately swap active deck to the preloaded incoming deck for a zero-gap transition at 0:00
      activeDeckRef.current = activeDeckRef.current === 'A' ? 'B' : 'A';
      preloadedUrlRef.current = null;

      const incomingSrcPath = incoming.src ? new URL(incoming.src).pathname : '';
      if (incomingSrcPath !== nextUrl) {
        incoming.src = nextUrl;
        incoming.load();
      } else if (incoming.currentTime > 0.05) {
        try {
          incoming.currentTime = 0;
        } catch {
          // ignore
        }
      }

      const incomingVol = Math.max(0, Math.min(1, volumeRef.current));
      incoming.volume = incomingVol;
      incoming.muted = isMutedRef.current;

      // Start incoming deck FIRST so background audio session never has a 0-player deadzone
      const playPromise = incoming.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsPlaying(true);
            outgoing.pause();
            outgoing.volume = 0;
          })
          .catch(() => {
            outgoing.pause();
            outgoing.volume = 0;
            setIsPlaying(false);
          });
      } else {
        outgoing.pause();
        outgoing.volume = 0;
        setIsPlaying(true);
      }

      updateTrackPosition(0);

      const currentServerNow = Date.now() + clockSkewMsRef.current;
      const nextOffsetMs = nextSlot.startMs - currentServerNow;
      setOffsetMs(nextOffsetMs);

      // Optimistically advance tuneState to upNext at 0:00 so UI and Bluetooth metadata update immediately
      setTuneState((prev) => {
        if (!prev || !prev.upNext) return prev;
        return {
          ...prev,
          offsetMs: nextOffsetMs,
          nowPlaying: {
            ...prev.upNext,
            positionMs: 0,
            transcodeReady: true,
          },
        };
      });

      // Fetch the new upNext slot in the background without touching the playing audio deck
      void tuneToStation(activeStationId, nextOffsetMs, true, {
        metadataOnly: true,
        targetTimeMs: nextSlot.startMs + 500,
        preserveOffsetMs: nextOffsetMs,
      });
    };

    const triggerCrossfadeTransition = () => {
      if (!activeStationId || !tuneState?.nowPlaying || !tuneState.upNext) return;
      const outgoing = getActiveAudio();
      const incoming = getInactiveAudio();
      if (!outgoing || !incoming) return;

      const fadeSec = Math.max(1, tuneState.station.crossfadeSeconds || 5);
      const fadeMs = fadeSec * 1000;
      const nextSlot = tuneState.upNext;
      const nextUrl = nextSlot.track.audioUrl;

      // Swap the active deck to incoming so UI and transport controls immediately track the incoming song
      activeDeckRef.current = activeDeckRef.current === 'A' ? 'B' : 'A';
      preloadedUrlRef.current = null;

      const incomingSrcPath = incoming.src ? new URL(incoming.src).pathname : '';
      if (incomingSrcPath !== nextUrl) {
        incoming.src = nextUrl;
        incoming.load();
      } else if (incoming.currentTime > 0.05) {
        try {
          incoming.currentTime = 0;
        } catch {
          // ignore
        }
      }
      incoming.volume = 0;
      incoming.muted = isMutedRef.current;
      void incoming
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {});

      updateTrackPosition(0);

      const currentServerNow = Date.now() + clockSkewMsRef.current;
      const nextOffsetMs = nextSlot.startMs - currentServerNow;
      setOffsetMs(nextOffsetMs);

      // Optimistically advance tuneState to upNext so Now Playing UI and Bluetooth metadata update as the fade-in begins
      setTuneState((prev) => {
        if (!prev || !prev.upNext) return prev;
        return {
          ...prev,
          offsetMs: nextOffsetMs,
          nowPlaying: {
            ...prev.upNext,
            positionMs: 0,
            transcodeReady: true,
          },
        };
      });

      if (crossfadeTimerRef.current !== null) {
        window.clearInterval(crossfadeTimerRef.current);
      }
      const startTime = Date.now();
      crossfadeTimerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / fadeMs);
        const masterVol = Math.max(0, Math.min(1, volumeRef.current));

        outgoing.volume = Math.max(0, Math.min(1, masterVol * (1 - progress)));
        incoming.volume = Math.max(0, Math.min(1, masterVol * progress));
        outgoing.muted = isMutedRef.current;
        incoming.muted = isMutedRef.current;

        if (progress >= 1) {
          if (crossfadeTimerRef.current !== null) {
            window.clearInterval(crossfadeTimerRef.current);
            crossfadeTimerRef.current = null;
          }
          outgoing.pause();
          outgoing.volume = 0;
          incoming.volume = masterVol;
        }
      }, 50);

      // Refresh server tune metadata (to populate the new upNext slot) targeting nextSlot
      if (crossfadeRefreshTimeoutRef.current !== null) {
        window.clearTimeout(crossfadeRefreshTimeoutRef.current);
        crossfadeRefreshTimeoutRef.current = null;
      }
      void tuneToStation(activeStationId, nextOffsetMs, true, {
        metadataOnly: true,
        targetTimeMs: nextSlot.startMs + 500,
        preserveOffsetMs: nextOffsetMs,
      });
    };

    const handleTimeUpdate = (e: Event) => {
      const audio = e.currentTarget as HTMLAudioElement;
      if (audio !== getActiveAudio()) return;

      const posMs = Math.round(audio.currentTime * 1000);
      updateTrackPosition(posMs);

      if (tuneState?.nowPlaying && tuneState.upNext) {
        const slotDurationMs = Math.max(
          1000,
          tuneState.nowPlaying.endMs - tuneState.nowPlaying.startMs
        );
        const remainingUntilSlotEndMs = slotDurationMs - posMs;
        const nextUrl = tuneState.upNext.track.audioUrl;
        const inactive = getInactiveAudio();

        // Preload upcoming track into the inactive deck ~30 seconds before transition for instant gapless playback
        if (
          remainingUntilSlotEndMs <= 30000 &&
          remainingUntilSlotEndMs > 0 &&
          preloadedUrlRef.current !== nextUrl &&
          inactive &&
          crossfadeTimerRef.current === null
        ) {
          preloadedUrlRef.current = nextUrl;
          inactive.volume = 0;
          inactive.muted = isMutedRef.current;
          inactive.preload = 'auto';
          inactive.src = nextUrl;
          inactive.load();
        }

        // Trigger crossfade when reaching the scheduled overlap point (slotDurationMs < full track durationMs)
        const isCrossfadeSlot =
          tuneState.station.crossfadeEnabled &&
          slotDurationMs < tuneState.nowPlaying.track.durationMs;
        const slotKey = `${tuneState.nowPlaying.startMs}:${tuneState.nowPlaying.track.id}`;

        if (
          isCrossfadeSlot &&
          posMs >= slotDurationMs &&
          lastCrossfadedSlotKeyRef.current !== slotKey
        ) {
          lastCrossfadedSlotKeyRef.current = slotKey;
          triggerCrossfadeTransition();
        }
      }
    };

    const handleEnded = (e: Event) => {
      const audio = e.currentTarget as HTMLAudioElement;
      if (audio !== getActiveAudio()) return;
      if (!activeStationId) return;
      triggerGaplessTransition();
    };

    const handleError = async (e: Event) => {
      const audio = e.currentTarget as HTMLAudioElement;
      if (audio !== getActiveAudio()) return;

      const mediaErr = audio.error;
      const errCode = mediaErr ? mediaErr.code : 0;
      const errMsg = mediaErr ? mediaErr.message : 'Unknown playback error';
      const currentTrack = tuneState?.nowPlaying?.track;
      const trackId = currentTrack?.id;
      const trackTitle = currentTrack?.title || 'Unknown Track';
      const currentSrc = audio.src || '';

      const errCodeMap: Record<number, string> = {
        1: 'MEDIA_ERR_ABORTED',
        2: 'MEDIA_ERR_NETWORK',
        3: 'MEDIA_ERR_DECODE',
        4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
      };
      const codeName = errCodeMap[errCode] || `CODE_${errCode}`;

      // Log error to server diagnostics endpoint
      void fetch('/api/diagnostics/client-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: 'error',
          category: 'client',
          title: trackTitle,
          message: `Browser media playback error (${codeName}): Failed to play "${trackTitle}" [code ${errCode}: ${errMsg}]`,
          details: JSON.stringify({ code: errCode, codeName, message: errMsg, src: currentSrc }, null, 2),
        }),
      }).catch(() => {});

      // On-the-fly transcode recovery fallback:
      // If direct-play failed (e.g. FLAC in Safari), retry immediately with transcode=1
      if (
        trackId &&
        !currentSrc.includes('transcode=1') &&
        !retriedTranscodeTrackIdsRef.current.has(trackId)
      ) {
        retriedTranscodeTrackIdsRef.current.add(trackId);
        const retryUrl = `/api/audio/${encodeURIComponent(trackId)}?transcode=1`;
        audio.src = retryUrl;
        audio.load();
        try {
          await audio.play();
          setIsPlaying(true);
          return;
        } catch {
          // Fall through to auto-skip
        }
      }

      // Check autoSkip setting (default: true)
      const shouldAutoSkip = settings?.autoSkipUnplayable !== false;
      if (shouldAutoSkip) {
        setPlaybackNotice({
          type: 'error',
          message: `Unplayable track "${trackTitle}" (${codeName}). Auto-skipping to next song...`,
        });
        setTimeout(() => {
          setPlaybackNotice(null);
        }, 4000);

        void handleTrackNavigate('next');
      } else {
        setPlaybackNotice({
          type: 'error',
          message: `Playback error on "${trackTitle}" (${codeName}). Check Settings > Diagnostics & Logs.`,
        });
      }
    };

    const handlePlay = (e: Event) => {
      if (e.currentTarget !== getActiveAudio()) return;
      setIsPlaying(true);
      userExplicitlyPausedRef.current = false;
      wasPlayingBeforeInterruptionRef.current = false;
    };

    const handlePause = (e: Event) => {
      if (e.currentTarget !== getActiveAudio()) return;
      setIsPlaying(false);
      // If this pause event occurred without the user explicitly clicking Pause,
      // it was triggered by an external interruption (phone call, Siri, navigation prompt, Bluetooth event)
      if (!userExplicitlyPausedRef.current && isPlayingRef.current) {
        wasPlayingBeforeInterruptionRef.current = true;
        interruptionTimeRef.current = Date.now();
      }
    };

    for (const deck of [deckA, deckB]) {
      deck.addEventListener('timeupdate', handleTimeUpdate);
      deck.addEventListener('ended', handleEnded);
      deck.addEventListener('play', handlePlay);
      deck.addEventListener('pause', handlePause);
      deck.addEventListener('error', handleError);
    }

    return () => {
      for (const deck of [deckA, deckB]) {
        deck.removeEventListener('timeupdate', handleTimeUpdate);
        deck.removeEventListener('ended', handleEnded);
        deck.removeEventListener('play', handlePlay);
        deck.removeEventListener('pause', handlePause);
        deck.removeEventListener('error', handleError);
      }
    };
  }, [
    activeStationId,
    offsetMs,
    tuneState,
    tuneToStation,
    getActiveAudio,
    getInactiveAudio,
    settings?.autoSkipUnplayable,
    handleTrackNavigate,
  ]);

  // Automatically snap to live (0 offset) if Realtime Lock is turned on while time-shifted
  useEffect(() => {
    if (appearance.realtimeLock && activeStationId && Math.abs(offsetMs) >= 15000) {
      void tuneToStation(activeStationId, 0, isPlaying);
    }
  }, [appearance.realtimeLock, activeStationId, offsetMs, isPlaying, tuneToStation]);

  // 5. On-screen & MediaSession playback / track navigation handlers
  const lastMediaTrackSkipMsRef = useRef<number>(0);

  const handleTogglePlayPause = useCallback(() => {
    primeAudioDecks();
    const audio = getActiveAudio();
    if (!audio || !activeStationId) return;

    if (isPlaying) {
      userExplicitlyPausedRef.current = true;
      wasPlayingBeforeInterruptionRef.current = false;
      stopCrossfadeRamp(true);
      audio.pause();
    } else {
      userExplicitlyPausedRef.current = false;
      wasPlayingBeforeInterruptionRef.current = false;
      // When Realtime Lock is enabled (or if at live with 0s position), unpausing always re-syncs to live broadcast
      if (
        appearance.realtimeLock ||
        (Math.abs(offsetMs) < 15000 && audio.currentTime === 0)
      ) {
        void tuneToStation(activeStationId, 0, true);
      } else {
        void audio
          .play()
          .then(() => {
            setIsPlaying(true);
            setAutoplayBlocked(false);
          })
          .catch(() => {
            setAutoplayBlocked(true);
          });
      }
    }
  }, [
    activeStationId,
    isPlaying,
    offsetMs,
    appearance.realtimeLock,
    tuneToStation,
    getActiveAudio,
    stopCrossfadeRamp,
    primeAudioDecks,
  ]);

  const handleSeekWithinTrack = (newPositionMs: number) => {
    if (appearance.realtimeLock) return;
    const audio = getActiveAudio();
    if (!audio || !tuneState?.nowPlaying) return;

    stopCrossfadeRamp(true);

    const deltaMs = newPositionMs - currentTrackPositionMsRef.current;
    const maxShiftMs = 6 * 60 * 60 * 1000;
    const nextOffsetMs = Math.max(
      -maxShiftMs,
      Math.min(maxShiftMs, offsetMs + deltaMs)
    );

    updateTrackPosition(newPositionMs);
    setOffsetMs(nextOffsetMs);
    try {
      audio.currentTime = newPositionMs / 1000;
    } catch {
      // ignore
    }
  };

  const handleGoLive = useCallback(() => {
    if (!activeStationId) return;
    void tuneToStation(activeStationId, 0, true);
  }, [activeStationId, tuneToStation]);

  // 6. Media Session API for iOS Safari lock screen and Bluetooth car steering wheel controls
  useEffect(() => {
    if (!('mediaSession' in navigator)) {
      return;
    }

    if (tuneState?.nowPlaying) {
      const { station, nowPlaying } = tuneState;
      const artworkUrl = nowPlaying.track.artUrl
        ? new URL(nowPlaying.track.artUrl, window.location.origin).toString()
        : undefined;

      navigator.mediaSession.metadata = new MediaMetadata({
        title: nowPlaying.track.title,
        artist: `${nowPlaying.track.artist} • CH ${station.channelNumber} ${station.name}`,
        album: nowPlaying.track.album,
        artwork: artworkUrl
          ? [
              { src: artworkUrl, sizes: '96x96', type: 'image/jpeg' },
              { src: artworkUrl, sizes: '128x128', type: 'image/jpeg' },
              { src: artworkUrl, sizes: '192x192', type: 'image/jpeg' },
              { src: artworkUrl, sizes: '256x256', type: 'image/jpeg' },
              { src: artworkUrl, sizes: '384x384', type: 'image/jpeg' },
              { src: artworkUrl, sizes: '512x512', type: 'image/jpeg' },
            ]
          : [],
      });
    } else if (tuneState?.station) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `CH ${tuneState.station.channelNumber} ${tuneState.station.name}`,
        artist: 'Radiarr Live Broadcast',
      });
    }

    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

    const safeSetHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null
    ) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // unsupported action on this browser
      }
    };

    const triggerThrottledTrackSkip = (direction: 'prev' | 'next') => {
      const now = Date.now();
      if (now - lastMediaTrackSkipMsRef.current < 900) {
        return;
      }
      lastMediaTrackSkipMsRef.current = now;
      void handleTrackNavigate(direction);
    };

    safeSetHandler('play', () => {
      userExplicitlyPausedRef.current = false;
      wasPlayingBeforeInterruptionRef.current = false;
      const audio = getActiveAudio();
      if (audio) {
        void audio.play().then(() => {
          setIsPlaying(true);
          setAutoplayBlocked(false);
        }).catch(() => {});
      }
    });

    safeSetHandler('pause', () => {
      userExplicitlyPausedRef.current = true;
      wasPlayingBeforeInterruptionRef.current = false;
      stopCrossfadeRamp(true);
      const audio = getActiveAudio();
      if (audio) {
        audio.pause();
      }
      setIsPlaying(false);
    });

    const behavior =
      appearance.remoteTrackButtonBehavior || 'station_switch_hold_track';
    const holdThresholdMs = appearance.remoteHoldThresholdMs || 800;

    // Calculate station hopping direction (honoring reverseStationDirection preference)
    const prevStationDelta: -1 | 1 = appearance.reverseStationDirection ? 1 : -1;
    const nextStationDelta: -1 | 1 = appearance.reverseStationDirection ? -1 : 1;

    const executeRemoteAction = (
      actionType: 'station' | 'track',
      direction: 'prev' | 'next'
    ) => {
      if (actionType === 'station') {
        const delta = direction === 'next' ? nextStationDelta : prevStationDelta;
        switchStationByDelta(delta);
      } else {
        if (!appearance.realtimeLock) {
          triggerThrottledTrackSkip(direction);
        }
      }
    };

    const handleRemoteTrackButton = (direction: 'prev' | 'next') => {
      if (behavior === 'always_track_skip') {
        executeRemoteAction('track', direction);
        return;
      }
      if (behavior === 'always_station_switch') {
        executeRemoteAction('station', direction);
        return;
      }

      const tapType: 'station' | 'track' =
        behavior === 'station_switch_hold_track' ? 'station' : 'track';
      const holdType: 'station' | 'track' =
        behavior === 'station_switch_hold_track' ? 'track' : 'station';

      const now = Date.now();

      // Check for repeat pulse (cars send repeat pulses while button is held down)
      if (
        remoteTapTimerRef.current !== null &&
        remoteDirectionRef.current === direction &&
        now - lastRemotePulseTimeRef.current <= holdThresholdMs
      ) {
        // Continuous press detected! Cancel tap and trigger HOLD action immediately
        window.clearTimeout(remoteTapTimerRef.current);
        remoteTapTimerRef.current = null;
        remoteHoldTriggeredRef.current = true;
        lastRemotePulseTimeRef.current = now;
        executeRemoteAction(holdType, direction);
        return;
      }

      // If hold was already triggered recently during this hold sequence, ignore subsequent repeat pulses
      if (
        remoteHoldTriggeredRef.current &&
        now - lastRemotePulseTimeRef.current < holdThresholdMs * 1.5
      ) {
        lastRemotePulseTimeRef.current = now;
        return;
      }

      // First pulse: Start pending tap timer
      if (remoteTapTimerRef.current !== null) {
        window.clearTimeout(remoteTapTimerRef.current);
      }
      remoteHoldTriggeredRef.current = false;
      remoteDirectionRef.current = direction;
      lastRemotePulseTimeRef.current = now;

      remoteTapTimerRef.current = window.setTimeout(() => {
        remoteTapTimerRef.current = null;
        remoteDirectionRef.current = null;
        remoteHoldTriggeredRef.current = false;
        // No second pulse or fast-forward received: execute TAP action!
        executeRemoteAction(tapType, direction);
      }, holdThresholdMs);
    };

    const handleRemoteSeekHold = (direction: 'prev' | 'next') => {
      if (appearance.realtimeLock) return;
      if (remoteTapTimerRef.current !== null) {
        window.clearTimeout(remoteTapTimerRef.current);
        remoteTapTimerRef.current = null;
      }
      remoteHoldTriggeredRef.current = true;
      lastRemotePulseTimeRef.current = Date.now();

      const holdType: 'station' | 'track' =
        behavior === 'track_skip_hold_station' ? 'station' : 'track';
      executeRemoteAction(holdType, direction);
    };

    // Short-press Track Prev / Next
    safeSetHandler('previoustrack', () => handleRemoteTrackButton('prev'));
    safeSetHandler('nexttrack', () => handleRemoteTrackButton('next'));

    // Holding Track Next / Prev (Fast-Forward / Rewind) on Bluetooth AVRCP, CarPlay, and lock screens
    if (appearance.realtimeLock) {
      safeSetHandler('seekto', null);
      safeSetHandler('seekbackward', null);
      safeSetHandler('seekforward', null);
    } else {
      safeSetHandler('seekbackward', () => handleRemoteSeekHold('prev'));
      safeSetHandler('seekforward', () => handleRemoteSeekHold('next'));

      safeSetHandler('seekto', (details) => {
        if (typeof details.seekTime !== 'number') return;
        const currentPosSec = currentTrackPositionMsRef.current / 1000;
        const deltaSec = details.seekTime - currentPosSec;
        if (deltaSec >= 2) {
          handleRemoteSeekHold('next');
        } else if (deltaSec <= -2) {
          handleRemoteSeekHold('prev');
        }
      });
    }
  }, [
    tuneState,
    isPlaying,
    appearance.reverseStationDirection,
    appearance.realtimeLock,
    appearance.remoteTrackButtonBehavior,
    appearance.remoteHoldThresholdMs,
    switchStationByDelta,
    handleTrackNavigate,
    getActiveAudio,
    stopCrossfadeRamp,
  ]);

  // Keep Media Session position state updated so Bluetooth car displays show track progress
  useEffect(() => {
    if (
      !('mediaSession' in navigator) ||
      typeof navigator.mediaSession.setPositionState !== 'function' ||
      !tuneState?.nowPlaying
    ) {
      return;
    }
    const durationSec = Math.max(1, tuneState.nowPlaying.track.durationMs / 1000);
    const positionSec = Math.max(
      0,
      Math.min(durationSec, currentTrackPositionMs / 1000)
    );
    try {
      navigator.mediaSession.setPositionState({
        duration: durationSec,
        playbackRate: 1,
        position: positionSec,
      });
    } catch {
      // ignore invalid position state errors
    }
  }, [tuneState?.nowPlaying, currentTrackPositionMs]);

  // Global keyboard shortcuts & hardware media key fallback (including hold-to-skip-track)
  useEffect(() => {
    let mediaKeyHoldTimer: number | null = null;
    let mediaKeyHoldTriggered = false;
    let heldMediaKey: 'MediaTrackPrevious' | 'MediaTrackNext' | null = null;
    const prevStationDelta: -1 | 1 = appearance.reverseStationDirection ? 1 : -1;
    const nextStationDelta: -1 | 1 = appearance.reverseStationDirection ? -1 : 1;

    const clearMediaHold = () => {
      if (mediaKeyHoldTimer !== null) {
        window.clearTimeout(mediaKeyHoldTimer);
        mediaKeyHoldTimer = null;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      // Dedicated hardware Fast-Forward / Rewind keys -> Skip to Next / Prev Track on current station
      if (e.key === 'MediaFastForward') {
        e.preventDefault();
        if (!e.repeat && !appearance.realtimeLock) {
          void handleTrackNavigate('next');
        }
        return;
      }
      if (e.key === 'MediaRewind') {
        e.preventDefault();
        if (!e.repeat && !appearance.realtimeLock) {
          void handleTrackNavigate('prev');
        }
        return;
      }

      // Hardware MediaTrackPrevious / MediaTrackNext:
      // Respects user remoteTrackButtonBehavior and remoteHoldThresholdMs
      if (e.key === 'MediaTrackPrevious' || e.key === 'MediaTrackNext') {
        e.preventDefault();
        const dir = e.key === 'MediaTrackNext' ? 'next' : 'prev';
        const behavior = appearance.remoteTrackButtonBehavior || 'station_switch_hold_track';
        const holdThreshold = appearance.remoteHoldThresholdMs || 800;
        const tapDelta = dir === 'next' ? nextStationDelta : prevStationDelta;

        if (behavior === 'always_track_skip') {
          if (!e.repeat && !appearance.realtimeLock) {
            void handleTrackNavigate(dir);
          }
          return;
        }
        if (behavior === 'always_station_switch') {
          if (!e.repeat) {
            switchStationByDelta(tapDelta);
          }
          return;
        }

        const triggerHold = () => {
          if (behavior === 'station_switch_hold_track') {
            if (!appearance.realtimeLock) void handleTrackNavigate(dir);
          } else {
            switchStationByDelta(tapDelta);
          }
        };

        if (appearance.realtimeLock) {
          if (!e.repeat) {
            switchStationByDelta(tapDelta);
          }
          return;
        }

        if (e.repeat) {
          if (!mediaKeyHoldTriggered) {
            mediaKeyHoldTriggered = true;
            clearMediaHold();
            triggerHold();
          }
          return;
        }

        heldMediaKey = e.key;
        mediaKeyHoldTriggered = false;
        clearMediaHold();
        mediaKeyHoldTimer = window.setTimeout(() => {
          mediaKeyHoldTriggered = true;
          mediaKeyHoldTimer = null;
          triggerHold();
        }, holdThreshold);
        return;
      }

      if (e.key === 'MediaPlayPause') {
        e.preventDefault();
        handleTogglePlayPause();
        return;
      }

      if (isEditable || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        handleTogglePlayPause();
      } else if (e.key === 'ArrowUp' || e.key === '[') {
        e.preventDefault();
        switchStationByDelta(prevStationDelta);
      } else if (e.key === 'ArrowDown' || e.key === ']') {
        e.preventDefault();
        switchStationByDelta(nextStationDelta);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (!appearance.realtimeLock) {
          void handleTrackNavigate('prev');
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (!appearance.realtimeLock) {
          void handleTrackNavigate('next');
        }
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        setIsMuted((prev) => !prev);
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        handleGoLive();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        handleToggleStationShuffle();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (
        (e.key === 'MediaTrackPrevious' || e.key === 'MediaTrackNext') &&
        heldMediaKey === e.key
      ) {
        e.preventDefault();
        const wasHeld = mediaKeyHoldTriggered;
        const dir = e.key === 'MediaTrackNext' ? 'next' : 'prev';
        const behavior = appearance.remoteTrackButtonBehavior || 'station_switch_hold_track';
        const tapDelta = dir === 'next' ? nextStationDelta : prevStationDelta;
        clearMediaHold();
        heldMediaKey = null;
        mediaKeyHoldTriggered = false;
        if (!wasHeld) {
          if (behavior === 'station_switch_hold_track') {
            switchStationByDelta(tapDelta);
          } else {
            if (!appearance.realtimeLock) void handleTrackNavigate(dir);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      clearMediaHold();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    appearance.reverseStationDirection,
    appearance.realtimeLock,
    appearance.remoteTrackButtonBehavior,
    appearance.remoteHoldThresholdMs,
    switchStationByDelta,
    handleTogglePlayPause,
    handleTrackNavigate,
    handleGoLive,
    handleToggleStationShuffle,
  ]);

  const handleStationsChanged = () => {
    void fetchEpgWindow();
    if (activeStationId) {
      void tuneToStation(activeStationId, offsetMs, isPlaying);
    }
  };

  const handleUpdateSettings = async (patch: Partial<ServerSettings>) => {
    const res = await apiFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data: { settings: ServerSettings } = await res.json();
      setSettings(data.settings);
    }
  };

  const handleAddLibrary = async (name: string, folderPath: string) => {
    const res = await apiFetch('/api/libraries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path: folderPath }),
    });
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || 'Failed to add media library');
    }
    await fetchSettingsAndScan();
  };

  const handleRemoveLibrary = async (libraryId: string) => {
    await apiFetch(`/api/libraries/${encodeURIComponent(libraryId)}`, {
      method: 'DELETE',
    });
    await fetchSettingsAndScan();
    await fetchEpgWindow();
  };

  const handleTriggerScan = async (libraryId?: string) => {
    await apiFetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(libraryId ? { libraryId } : {}),
    });
    await fetchSettingsAndScan();
  };

  useEffect(() => {
    if (!canEditStations && activeTab === 'curation') {
      setActiveTab('guide');
    }
    if (!canAccessSettings && activeTab === 'settings') {
      setActiveTab('guide');
    }
  }, [canEditStations, canAccessSettings, activeTab]);

  if (authLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-zinc-100 dark:bg-zinc-950 text-zinc-500 text-xs font-mono">
        Loading Radiarr...
      </div>
    );
  }

  if (authEnabled && !user) {
    return <LoginView />;
  }

  return (
    <div
      className={`min-h-dvh w-full max-w-[100vw] overflow-x-clip bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 transition-colors ${
        activeTab === 'now_playing'
          ? 'pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:pb-6'
          : 'pb-[calc(7.5rem+env(safe-area-inset-bottom,0px))] sm:pb-32'
      }`}
    >
      <audio
        ref={deckARef}
        preload="auto"
        playsInline
        aria-hidden="true"
        className="fixed -top-96 -left-96 w-1 h-1 opacity-0 pointer-events-none"
      />
      <audio
        ref={deckBRef}
        preload="auto"
        playsInline
        aria-hidden="true"
        className="fixed -top-96 -left-96 w-1 h-1 opacity-0 pointer-events-none"
      />

      {/* Playback Error / Diagnostic Toast Banner */}
      {playbackNotice && (
        <div className="fixed top-14 sm:top-16 left-1/2 -translate-x-1/2 z-50 max-w-md w-[92vw] pointer-events-auto">
          <div
            className={`p-3 rounded-xl shadow-xl border flex items-center justify-between gap-3 text-xs ${
              playbackNotice.type === 'error'
                ? 'bg-rose-950/95 text-rose-100 border-rose-800 backdrop-blur'
                : 'bg-zinc-900/95 text-zinc-100 border-zinc-700 backdrop-blur'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span className="truncate">{playbackNotice.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setPlaybackNotice(null)}
              className="text-zinc-400 hover:text-white shrink-0 p-1 cursor-pointer text-base leading-none"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-2 sm:px-6 h-11 sm:h-14 flex items-center justify-between gap-1 sm:gap-3">
          <a
            href="https://github.com/peanutismint/radiarr"
            target="_blank"
            rel="noopener noreferrer"
            title="Radiarr on GitHub"
            className="flex items-center gap-1.5 sm:gap-2 min-w-0 shrink-0 text-inherit no-underline hover:opacity-90 transition-opacity cursor-pointer group"
          >
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm shrink-0">
              <Radio className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
            </div>
            <div className="flex items-baseline gap-1 sm:gap-1.5">
              <span className="font-bold text-xs sm:text-base tracking-tight">Radiarr</span>
              <span className="inline-block text-[9px] sm:text-[11px] font-medium px-1 sm:px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border border-zinc-200/80 dark:border-zinc-700/80">
                v{APP_VERSION}
              </span>
            </div>
          </a>

          <div className="flex items-center gap-1 sm:gap-2 min-w-0">
            <nav className="flex items-center gap-0.5 sm:gap-1 bg-zinc-100 dark:bg-zinc-800/80 p-0.5 sm:p-1 rounded-lg sm:rounded-xl">
              <button
                onClick={() => setActiveTab('now_playing')}
                title="Now Playing"
                className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-[11px] sm:text-xs font-medium transition cursor-pointer whitespace-nowrap ${
                  activeTab === 'now_playing'
                    ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Disc className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                <span className="hidden md:inline">Now Playing</span>
                <span className="md:hidden">Play</span>
              </button>

              <button
                onClick={() => setActiveTab('guide')}
                title="Guide"
                className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-[11px] sm:text-xs font-medium transition cursor-pointer whitespace-nowrap ${
                  activeTab === 'guide'
                    ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Radio className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                <span>Guide</span>
              </button>

              {canEditStations && (
                <button
                  onClick={() => setActiveTab('curation')}
                  title="Curation"
                  className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-[11px] sm:text-xs font-medium transition cursor-pointer whitespace-nowrap ${
                    activeTab === 'curation'
                      ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <ListMusic className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                  <span className="hidden sm:inline">Curation</span>
                </button>
              )}

              {canAccessSettings && (
                <button
                  onClick={() => setActiveTab('settings')}
                  title="Settings"
                  className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-[11px] sm:text-xs font-medium transition cursor-pointer whitespace-nowrap ${
                    activeTab === 'settings'
                      ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <SettingsIcon className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                  <span className="hidden sm:inline">Settings</span>
                </button>
              )}
            </nav>

            {/* Tunarr-style M3U & XMLTV Download + Copy Link Pills */}
            <div className="hidden sm:flex items-center gap-1 shrink-0">
              <div className="inline-flex items-center rounded-lg bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200/70 dark:border-zinc-700/70 overflow-hidden text-[10px] sm:text-[11px] font-medium">
                <a
                  href="/api/channels.m3u?download=1"
                  download="radiarr-channels.m3u"
                  title="Download M3U Station Playlist"
                  className="px-1.5 sm:px-2 py-1 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-700/70 hover:text-indigo-600 dark:hover:text-indigo-400 transition whitespace-nowrap"
                >
                  M3U
                </a>
                <button
                  type="button"
                  onClick={() => void handleCopyFeedUrl('m3u')}
                  title="Copy M3U Playlist URL"
                  aria-label="Copy M3U Playlist URL"
                  className="px-1 sm:px-1.5 py-1 border-l border-zinc-200/70 dark:border-zinc-700/70 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-700/70 hover:text-zinc-900 dark:hover:text-zinc-100 transition cursor-pointer"
                >
                  {copiedFeed === 'm3u' ? (
                    <Check className="w-3 h-3 text-emerald-500" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              </div>

              <div className="inline-flex items-center rounded-lg bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200/70 dark:border-zinc-700/70 overflow-hidden text-[10px] sm:text-[11px] font-medium">
                <a
                  href="/api/xmltv.xml?download=1"
                  download="radiarr-epg.xml"
                  title="Download XMLTV EPG Guide"
                  className="px-1.5 sm:px-2 py-1 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-700/70 hover:text-indigo-600 dark:hover:text-indigo-400 transition whitespace-nowrap"
                >
                  XML
                </a>
                <button
                  type="button"
                  onClick={() => void handleCopyFeedUrl('xmltv')}
                  title="Copy XMLTV EPG URL"
                  aria-label="Copy XMLTV EPG URL"
                  className="px-1 sm:px-1.5 py-1 border-l border-zinc-200/70 dark:border-zinc-700/70 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-700/70 hover:text-zinc-900 dark:hover:text-zinc-100 transition cursor-pointer"
                >
                  {copiedFeed === 'xmltv' ? (
                    <Check className="w-3 h-3 text-emerald-500" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                const nextTheme =
                  theme === 'light'
                    ? 'dark'
                    : theme === 'dark'
                      ? 'system'
                      : 'light';
                setTheme(nextTheme);
              }}
              title={`Theme: ${theme === 'system' ? 'Auto' : theme === 'light' ? 'Light' : 'Dark'} (click to cycle)`}
              aria-label={`Theme: ${theme === 'system' ? 'Auto' : theme === 'light' ? 'Light' : 'Dark'}. Click to switch theme`}
              className="p-1.5 sm:p-2 rounded-lg sm:rounded-xl bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-700/70 transition cursor-pointer shrink-0"
            >
              {theme === 'light' && <Sun className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
              {theme === 'dark' && <Moon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
              {theme === 'system' && <Monitor className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
            </button>

            <UserMenu />
          </div>
        </div>
      </header>

      {/* Autoplay Blocked Banner */}
      {autoplayBlocked && !isPlaying && (
        <aside
          role="region"
          aria-label="Playback Notice"
          onClick={() => {
            primeAudioDecks();
            const audio = getActiveAudio();
            if (audio) {
              void audio
                .play()
                .then(() => {
                  setIsPlaying(true);
                  setAutoplayBlocked(false);
                })
                .catch(() => {});
            }
          }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 sm:px-6 py-2.5 flex items-center justify-between gap-3 shadow-md transition cursor-pointer select-none z-20"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Volume2 className="w-4 h-4 shrink-0 animate-pulse text-indigo-200" />
            <span className="truncate">
              <strong>Autoplay Paused by Browser:</strong> Click anywhere on the screen or press any key to start audio.
            </span>
          </div>
          <button
            type="button"
            className="px-2.5 py-1 rounded-md bg-white/20 hover:bg-white/30 text-[11px] font-semibold shrink-0 cursor-pointer text-white"
          >
            Start Audio ▶
          </button>
        </aside>
      )}

      {/* Page Body */}
      <main
        className={`max-w-6xl mx-auto px-2 sm:px-6 ${
          activeTab === 'guide' ? 'pt-0 pb-2 sm:pb-5' : 'py-2 sm:py-5'
        }`}
      >
        {activeTab === 'now_playing' && (
          <NowPlayingView
            tuneState={tuneState}
            epg={epg}
            nowServerMs={nowServerMs}
            stations={enabledStations}
            isPlaying={isPlaying}
            offsetMs={offsetMs}
            currentTrackPositionMs={currentTrackPositionMs}
            volume={volume}
            isMuted={isMuted}
            onVolumeChange={handleVolumeChange}
            onToggleMute={handleToggleMute}
            onTogglePlayPause={handleTogglePlayPause}
            onPrevTrack={() => void handleTrackNavigate('prev')}
            onNextTrack={() => void handleTrackNavigate('next')}
            onSeekWithinTrack={handleSeekWithinTrack}
            onGoLive={handleGoLive}
            onPrevStation={() => switchStationByDelta(-1)}
            onNextStation={() => switchStationByDelta(1)}
            onTuneStation={(stationId) => void tuneToStation(stationId, 0, true)}
            stationShuffleEnabled={appearance.stationShuffleEnabled}
            onToggleStationShuffle={handleToggleStationShuffle}
          />
        )}

        {activeTab === 'guide' && (
          <GuideView
            epg={epg}
            loading={epgLoading}
            nowServerMs={nowServerMs}
            activeStationId={activeStationId}
            activeSlotStartMs={tuneState?.nowPlaying?.startMs ?? null}
            offsetMs={offsetMs}
            currentTrackPositionMs={currentTrackPositionMs}
            isPlaying={isPlaying}
            onTuneStation={(stationId) => void tuneToStation(stationId, 0, true)}
            onSelectSlot={(stationId, slotStartMs) => {
              if (appearance.realtimeLock) {
                void tuneToStation(stationId, 0, true);
                return;
              }
              void tuneToStation(
                stationId,
                slotStartMs - nowServerMs,
                true,
                {
                  targetTimeMs: slotStartMs,
                  startFromBeginning: true,
                }
              );
            }}
            onEditStation={(stationId) => {
              setCurationEditStationId(stationId);
              setActiveTab('curation');
            }}
            onRefreshGuide={() => {
              void fetchEpgWindow();
              if (activeStationId) {
                void tuneToStation(activeStationId, offsetMs, isPlaying);
              }
            }}
          />
        )}

        {activeTab === 'curation' && (
          <CurationView
            settings={settings}
            initialEditStationId={curationEditStationId}
            onClearInitialEditStationId={() => setCurationEditStationId(null)}
            onStationsChanged={handleStationsChanged}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            overview={overview}
            settings={settings}
            stations={enabledStations}
            onUpdateSettings={handleUpdateSettings}
            onAddLibrary={handleAddLibrary}
            onRemoveLibrary={handleRemoveLibrary}
            onTriggerScan={handleTriggerScan}
            onStationsChanged={handleStationsChanged}
            onBackupRestored={async () => {
              await fetchSettingsAndScan();
              await fetchEpgWindow();
              if (activeStationId) {
                void tuneToStation(activeStationId, 0, isPlaying);
              }
            }}
          />
        )}
      </main>

      {/* Persistent Bottom Player Bar (hidden when on full-screen Now Playing page) */}
      {activeTab !== 'now_playing' && (
        <PlayerBar
          tuneState={tuneState}
          epg={epg}
          nowServerMs={nowServerMs}
          stations={enabledStations}
          isPlaying={isPlaying}
          offsetMs={offsetMs}
          currentTrackPositionMs={currentTrackPositionMs}
          volume={volume}
          isMuted={isMuted}
          onVolumeChange={handleVolumeChange}
          onToggleMute={handleToggleMute}
          onTogglePlayPause={handleTogglePlayPause}
          onPrevTrack={() => void handleTrackNavigate('prev')}
          onNextTrack={() => void handleTrackNavigate('next')}
          onSeekWithinTrack={handleSeekWithinTrack}
          onGoLive={handleGoLive}
          onPrevStation={() => switchStationByDelta(-1)}
          onNextStation={() => switchStationByDelta(1)}
          stationShuffleEnabled={appearance.stationShuffleEnabled}
          onToggleStationShuffle={handleToggleStationShuffle}
          onSelectSlot={(stationId, slotStartMs) => {
            if (appearance.realtimeLock) {
              void tuneToStation(stationId, 0, true);
              return;
            }
            void tuneToStation(
              stationId,
              slotStartMs - nowServerMs,
              true,
              {
                targetTimeMs: slotStartMs,
                startFromBeginning: true,
              }
            );
          }}
          autoplayBlocked={autoplayBlocked}
          onResumeAutoplay={() => {
            primeAudioDecks();
            const audio = getActiveAudio();
            if (audio) {
              void audio
                .play()
                .then(() => {
                  setIsPlaying(true);
                  setAutoplayBlocked(false);
                })
                .catch(() => {});
            }
          }}
        />
      )}
    </div>
  );
}
