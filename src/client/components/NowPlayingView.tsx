import {
  ChevronLeft,
  ChevronRight,
  Disc,
  ListOrdered,
  Moon,
  Pause,
  Play,
  Radio,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { isOvernightDaypartHour } from '../../shared/metadataNormalizer.ts';
import type {
  EpgResponse,
  PlayMode,
  ScheduledTrackSlot,
  StationWithStats,
  TuneInResponse,
} from '../../shared/types.ts';
import { useAppearance } from '../hooks/useAppearance.ts';
import { ChannelBadge, StationCategoryPill } from './ChannelBadge.tsx';

interface NowPlayingViewProps {
  tuneState: TuneInResponse | null;
  epg: EpgResponse | null;
  nowServerMs: number;
  stations: StationWithStats[];
  isPlaying: boolean;
  offsetMs: number;
  currentTrackPositionMs: number;
  volume: number;
  isMuted: boolean;
  onVolumeChange: (nextVolume: number) => void;
  onToggleMute: () => void;
  onTogglePlayPause: () => void;
  onPrevTrack: () => void;
  onNextTrack: () => void;
  onSeekWithinTrack: (newPositionMs: number) => void;
  onGoLive: () => void;
  onPrevStation: () => void;
  onNextStation: () => void;
  onTuneStation: (stationId: string) => void;
  stationShuffleEnabled?: boolean;
  onToggleStationShuffle?: () => void;
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

function findCurrentSlotForStation(
  epg: EpgResponse | null,
  stationId: string,
  nowServerMs: number
): ScheduledTrackSlot | null {
  if (!epg) return null;
  const schedule = epg.stations.find((s) => s.station.id === stationId);
  if (!schedule || schedule.empty || schedule.slots.length === 0) return null;
  return (
    schedule.slots.find(
      (slot) => slot.startMs <= nowServerMs && slot.endMs > nowServerMs
    ) ??
    schedule.slots[0] ??
    null
  );
}

function getPlayModeDetails(playMode?: PlayMode) {
  switch (playMode) {
    case 'straight':
      return {
        label: 'Straight Order',
        description: 'Plays full albums and tracks chronologically in disc order',
        Icon: ListOrdered,
      };
    case 'album_shuffle':
      return {
        label: 'Album Shuffle',
        description: 'Shuffles whole albums, playing each from track 1 to end',
        Icon: Disc,
      };
    case 'shuffle':
    default:
      return {
        label: 'Track Shuffle',
        description: 'Shuffles tracks with fair rotation and anti-repeat',
        Icon: Shuffle,
      };
  }
}

interface AdjacentStationCardProps {
  direction: 'prev' | 'next';
  station: StationWithStats;
  currentSlot: ScheduledTrackSlot | null;
  onSelect: () => void;
  compact?: boolean;
}

function AdjacentStationCard({
  direction,
  station,
  currentSlot,
  onSelect,
  compact = false,
}: AdjacentStationCardProps) {
  const isPrev = direction === 'prev';

  if (compact) {
    return (
      <button
        onClick={onSelect}
        className="group relative flex-1 min-w-0 text-left rounded-xl p-2 sm:p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 active:scale-98 backdrop-blur-md transition-all duration-200 cursor-pointer shadow-sm"
        title={`Tune ${isPrev ? 'Previous' : 'Next'} Station: CH ${station.channelNumber} ${station.name}`}
      >
        <div className="flex items-center justify-between gap-1 mb-1">
          <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-zinc-400 group-hover:text-zinc-200 transition-colors">
            {isPrev && <ChevronLeft className="w-3 h-3 shrink-0" />}
            <span className="font-mono text-zinc-300">CH {station.channelNumber}</span>
            <span aria-hidden="true">&middot;</span>
            <span className="truncate">{station.name}</span>
            {!isPrev && <ChevronRight className="w-3 h-3 shrink-0" />}
          </div>
        </div>

        <div className="flex items-center gap-2 min-w-0">
          {currentSlot?.track.artUrl ? (
            <img
              src={currentSlot.track.artUrl}
              alt={currentSlot.track.album}
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded-lg object-cover bg-zinc-800 shrink-0 shadow-xs"
            />
          ) : (
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[10px] font-bold shrink-0 shadow-xs"
              style={{ backgroundColor: station.tileColor }}
            >
              {station.channelNumber}
            </div>
          )}

          <div className="min-w-0 flex-1">
            {currentSlot ? (
              <>
                <div className="text-[11px] sm:text-xs font-medium text-zinc-100 truncate">
                  {currentSlot.track.title}
                </div>
                <div className="text-[10px] text-zinc-400 truncate">
                  {currentSlot.track.artist}
                </div>
              </>
            ) : (
              <div className="text-[10px] text-zinc-500 truncate">
                No active broadcast
              </div>
            )}
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={onSelect}
      className="group relative w-full min-w-0 text-left rounded-2xl p-3 sm:p-4 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 active:scale-98 backdrop-blur-md opacity-85 hover:opacity-100 transition-all duration-200 cursor-pointer shadow-lg"
      title={`${isPrev ? 'Previous' : 'Next'} Station: CH ${station.channelNumber} ${station.name}`}
    >
      <div className="flex items-center justify-between gap-1.5 mb-2.5">
        <div className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 group-hover:text-zinc-200 transition-colors">
          {isPrev && <ChevronLeft className="w-3.5 h-3.5 shrink-0 text-indigo-400" />}
          <span className="font-mono text-zinc-300 font-semibold">CH {station.channelNumber}</span>
          <span aria-hidden="true">&middot;</span>
          <span className="truncate">{isPrev ? 'Previous Station' : 'Next Station'}</span>
          {!isPrev && <ChevronRight className="w-3.5 h-3.5 shrink-0 text-indigo-400" />}
        </div>
        <StationCategoryPill category={station.category} compact />
      </div>

      <div className="flex items-center gap-3 min-w-0">
        {currentSlot?.track.artUrl ? (
          <img
            src={currentSlot.track.artUrl}
            alt={currentSlot.track.album}
            referrerPolicy="no-referrer"
            className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl object-cover bg-zinc-800 shrink-0 shadow-md border border-white/10"
          />
        ) : (
          <ChannelBadge
            channelNumber={station.channelNumber}
            tileColor={station.tileColor}
            thumbnailUrl={station.thumbnailUrl}
            category={station.category}
            size="md"
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400 truncate">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: station.tileColor }}
            />
            <span className="font-semibold text-zinc-100 truncate">
              {station.name}
            </span>
          </div>

          {currentSlot ? (
            <>
              <div className="text-xs sm:text-sm font-semibold text-white truncate mt-1">
                {currentSlot.track.title}
              </div>
              <div className="text-[11px] sm:text-xs text-zinc-400 truncate">
                {currentSlot.track.artist}
              </div>
            </>
          ) : (
            <div className="text-xs text-zinc-500 truncate mt-1">
              No active broadcast
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

export function NowPlayingView({
  tuneState,
  epg,
  nowServerMs,
  stations,
  isPlaying,
  offsetMs,
  currentTrackPositionMs,
  volume,
  isMuted,
  onVolumeChange,
  onToggleMute,
  onTogglePlayPause,
  onPrevTrack,
  onNextTrack,
  onSeekWithinTrack,
  onGoLive,
  onPrevStation,
  onNextStation,
  onTuneStation,
  stationShuffleEnabled: propStationShuffleEnabled,
  onToggleStationShuffle: propOnToggleStationShuffle,
}: NowPlayingViewProps) {
  const { appearance, updateAppearance } = useAppearance();
  const isStationShuffle =
    propStationShuffleEnabled ?? appearance.stationShuffleEnabled;
  const toggleStationShuffle =
    propOnToggleStationShuffle ??
    (() => {
      updateAppearance({
        stationShuffleEnabled: !appearance.stationShuffleEnabled,
      });
    });

  if (!tuneState) {
    return (
      <div className="min-h-[calc(100vh-7rem)] flex flex-col items-center justify-center text-center p-8">
        <div className="w-16 h-16 rounded-2xl bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 mb-4">
          <Radio className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          No Station Tuned
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-md">
          Select a station from the Guide or Curation page to begin listening.
        </p>
      </div>
    );
  }

  const { station, nowPlaying, upNext, empty } = tuneState;
  const durationMs = nowPlaying?.track.durationMs || 0;
  const clampedPosMs = Math.max(0, Math.min(durationMs, currentTrackPositionMs));
  const isLive = Math.abs(offsetMs) < 15000;
  const isRealtimeLocked = appearance.realtimeLock;
  const canSeek = Boolean(
    nowPlaying && nowPlaying.transcodeReady && !isRealtimeLocked
  );
  const effectiveVolume = isMuted ? 0 : volume;
  const isOvernightSlot =
    nowPlaying?.daypartId === 'night' ||
    isOvernightDaypartHour(new Date(nowServerMs + offsetMs).getHours());

  const currentIdx = stations.findIndex((s) => s.id === station.id);
  const hasAdjacent =
    appearance.showAdjacentStations && stations.length > 1 && currentIdx !== -1;
  const prevStation = hasAdjacent
    ? stations[(currentIdx - 1 + stations.length) % stations.length]
    : null;
  const nextStation = hasAdjacent
    ? stations[(currentIdx + 1) % stations.length]
    : null;

  const prevStationSlot = prevStation
    ? findCurrentSlotForStation(epg, prevStation.id, nowServerMs)
    : null;
  const nextStationSlot = nextStation
    ? findCurrentSlotForStation(epg, nextStation.id, nowServerMs)
    : null;

  const sleeveCornerClass =
    appearance.nowPlayingSleeveShape === 'square'
      ? 'rounded-lg'
      : 'rounded-2xl sm:rounded-3xl';

  const playModeDetails = getPlayModeDetails(station.playMode);
  const PlayModeIcon = playModeDetails.Icon;

  return (
    <div className="relative min-h-[calc(100svh-4rem)] sm:min-h-[calc(100dvh-5.5rem)] rounded-2xl sm:rounded-3xl overflow-hidden border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-950 text-zinc-100 shadow-2xl flex flex-col justify-between">
      {/* Full-Screen Ambient Backdrop */}
      {appearance.nowPlayingBackdrop === 'artwork_blur' &&
      (nowPlaying?.track.artUrl || station.thumbnailUrl) ? (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <img
            src={nowPlaying?.track.artUrl || station.thumbnailUrl || ''}
            alt=""
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover scale-125 blur-3xl opacity-40 saturate-150 transition-all duration-700"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/70 via-zinc-950/80 to-zinc-950/95" />
        </div>
      ) : appearance.nowPlayingBackdrop !== 'solid_dark' ? (
        <div
          className="absolute inset-0 pointer-events-none opacity-25"
          style={{
            background: `radial-gradient(circle at 50% 30%, ${station.tileColor}, transparent 70%)`,
          }}
        />
      ) : null}

      {/* Top Station Header Bar with Station Info & Play Mode */}
      <div className="relative z-10 flex items-center justify-between gap-2 px-3 sm:px-8 pt-3 sm:pt-6">
        {/* Left: Station Identity, Channel & Play Mode Info */}
        <div className="flex items-center gap-2.5 sm:gap-3 text-xs sm:text-sm min-w-0 flex-1">
          <ChannelBadge
            channelNumber={station.channelNumber}
            tileColor={station.tileColor}
            thumbnailUrl={station.thumbnailUrl}
            category={station.category}
            size="md"
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-bold text-sm sm:text-lg text-white truncate tracking-tight">
                {station.name}
              </span>
              <StationCategoryPill category={station.category} compact />
            </div>

            {/* Station Play Mode & Broadcast Details */}
            <div className="text-zinc-400 text-[10px] sm:text-xs truncate flex items-center gap-1.5 sm:gap-2 mt-0.5">
              <span
                className="inline-flex items-center gap-1 text-indigo-300 font-medium shrink-0"
                title={playModeDetails.description}
              >
                <PlayModeIcon className="w-3 h-3 text-indigo-400" />
                <span>{playModeDetails.label}</span>
              </span>

              {station.crossfadeEnabled && (
                <>
                  <span aria-hidden="true" className="text-zinc-600">&middot;</span>
                  <span className="text-zinc-400 shrink-0">
                    Crossfade {station.crossfadeSeconds}s
                  </span>
                </>
              )}

              {station.daypartsEnabled && (
                <>
                  <span aria-hidden="true" className="text-zinc-600">&middot;</span>
                  <span className="inline-flex items-center gap-1 text-indigo-300 font-medium shrink-0">
                    <Moon className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                    <span>
                      {isOvernightSlot ? 'Night Chill (8P–6A)' : 'Dayparting'}
                    </span>
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: Volume & Live / Time-Shift Badge */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Compact Volume Control */}
          <div className="hidden sm:flex items-center gap-1.5 bg-white/5 border border-white/10 px-2 py-1 rounded-xl">
            <button
              onClick={onToggleMute}
              className="text-zinc-300 hover:text-white transition cursor-pointer p-0.5"
              title={isMuted || volume === 0 ? 'Unmute' : 'Mute'}
              aria-label={isMuted || volume === 0 ? 'Unmute' : 'Mute'}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-3.5 h-3.5 text-rose-400" />
              ) : volume < 0.5 ? (
                <Volume1 className="w-3.5 h-3.5" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={effectiveVolume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              className="w-16 sm:w-20 h-1.5 rounded-lg accent-indigo-500 cursor-pointer"
              title={`Volume: ${Math.round(effectiveVolume * 100)}%`}
            />

          </div>

          <button
            onClick={onGoLive}
            className={`inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-xl text-[11px] sm:text-xs font-bold transition cursor-pointer whitespace-nowrap shadow-sm ${
              isLive
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40'
            }`}
            title={
              isRealtimeLocked
                ? 'Realtime Lock is enabled in Settings — always synced to live broadcast'
                : isLive
                  ? 'Playing in sync with live broadcast'
                  : 'Click to reset time-shift offset back to live'
            }
          >
            <Radio className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
            <span>
              {isRealtimeLocked
                ? 'LIVE'
                : isLive
                  ? 'LIVE'
                  : `Go Live (${formatOffsetBadge(offsetMs)})`}
            </span>
          </button>
        </div>
      </div>

      {/* Main Hero Stage: Left Adjacent Station | Enlarged Center Hero Artwork & Metadata | Right Adjacent Station */}
      <div className="relative z-10 flex-1 grid grid-cols-1 lg:grid-cols-12 items-center gap-3 sm:gap-6 px-3 sm:px-8 py-2 sm:py-6 my-auto max-w-7xl mx-auto w-full">
        {/* Left Flanking Column: Previous Station (Desktop) */}
        <div className="hidden lg:flex lg:col-span-3 justify-start">
          {prevStation && (
            <AdjacentStationCard
              direction="prev"
              station={prevStation}
              currentSlot={prevStationSlot}
              onSelect={() => onTuneStation(prevStation.id)}
            />
          )}
        </div>

        {/* Center Hero Column: Enlarged Album Artwork & Track Metadata */}
        <div className="lg:col-span-6 flex flex-col items-center text-center max-w-2xl mx-auto w-full min-w-0">
          {/* Enlarged Album Sleeve taking up the majority of the display */}
          <div
            className={`relative w-52 h-52 xs:w-60 xs:h-60 sm:w-80 sm:h-80 md:w-96 md:h-96 lg:w-[420px] lg:h-[420px] xl:w-[460px] xl:h-[460px] ${sleeveCornerClass} overflow-hidden shadow-2xl shadow-black/80 border border-white/15 bg-zinc-900 flex items-center justify-center shrink-0 transition-transform duration-300`}
          >
            {nowPlaying?.track.artUrl || station.thumbnailUrl ? (
              <img
                src={nowPlaying?.track.artUrl || station.thumbnailUrl || ''}
                alt={nowPlaying?.track.album || station.name}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            ) : (
              <div
                className="w-full h-full flex flex-col items-center justify-center text-white/90 p-5"
                style={{ backgroundColor: station.tileColor }}
              >
                <Disc className="w-20 h-20 sm:w-28 sm:h-28 mb-3 opacity-85" />
                <span className="font-mono text-sm sm:text-base font-bold tracking-widest opacity-80">
                  CH {station.channelNumber}
                </span>
                <span className="text-xs sm:text-sm font-medium mt-1 opacity-70 truncate max-w-full">
                  {station.name}
                </span>
              </div>
            )}
          </div>

          {/* Track Title, Artist, Album, and Up Next */}
          <div className="mt-3 sm:mt-5 w-full px-2 min-w-0">
            {empty || !nowPlaying ? (
              <div className="py-2">
                <h1 className="text-xl sm:text-3xl font-bold text-white">
                  No Active Broadcast
                </h1>
                <p className="text-xs sm:text-sm text-zinc-400 mt-1">
                  This station currently has no matching tracks in your music library.
                </p>
              </div>
            ) : (
              <>
                <h1 className="text-lg xs:text-xl sm:text-3xl md:text-4xl font-bold tracking-tight text-white line-clamp-2 leading-tight">
                  {nowPlaying.track.title}
                </h1>

                <div className="mt-1 sm:mt-2 flex flex-wrap items-center justify-center gap-x-1.5 sm:gap-x-2 gap-y-0.5 text-xs sm:text-base md:text-lg text-zinc-300">
                  <span className="font-semibold text-white truncate max-w-full">
                    {nowPlaying.track.artist}
                  </span>
                  <span aria-hidden="true" className="text-zinc-500">&middot;</span>
                  <span className="text-zinc-300 truncate max-w-full">
                    {nowPlaying.track.album}
                  </span>
                  {nowPlaying.track.year && (
                    <>
                      <span aria-hidden="true" className="text-zinc-500">&middot;</span>
                      <span className="font-mono text-xs sm:text-sm text-zinc-400 tabular-nums">
                        {nowPlaying.track.year}
                      </span>
                    </>
                  )}
                </div>

                {upNext && (
                  <div className="mt-1.5 sm:mt-2.5 text-[11px] sm:text-xs text-zinc-400 flex items-center justify-center gap-1.5 truncate max-w-full">
                    <span className="text-zinc-500 shrink-0">Up Next:</span>
                    <span className="text-zinc-200 font-medium truncate">
                      {upNext.track.title}
                    </span>
                    <span aria-hidden="true" className="text-zinc-600 shrink-0">&middot;</span>
                    <span className="text-zinc-400 truncate">
                      {upNext.track.artist}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right Flanking Column: Next Station (Desktop) */}
        <div className="hidden lg:flex lg:col-span-3 justify-end">
          {nextStation && (
            <AdjacentStationCard
              direction="next"
              station={nextStation}
              currentSlot={nextStationSlot}
              onSelect={() => onTuneStation(nextStation.id)}
            />
          )}
        </div>
      </div>

      {/* Bottom Deck: Progress Bar, Mobile Adjacent Stations & 5-Button Transport */}
      <div className="relative z-10 px-3 sm:px-8 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:pb-6 pt-1 flex flex-col gap-2.5 sm:gap-4 max-w-4xl mx-auto w-full">
        {/* Mobile & Tablet Adjacent Stations Strip (< lg) */}
        {hasAdjacent && (
          <div className="flex items-center gap-2 lg:hidden w-full">
            {prevStation && (
              <AdjacentStationCard
                direction="prev"
                station={prevStation}
                currentSlot={prevStationSlot}
                onSelect={() => onTuneStation(prevStation.id)}
                compact
              />
            )}
            {nextStation && (
              <AdjacentStationCard
                direction="next"
                station={nextStation}
                currentSlot={nextStationSlot}
                onSelect={() => onTuneStation(nextStation.id)}
                compact
              />
            )}
          </div>
        )}

        {/* Progress / Seek Bar */}
        {nowPlaying && (
          <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm font-mono tabular-nums text-zinc-300">
            <span className="w-10 sm:w-12 text-right">{formatTime(clampedPosMs)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(1, durationMs)}
              value={clampedPosMs}
              disabled={!canSeek}
              onChange={(e) => onSeekWithinTrack(Number(e.target.value))}
              className="flex-1 h-2 sm:h-2.5 rounded-xl accent-indigo-500 cursor-pointer disabled:opacity-50"
              title={
                canSeek
                  ? 'Seek within current track'
                  : 'Seeking unlocks once background audio transcode completes'
              }
            />
            <span className="w-10 sm:w-12">{formatTime(durationMs)}</span>
          </div>
        )}

        {/* Oversized 5-Button Control Deck (CH - | Prev | Play/Pause | Next | CH +) */}
        <div className="grid grid-cols-5 gap-2 sm:gap-4 max-w-2xl sm:max-w-3xl mx-auto w-full">
          {/* 1. CH - (Previous Station or Random Station when Shuffle is active) */}
          <button
            onClick={onPrevStation}
            disabled={stations.length <= 1}
            className={`min-h-[56px] sm:min-h-[72px] md:min-h-[80px] rounded-2xl bg-white/10 hover:bg-white/20 active:scale-98 border text-white font-bold text-xs sm:text-base flex flex-col items-center justify-center gap-1 disabled:opacity-40 transition cursor-pointer shadow-sm ${
              isStationShuffle
                ? 'border-indigo-400/60 bg-indigo-950/30 text-indigo-200'
                : 'border-white/15'
            }`}
            title={
              isStationShuffle
                ? 'Random Radio Station (Master Shuffle ON)'
                : 'Previous Radio Station'
            }
          >
            {isStationShuffle ? (
              <Shuffle className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-300" />
            ) : (
              <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
            )}
            <span className="font-mono text-[10px] sm:text-xs">
              {isStationShuffle ? 'RND CH' : 'CH -'}
            </span>
          </button>

          {/* 2. Prev Track */}
          <button
            onClick={onPrevTrack}
            disabled={empty || !nowPlaying || isRealtimeLocked}
            className="min-h-[56px] sm:min-h-[72px] md:min-h-[80px] rounded-2xl bg-white/10 hover:bg-white/20 active:scale-98 border border-white/15 text-white font-semibold text-[11px] sm:text-base flex flex-col items-center justify-center gap-1 disabled:opacity-35 transition cursor-pointer shadow-sm"
            title={
              isRealtimeLocked
                ? 'Track skipping is disabled while Realtime Lock is enabled'
                : 'Previous Track on Station'
            }
          >
            <SkipBack className="w-5 h-5 sm:w-6 sm:h-6" />
            <span className="text-[10px] sm:text-xs font-semibold">Prev</span>
          </button>

          {/* 3. Hero Play / Pause */}
          <button
            onClick={onTogglePlayPause}
            disabled={empty || !nowPlaying}
            className="min-h-[56px] sm:min-h-[72px] md:min-h-[80px] rounded-2xl bg-indigo-600 hover:bg-indigo-500 active:scale-98 text-white font-bold text-xs sm:text-base flex flex-col items-center justify-center gap-1 shadow-xl shadow-indigo-600/30 disabled:opacity-40 transition cursor-pointer"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <>
                <Pause className="w-6 h-6 sm:w-7 sm:h-7 fill-current" />
                <span className="text-[10px] sm:text-xs font-semibold">Pause</span>
              </>
            ) : (
              <>
                <Play className="w-6 h-6 sm:w-7 sm:h-7 fill-current ml-0.5" />
                <span className="text-[10px] sm:text-xs font-semibold">Play</span>
              </>
            )}
          </button>

          {/* 4. Next Track */}
          <button
            onClick={onNextTrack}
            disabled={empty || !nowPlaying || isRealtimeLocked}
            className="min-h-[56px] sm:min-h-[72px] md:min-h-[80px] rounded-2xl bg-white/10 hover:bg-white/20 active:scale-98 border border-white/15 text-white font-semibold text-[11px] sm:text-base flex flex-col items-center justify-center gap-1 disabled:opacity-35 transition cursor-pointer shadow-sm"
            title={
              isRealtimeLocked
                ? 'Track skipping is disabled while Realtime Lock is enabled'
                : 'Next Track on Station'
            }
          >
            <SkipForward className="w-5 h-5 sm:w-6 sm:h-6" />
            <span className="text-[10px] sm:text-xs font-semibold">Next</span>
          </button>

          {/* 5. CH + (Next Station or Random Station when Shuffle is active) */}
          <button
            onClick={onNextStation}
            disabled={stations.length <= 1}
            className={`min-h-[56px] sm:min-h-[72px] md:min-h-[80px] rounded-2xl bg-white/10 hover:bg-white/20 active:scale-98 border text-white font-bold text-xs sm:text-base flex flex-col items-center justify-center gap-1 disabled:opacity-40 transition cursor-pointer shadow-sm ${
              isStationShuffle
                ? 'border-indigo-400/60 bg-indigo-950/30 text-indigo-200'
                : 'border-white/15'
            }`}
            title={
              isStationShuffle
                ? 'Random Radio Station (Master Shuffle ON)'
                : 'Next Radio Station'
            }
          >
            {isStationShuffle ? (
              <Shuffle className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-300" />
            ) : (
              <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
            )}
            <span className="font-mono text-[10px] sm:text-xs">
              {isStationShuffle ? 'RND CH' : 'CH +'}
            </span>
          </button>
        </div>

        {/* Master Station Shuffle Toggle Bar */}
        <div className="flex items-center justify-center pt-0.5 sm:pt-1">
          <button
            type="button"
            onClick={toggleStationShuffle}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition cursor-pointer ${
              isStationShuffle
                ? 'bg-indigo-600 border-indigo-400 text-white shadow-md shadow-indigo-600/30'
                : 'bg-white/10 hover:bg-white/15 border-white/10 text-zinc-300 hover:text-white'
            }`}
            title={
              isStationShuffle
                ? 'Master Station Shuffle: ON (Switching stations jumps to random stations. Shortcut: S)'
                : 'Master Station Shuffle: OFF (Switching stations moves to adjacent stations. Shortcut: S)'
            }
            aria-label="Toggle Master Station Shuffle"
            aria-pressed={isStationShuffle}
          >
            <Shuffle className="w-3.5 h-3.5" />
            <span>Station Shuffle: {isStationShuffle ? 'ON' : 'OFF'}</span>
            <kbd className="hidden sm:inline text-[9px] font-mono px-1 py-0.5 rounded bg-black/40 text-zinc-300">
              S
            </kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
