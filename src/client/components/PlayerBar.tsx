import {
  Cast,
  ChevronDown,
  ChevronUp,
  ListMusic,
  Pause,
  Play,
  Radio,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  EpgResponse,
  ScheduledTrackSlot,
  StationWithStats,
  TuneInResponse,
} from '../../shared/types.ts';
import {
  formatBroadcastWallTime,
  useAppearance,
} from '../hooks/useAppearance.ts';
import { useGoogleCast } from '../hooks/useGoogleCast.ts';
import { ChannelBadge, StationCategoryPill } from './ChannelBadge.tsx';

interface PlayerBarProps {
  tuneState: TuneInResponse | null;
  epg: EpgResponse | null;
  nowServerMs: number;
  stations: StationWithStats[];
  isPlaying: boolean;
  offsetMs: number;
  currentTrackPositionMs: number;
  volume: number;
  isMuted: boolean;
  stationShuffleEnabled?: boolean;
  onVolumeChange: (nextVolume: number) => void;
  onToggleMute: () => void;
  onTogglePlayPause: () => void;
  onPrevTrack: () => void;
  onNextTrack: () => void;
  onSeekWithinTrack: (newPositionMs: number) => void;
  onGoLive: () => void;
  onPrevStation: () => void;
  onNextStation: () => void;
  onToggleStationShuffle?: () => void;
  onSelectSlot?: (stationId: string, slotStartMs: number) => void;
  autoplayBlocked?: boolean;
  onResumeAutoplay?: () => void;
}

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatOffsetBadge(offsetMs: number): string {
  const absSec = Math.round(Math.abs(offsetMs) / 1000);
  if (absSec < 15) return 'LIVE';
  const sign = offsetMs < 0 ? '-' : '+';
  const mins = Math.floor(absSec / 60);
  const secs = absSec % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${sign}${hrs}h ${remMins}m`;
  }
  if (mins > 0) {
    return `${sign}${mins}m ${secs}s`;
  }
  return `${sign}${secs}s`;
}

export function PlayerBar({
  tuneState,
  epg,
  nowServerMs,
  stations,
  isPlaying,
  offsetMs,
  currentTrackPositionMs,
  volume,
  isMuted,
  stationShuffleEnabled,
  onVolumeChange,
  onToggleMute,
  onTogglePlayPause,
  onPrevTrack,
  onNextTrack,
  onSeekWithinTrack,
  onGoLive,
  onPrevStation,
  onNextStation,
  onToggleStationShuffle,
  onSelectSlot,
  autoplayBlocked,
  onResumeAutoplay,
}: PlayerBarProps) {
  const [queueOpen, setQueueOpen] = useState<boolean>(false);
  const { appearance, updateAppearance } = useAppearance();
  const googleCast = useGoogleCast();
  const isStationShuffle = stationShuffleEnabled ?? appearance.stationShuffleEnabled;
  const toggleStationShuffle =
    onToggleStationShuffle ||
    (() =>
      updateAppearance({
        stationShuffleEnabled: !appearance.stationShuffleEnabled,
      }));

  const upcomingSlots = useMemo<ScheduledTrackSlot[]>(() => {
    if (!tuneState) return [];
    const { station, nowPlaying, upNext } = tuneState;
    const refTimeMs = nowPlaying ? nowPlaying.startMs : nowServerMs + offsetMs;

    const epgStation = epg?.stations.find((s) => s.station.id === station.id);
    if (epgStation && epgStation.slots.length > 0) {
      const future = epgStation.slots.filter((slot) => slot.startMs > refTimeMs);
      if (future.length > 0) {
        return future.slice(0, 5);
      }
    }
    return upNext ? [upNext] : [];
  }, [tuneState, epg, nowServerMs, offsetMs]);

  if (!tuneState) {
    return null;
  }

  const { station, nowPlaying, empty } = tuneState;
  const durationMs = nowPlaying?.track.durationMs || 0;
  const clampedPosMs = Math.max(0, Math.min(durationMs, currentTrackPositionMs));
  const isLive = Math.abs(offsetMs) < 15000;
  const isRealtimeLocked = appearance.realtimeLock;
  const canSeek = Boolean(
    nowPlaying && nowPlaying.transcodeReady && !isRealtimeLocked
  );
  const effectiveVolume = isMuted ? 0 : volume;

  return (
    <div className="fixed bottom-0 inset-x-0 z-30 border-t border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md shadow-2xl pb-[max(1rem,calc(env(safe-area-inset-bottom,0px)+0.5rem))] sm:pb-0">
      {/* Live "Up Next" Mini-Queue Drawer */}
      {queueOpen && (
        <div className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/95 dark:bg-zinc-950/95 backdrop-blur-lg max-h-[55svh] overflow-y-auto">
          <div className="max-w-6xl mx-auto px-2.5 sm:px-6 py-2 sm:py-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <ListMusic className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span className="text-[11px] sm:text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  Up Next &mdash; CH {station.channelNumber} {station.name}
                </span>
                <StationCategoryPill category={station.category} compact />
              </div>
              <button
                type="button"
                onClick={() => setQueueOpen(false)}
                className="p-1 rounded-lg hover:bg-zinc-200/70 dark:hover:bg-zinc-800 text-zinc-500 cursor-pointer shrink-0"
                title="Close Up Next queue"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {upcomingSlots.length === 0 ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 py-1">
                No upcoming tracks scheduled in the current window.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-1.5 sm:gap-2">
                {upcomingSlots.map((slot, idx) => (
                  <button
                    key={`${slot.startMs}-${slot.track.id}`}
                    type="button"
                    disabled={isRealtimeLocked}
                    onClick={() => {
                      if (isRealtimeLocked) return;
                      onSelectSlot?.(station.id, slot.startMs);
                      setQueueOpen(false);
                    }}
                    className={`group text-left p-1.5 sm:p-2 rounded-xl border border-zinc-200/90 dark:border-zinc-800 bg-white dark:bg-zinc-900 transition flex items-center gap-2 min-w-0 ${
                      isRealtimeLocked
                        ? 'cursor-default opacity-90'
                        : 'hover:border-indigo-500/60 cursor-pointer'
                    }`}
                    title={
                      isRealtimeLocked
                        ? `${slot.track.title} (${formatBroadcastWallTime(slot.startMs, appearance.timeFormat)}) — Realtime Lock enabled`
                        : `Click to jump to ${slot.track.title} (${formatBroadcastWallTime(slot.startMs, appearance.timeFormat)})`
                    }
                  >
                    {slot.track.artUrl ? (
                      <img
                        src={slot.track.artUrl}
                        alt={slot.track.album}
                        className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg object-cover shrink-0 bg-zinc-200 dark:bg-zinc-800"
                      />
                    ) : (
                      <ChannelBadge
                        channelNumber={station.channelNumber}
                        tileColor={station.tileColor}
                        thumbnailUrl={station.thumbnailUrl}
                        category={station.category}
                        size="sm"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1 text-[9px] sm:text-[10px] font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
                        <span>{idx === 0 ? 'NEXT' : `+${idx + 1}`}</span>
                        <span>
                          {formatBroadcastWallTime(
                            slot.startMs,
                            appearance.timeFormat
                          )}
                        </span>
                      </div>
                      <div className="text-[11px] sm:text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                        {slot.track.title}
                      </div>
                      <div className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                        {slot.track.artist}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-2.5 sm:px-6 py-1.5 sm:py-2.5 flex flex-col gap-1 sm:gap-2">
        {/* Seek Bar Row (~20% tighter on mobile) */}
        {nowPlaying && (
          <div className="flex items-center gap-2 text-[10px] sm:text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
            <span className="w-7 sm:w-9 text-right">{formatTime(clampedPosMs)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(1, durationMs)}
              value={clampedPosMs}
              disabled={!canSeek}
              onChange={(e) => onSeekWithinTrack(Number(e.target.value))}
              className="flex-1 h-1 sm:h-1.5 rounded-lg accent-indigo-600 dark:accent-indigo-400 cursor-pointer disabled:opacity-50"
              title={
                isRealtimeLocked
                  ? 'Seeking is disabled while Realtime Lock is enabled'
                  : canSeek
                    ? 'Seek within current track (shifts offset from live)'
                    : 'Seeking unlocks once background MP3 transcode completes'
              }
            />
            <span className="w-7 sm:w-9">{formatTime(durationMs)}</span>
          </div>
        )}

        {/* Controls & Track Info Row */}
        <div className="flex items-center justify-between gap-1.5 sm:gap-4">
          {/* Left: Station Switcher + Artwork/ChannelBadge + Track & Station Title */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 flex-1">
            {/* Quick Station Hopping Buttons (CH- / CH+) */}
            <div className={`flex flex-col gap-0.5 shrink-0 rounded p-0.5 transition ${
              isStationShuffle ? 'bg-indigo-500/15 ring-1 ring-indigo-500/30' : ''
            }`}>
              <button
                onClick={onPrevStation}
                disabled={stations.length <= 1}
                className={`inline-flex items-center gap-1 px-1 sm:px-1.5 py-0.5 rounded text-zinc-700 dark:text-zinc-200 disabled:opacity-40 transition cursor-pointer ${
                  isStationShuffle
                    ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/30'
                    : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700'
                }`}
                title={
                  isStationShuffle
                    ? 'Random Station (Master Shuffle ON) — Shortcut: ↑ or Media Prev ⏮'
                    : 'Previous Station (Shortcut: ↑ or Media Prev ⏮)'
                }
                aria-label={isStationShuffle ? 'Random Station' : 'Previous Station'}
              >
                <ChevronUp className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <kbd className="hidden sm:inline text-[9px] font-mono text-zinc-500 dark:text-zinc-400">
                  ↑
                </kbd>
              </button>
              <button
                onClick={onNextStation}
                disabled={stations.length <= 1}
                className={`inline-flex items-center gap-1 px-1 sm:px-1.5 py-0.5 rounded text-zinc-700 dark:text-zinc-200 disabled:opacity-40 transition cursor-pointer ${
                  isStationShuffle
                    ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/30'
                    : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700'
                }`}
                title={
                  isStationShuffle
                    ? 'Random Station (Master Shuffle ON) — Shortcut: ↓ or Media Next ⏭'
                    : 'Next Station (Shortcut: ↓ or Media Next ⏭)'
                }
                aria-label={isStationShuffle ? 'Random Station' : 'Next Station'}
              >
                <ChevronDown className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <kbd className="hidden sm:inline text-[9px] font-mono text-zinc-500 dark:text-zinc-400">
                  ↓
                </kbd>
              </button>
            </div>

            {/* Album Art or Station ChannelBadge (~20% smaller on mobile) */}
            {nowPlaying?.track.artUrl ? (
              <img
                src={nowPlaying.track.artUrl}
                alt={nowPlaying.track.album}
                className="w-9 h-9 sm:w-11 sm:h-11 rounded-lg sm:rounded-xl object-cover bg-zinc-200 dark:bg-zinc-800 shrink-0 shadow-sm"
              />
            ) : (
              <div className="shrink-0">
                <div className="sm:hidden">
                  <ChannelBadge
                    channelNumber={station.channelNumber}
                    tileColor={station.tileColor}
                    thumbnailUrl={station.thumbnailUrl}
                    category={station.category}
                    size="sm"
                  />
                </div>
                <div className="hidden sm:block">
                  <ChannelBadge
                    channelNumber={station.channelNumber}
                    tileColor={station.tileColor}
                    thumbnailUrl={station.thumbnailUrl}
                    category={station.category}
                    size="md"
                  />
                </div>
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 sm:gap-1.5">
                <span
                  className="text-[9px] sm:text-[10px] font-mono font-bold px-1 sm:px-1.5 py-0.5 rounded text-white shrink-0 tabular-nums leading-none"
                  style={{ backgroundColor: station.tileColor }}
                >
                  CH {station.channelNumber}
                </span>
                <span className="text-[11px] sm:text-xs font-medium text-indigo-600 dark:text-indigo-400 truncate">
                  {station.name}
                </span>
              </div>

              {empty || !nowPlaying ? (
                <div className="text-[11px] sm:text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                  Empty station — no matching tracks
                </div>
              ) : (
                <>
                  <div className="text-xs sm:text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate leading-tight">
                    {nowPlaying.track.title}
                  </div>
                  <div className="text-[10px] sm:text-xs text-zinc-500 dark:text-zinc-400 truncate leading-tight">
                    {nowPlaying.track.artist} &middot; {nowPlaying.track.album}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Center: Track-level Time-Shift & Play/Pause Controls */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {/* Master Station Shuffle Toggle Button */}
            <button
              type="button"
              onClick={toggleStationShuffle}
              className={`inline-flex items-center gap-1 p-1.5 sm:px-2 sm:py-1.5 rounded-full border transition cursor-pointer ${
                isStationShuffle
                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs shadow-indigo-600/30'
                  : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
              title={
                isStationShuffle
                  ? 'Master Station Shuffle: ON (Switching stations jumps to random stations. Shortcut: S)'
                  : 'Master Station Shuffle: OFF (Switching stations moves to adjacent stations. Shortcut: S)'
              }
              aria-label="Toggle Master Station Shuffle"
              aria-pressed={isStationShuffle}
            >
              <Shuffle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <kbd className="hidden md:inline text-[9px] font-mono opacity-80">
                S
              </kbd>
            </button>

            <button
              onClick={onPrevTrack}
              disabled={empty || !nowPlaying || isRealtimeLocked}
              className="inline-flex items-center gap-1 p-1.5 sm:px-2 sm:py-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 disabled:opacity-35 transition cursor-pointer"
              title={
                isRealtimeLocked
                  ? 'Track skipping is disabled while Realtime Lock is enabled'
                  : 'Previous Track (Shortcut: ← or Hold ⏮)'
              }
              aria-label="Previous Track"
            >
              <SkipBack className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <kbd className="hidden md:inline text-[9px] font-mono text-zinc-400 dark:text-zinc-500">
                ←
              </kbd>
            </button>

            <button
              onClick={autoplayBlocked && onResumeAutoplay ? onResumeAutoplay : onTogglePlayPause}
              disabled={empty || !nowPlaying}
              className={`relative w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-md disabled:opacity-40 transition cursor-pointer ${
                autoplayBlocked && !isPlaying ? 'ring-4 ring-indigo-400/50 animate-pulse' : ''
              }`}
              title={
                autoplayBlocked && !isPlaying
                  ? 'Start audio (Autoplay paused by browser policy)'
                  : isPlaying
                    ? 'Pause (Shortcut: Space)'
                    : 'Play (Shortcut: Space)'
              }
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
              ) : (
                <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-current ml-0.5" />
              )}
            </button>

            <button
              onClick={onNextTrack}
              disabled={empty || !nowPlaying || isRealtimeLocked}
              className="inline-flex items-center gap-1 p-1.5 sm:px-2 sm:py-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 disabled:opacity-35 transition cursor-pointer"
              title={
                isRealtimeLocked
                  ? 'Track skipping is disabled while Realtime Lock is enabled'
                  : 'Next Track (Shortcut: → or Hold ⏭)'
              }
              aria-label="Next Track"
            >
              <kbd className="hidden md:inline text-[9px] font-mono text-zinc-400 dark:text-zinc-500">
                →
              </kbd>
              <SkipForward className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          </div>

          {/* Right: Up Next Drawer Toggle, Google Cast, Volume Slider, Mute & Go Live Button */}
          <div className="flex items-center gap-1 sm:gap-2.5 shrink-0">
            {/* Google Cast Sender Button */}
            <button
              type="button"
              onClick={() => {
                if (googleCast.isCasting) {
                  googleCast.stopCasting();
                } else {
                  const activeCastStation = tuneState?.station || stations[0];
                  if (activeCastStation) {
                    googleCast.startCastingStation({
                      id: activeCastStation.id,
                      name: activeCastStation.name,
                      channelNumber: activeCastStation.channelNumber,
                      thumbnailUrl: activeCastStation.thumbnailUrl,
                    });
                  } else {
                    googleCast.openCastPrompt();
                  }
                }
              }}
              className={`inline-flex items-center gap-1 px-1.5 py-1 sm:px-2 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-medium border transition cursor-pointer ${
                googleCast.isCasting
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                  : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border-zinc-200/80 dark:border-zinc-700/80'
              }`}
              title={
                googleCast.isCasting
                  ? `Casting to ${googleCast.castDeviceName || 'Speaker'} (Click to stop)`
                  : 'Cast live station to Google Home / Nest Speaker'
              }
              aria-label="Google Cast"
            >
              <Cast className="w-3.5 h-3.5" />
              {googleCast.isCasting && (
                <span className="hidden lg:inline text-[11px] font-medium">
                  {googleCast.castDeviceName || 'Casting'}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setQueueOpen((prev) => !prev)}
              className={`inline-flex items-center gap-1 px-1.5 py-1 sm:px-2 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-medium border transition cursor-pointer ${
                queueOpen
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border-zinc-200/80 dark:border-zinc-700/80'
              }`}
              title="Toggle Live Up Next Queue"
            >
              <ListMusic className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Up Next</span>
            </button>

            {/* Mute & Volume Slider (hidden on tiny screens where hardware volume is used) */}
            <div className="hidden xs:flex sm:flex items-center gap-1.5">
              <button
                onClick={onToggleMute}
                className="inline-flex items-center gap-1 p-1 sm:p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition cursor-pointer"
                title={isMuted || volume === 0 ? 'Unmute (Shortcut: M)' : 'Mute (Shortcut: M)'}
                aria-label={isMuted || volume === 0 ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-rose-500" />
                ) : volume < 0.5 ? (
                  <Volume1 className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
                <kbd className="hidden lg:inline text-[9px] font-mono text-zinc-400 dark:text-zinc-500">
                  M
                </kbd>
              </button>

              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={effectiveVolume}
                onChange={(e) => onVolumeChange(Number(e.target.value))}
                className="hidden sm:block w-20 md:w-24 h-1.5 rounded-lg accent-indigo-600 dark:accent-indigo-400 cursor-pointer"
                title={`Volume: ${Math.round(effectiveVolume * 100)}%`}
                aria-label="Volume"
              />

            </div>

            <button
              onClick={onGoLive}
              className={`inline-flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold transition cursor-pointer ${
                isLive
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                  : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 border border-amber-500/30'
              }`}
              title={
                isRealtimeLocked
                  ? 'Realtime Lock is enabled in Settings — always synced to live broadcast'
                  : isLive
                    ? 'Playing in sync with live broadcast'
                    : 'Click to reset time-shift offset back to live'
              }
            >
              <Radio className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span>
                {isRealtimeLocked
                  ? 'LIVE LOCKED'
                  : isLive
                    ? 'LIVE'
                    : formatOffsetBadge(offsetMs)}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

