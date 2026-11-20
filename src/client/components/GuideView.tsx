import {
  Clock,
  Edit3,
  Moon,
  Radio,
  RefreshCw,
  Star,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isOvernightDaypartHour } from '../../shared/metadataNormalizer.ts';
import { buildStationRuleSummaryPills } from '../../shared/stationVisuals.ts';
import type {
  EpgResponse,
  StationWithStats,
} from '../../shared/types.ts';
import {
  formatBroadcastWallTime,
  useAppearance,
  type GuideVisibleMinutesPreference,
  type GuideVisibleMinutesMobilePreference,
} from '../hooks/useAppearance.ts';
import { ChannelBadge, StationCategoryPill } from './ChannelBadge.tsx';

interface GuideViewProps {
  epg: EpgResponse | null;
  loading: boolean;
  nowServerMs: number;
  activeStationId: string | null;
  activeSlotStartMs: number | null;
  offsetMs: number;
  currentTrackPositionMs: number;
  isPlaying: boolean;
  onTuneStation: (stationId: string) => void;
  onSelectSlot: (stationId: string, slotStartMs: number) => void;
  onEditStation: (stationId: string) => void;
  onRefreshGuide: () => void;
}

function isAlbumOrArtistChannel(station: StationWithStats): boolean {
  const hasArtists = Boolean(
    station.rules.artists && station.rules.artists.length > 0
  );
  const hasAlbums = Boolean(
    station.rules.albums && station.rules.albums.length > 0
  );
  return hasArtists || hasAlbums || station.playMode === 'album_shuffle';
}

/** Timelines narrower than this (phones) use the phone zoom levels. */
const PHONE_TIMELINE_MAX_PX = 560;
const PHONE_ZOOM_OPTIONS = [5, 10, 15] as const;
const DESKTOP_ZOOM_OPTIONS = [15, 25, 45] as const;

function pixelsPerSecondFor(viewportWidthPx: number, minutes: number, isPhone: boolean): number {
  const raw = viewportWidthPx / (minutes * 60);
  return isPhone ? Math.max(0.15, Math.min(3, raw)) : Math.max(0.22, Math.min(1.15, raw));
}

export function GuideView({
  epg,
  loading,
  nowServerMs,
  activeStationId,
  activeSlotStartMs,
  offsetMs: _offsetMs,
  currentTrackPositionMs,
  isPlaying,
  onTuneStation,
  onSelectSlot,
  onEditStation,
  onRefreshGuide,
}: GuideViewProps) {
  const { appearance, updateAppearance } = useAppearance();
  const headerRulerRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const isSyncingScrollRef = useRef<boolean>(false);
  const didInitialScrollRef = useRef<boolean>(false);
  const [viewportWidthPx, setViewportWidthPx] = useState<number>(750);
  const [widthMeasured, setWidthMeasured] = useState<boolean>(false);
  const [scrollLeftPx, setScrollLeftPx] = useState<number>(0);

  // Measure the timeline viewport width so the configured visible span fits comfortably on both mobile & desktop
  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;

    const updateWidth = () => {
      if (el.clientWidth > 0) {
        setViewportWidthPx(el.clientWidth);
        setWidthMeasured(true);
      }
      setScrollLeftPx(el.scrollLeft);
      if (
        headerRulerRef.current &&
        headerRulerRef.current.scrollLeft !== el.scrollLeft
      ) {
        headerRulerRef.current.scrollLeft = el.scrollLeft;
      }
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    window.addEventListener('resize', updateWidth);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, []);

  // Phone-sized timelines get their own zoom levels (5m / 10m / 15m, like the iOS app),
  // so song blocks are wide enough to read. Wider screens keep 15m / 25m / 45m.
  const isPhoneTimeline = viewportWidthPx < PHONE_TIMELINE_MAX_PX;
  const zoomOptions: readonly number[] = isPhoneTimeline ? PHONE_ZOOM_OPTIONS : DESKTOP_ZOOM_OPTIONS;
  const visibleMinutes = isPhoneTimeline
    ? appearance.guideVisibleMinutesMobile || 5
    : appearance.guideVisibleMinutes || 25;

  // Compute dynamic pixels-per-second for the visible span
  const pixelsPerSecond = useMemo(
    () => pixelsPerSecondFor(viewportWidthPx, visibleMinutes, isPhoneTimeline),
    [viewportWidthPx, visibleMinutes, isPhoneTimeline]
  );

  // Row height classes based on appearance.guideDensity (~20% tighter on mobile)
  const rowHeightClass =
    appearance.guideDensity === 'compact'
      ? 'h-14 sm:h-16'
      : appearance.guideDensity === 'comfortable'
        ? 'h-20 sm:h-24'
        : 'h-16 sm:h-20';

  // Window bounds for the horizontally scrollable timeline (full EPG window: -15m to +90m)
  const windowStartMs = epg ? epg.fromMs : nowServerMs - 15 * 60 * 1000;
  const windowEndMs = epg ? epg.toMs : nowServerMs + 60 * 60 * 1000;
  const totalWindowSec = Math.max(60, (windowEndMs - windowStartMs) / 1000);
  const totalWidthPx = Math.round(totalWindowSec * pixelsPerSecond);

  const nowLeftPx = Math.max(
    0,
    Math.min(
      totalWidthPx,
      Math.round(((nowServerMs - windowStartMs) / 1000) * pixelsPerSecond)
    )
  );

  // Synchronized horizontal scrolling between the frozen Time ruler header and the main timeline rows
  const handleTimelineScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const sl = e.currentTarget.scrollLeft;
    setScrollLeftPx(sl);
    if (isSyncingScrollRef.current) return;
    if (headerRulerRef.current && headerRulerRef.current.scrollLeft !== sl) {
      isSyncingScrollRef.current = true;
      headerRulerRef.current.scrollLeft = sl;
      requestAnimationFrame(() => {
        isSyncingScrollRef.current = false;
      });
    }
  };

  const handleHeaderScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const sl = e.currentTarget.scrollLeft;
    if (isSyncingScrollRef.current) return;
    if (
      timelineScrollRef.current &&
      timelineScrollRef.current.scrollLeft !== sl
    ) {
      isSyncingScrollRef.current = true;
      timelineScrollRef.current.scrollLeft = sl;
      setScrollLeftPx(sl);
      requestAnimationFrame(() => {
        isSyncingScrollRef.current = false;
      });
    }
  };

  const handleJumpToNow = () => {
    if (timelineScrollRef.current) {
      const leadInPx = Math.round(
        timelineScrollRef.current.clientWidth * 0.15
      );
      const target = Math.max(0, nowLeftPx - leadInPx);
      timelineScrollRef.current.scrollTo({
        left: target,
        behavior: 'smooth',
      });
      if (headerRulerRef.current) {
        headerRulerRef.current.scrollTo({
          left: target,
          behavior: 'smooth',
        });
      }
    }
  };

  const handleZoomChange = (mins: number) => {
    if (isPhoneTimeline) {
      updateAppearance({ guideVisibleMinutesMobile: mins as GuideVisibleMinutesMobilePreference });
    } else {
      updateAppearance({ guideVisibleMinutes: mins as GuideVisibleMinutesPreference });
    }
    requestAnimationFrame(() => {
      if (timelineScrollRef.current) {
        const newPPS = pixelsPerSecondFor(viewportWidthPx, mins, isPhoneTimeline);
        const newNowLeft = Math.round(
          ((nowServerMs - windowStartMs) / 1000) * newPPS
        );
        const leadIn = Math.round(timelineScrollRef.current.clientWidth * 0.15);
        const target = Math.max(0, newNowLeft - leadIn);
        timelineScrollRef.current.scrollLeft = target;
        if (headerRulerRef.current) {
          headerRulerRef.current.scrollLeft = target;
        }
        setScrollLeftPx(target);
      }
    });
  };

  // Position the "Now" marker ~15% from the left edge of the viewport on first load
  useEffect(() => {
    // Wait for the real width, so the zoom (and the Now position) is right before scrolling.
    if (!epg || !widthMeasured || didInitialScrollRef.current || !timelineScrollRef.current) return;
    const container = timelineScrollRef.current;
    const leadInPx = Math.round(container.clientWidth * 0.15);
    const targetScroll = Math.max(0, nowLeftPx - leadInPx);
    container.scrollLeft = targetScroll;
    if (headerRulerRef.current) {
      headerRulerRef.current.scrollLeft = targetScroll;
    }
    setScrollLeftPx(container.scrollLeft);
    didInitialScrollRef.current = true;
  }, [epg, nowLeftPx, widthMeasured]);

  // Ruler ticks every 5 minutes (every 2 minutes on the closest phone zoom)
  const rulerStepMinutes = isPhoneTimeline && visibleMinutes <= 5 ? 2 : 5;
  const rulerTicks = useMemo(() => {
    const stepMs = rulerStepMinutes * 60 * 1000;
    const firstTick = Math.ceil(windowStartMs / stepMs) * stepMs;
    const ticks: Array<{ ms: number; leftPx: number; label: string }> = [];
    for (let t = firstTick; t <= windowEndMs; t += stepMs) {
      const leftPx = Math.round(((t - windowStartMs) / 1000) * pixelsPerSecond);
      ticks.push({
        ms: t,
        leftPx,
        label: formatBroadcastWallTime(t, appearance.timeFormat),
      });
    }
    return ticks;
  }, [windowStartMs, windowEndMs, pixelsPerSecond, appearance.timeFormat, rulerStepMinutes]);

  if (loading && !epg) {
    return (
      <div className="py-12 sm:py-16 flex flex-col items-center justify-center gap-3 text-zinc-500 dark:text-zinc-400">
        <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
        <p className="text-sm">Loading live station guide...</p>
      </div>
    );
  }

  const stations = epg?.stations || [];
  const isServerNight = isOvernightDaypartHour(new Date(nowServerMs).getHours());

  return (
    <div className="relative">
      {/* Frozen Top Frame: Always pinned at the top when scrolling down, covering everything down to the 'Channel' and 'Time' sections */}
      <div className="sticky top-11 sm:top-14 z-20 bg-zinc-100 dark:bg-zinc-950 pt-2 sm:pt-4 pb-0">
        {/* Guide Subheader */}
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 pb-2 sm:pb-3">
          <div className="flex items-center gap-1.5 sm:gap-2.5">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-500 animate-pulse" />
              ON AIR
            </span>
            <span className="text-[11px] sm:text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1 font-mono tabular-nums">
              <Clock className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="hidden xs:inline">Server Time:</span>{' '}
              {formatBroadcastWallTime(nowServerMs, appearance.timeFormat)}
            </span>
            {isServerNight && (
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                <Moon className="w-3 h-3" />
                Night Rotation Window (8 PM–6 AM)
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            {/* EPG Timeline Zoom: Small understated text buttons (15m, 25m, 45m) */}
            <div className="flex items-center gap-0.5 sm:gap-1 text-[10px] sm:text-xs text-zinc-500 dark:text-zinc-400 mr-0.5 sm:mr-1">
              <span className="hidden xs:inline text-zinc-400 dark:text-zinc-500 text-[10px] font-medium mr-0.5">
                Zoom:
              </span>
              {zoomOptions.map((mins) => {
                const isSelected = visibleMinutes === mins;
                return (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => handleZoomChange(mins)}
                    className={`px-1 sm:px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-mono transition cursor-pointer ${
                      isSelected
                        ? 'text-indigo-600 dark:text-indigo-400 font-bold underline decoration-2 underline-offset-2'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                    title={`Zoom timeline to ${mins} minutes visible span`}
                  >
                    {mins}m
                  </button>
                );
              })}
            </div>

            <button
              onClick={handleJumpToNow}
              className="px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-medium bg-zinc-200/70 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 transition cursor-pointer whitespace-nowrap"
            >
              Jump to Now
            </button>
            <button
              onClick={onRefreshGuide}
              className="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-medium bg-zinc-200/70 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 transition cursor-pointer whitespace-nowrap"
              title="Refresh schedule window"
            >
              <RefreshCw className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="hidden xs:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Frozen 'Channel' and 'Time' Header Sections */}
        <div className="rounded-t-xl sm:rounded-t-2xl border-t border-x border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-xs">
          <div className="flex border-b border-zinc-200 dark:border-zinc-800 shadow-xs">
            {/* Left: 'Channel' Header Section */}
            <div className="w-32 sm:w-56 shrink-0 h-7 sm:h-9 px-2 sm:px-3 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900 text-[10px] sm:text-xs font-medium text-zinc-500 dark:text-zinc-400 border-r border-zinc-200 dark:border-zinc-800">
              <span>Channel</span>
            </div>

            {/* Right: 'Time' Ruler Header Section (horizontally synced with timeline scroll) */}
            <div
              ref={headerRulerRef}
              onScroll={handleHeaderScroll}
              className="flex-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden relative select-none bg-zinc-50 dark:bg-zinc-900 h-7 sm:h-9"
            >
              <div
                className="h-full relative"
                style={{ width: `${totalWidthPx}px` }}
              >
                {rulerTicks.map((tick) => (
                  <div
                    key={tick.ms}
                    className="absolute top-0 bottom-0 border-l border-zinc-200 dark:border-zinc-800 pl-1.5 flex items-center text-[9px] sm:text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400"
                    style={{ left: `${tick.leftPx}px` }}
                  >
                    {tick.label}
                  </div>
                ))}

                {/* Vertical Red 'NOW' Marker Badge in frozen ruler */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-20 pointer-events-none"
                  style={{ left: `${nowLeftPx}px` }}
                >
                  <div className="px-1.5 py-0.5 rounded bg-rose-500 text-white text-[8px] sm:text-[9px] font-bold tracking-wider uppercase -translate-x-1/2 whitespace-nowrap shadow">
                    NOW
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main EPG Stations Body: Left Channel Lineup | Right Scrollable Media Cards Timeline */}
      <div className="relative z-10 isolate rounded-b-xl sm:rounded-b-2xl border-b border-x border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
        {stations.length === 0 ? (
          <div className="p-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No enabled stations found.
          </div>
        ) : (
          <div className="flex">
            {/* Left Column: Compact Channel Number, Tile, Station Name/Category, and Quick Edit Button */}
            <div className="w-32 sm:w-56 shrink-0 border-r border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800 bg-white dark:bg-zinc-900 z-10">
              {stations.map(({ station }) => {
                const isTuned = station.id === activeStationId;
                const rulePills = buildStationRuleSummaryPills(station.rules);

                return (
                  <div
                    key={station.id}
                    onClick={() => onTuneStation(station.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onTuneStation(station.id);
                      }
                    }}
                    className={`${rowHeightClass} px-1.5 sm:px-2.5 py-1 sm:py-1.5 flex items-center gap-1.5 sm:gap-2.5 transition cursor-pointer select-none ${
                      isTuned
                        ? 'bg-indigo-50/90 dark:bg-indigo-950/40'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <div className="shrink-0">
                      <div className="sm:hidden">
                        <ChannelBadge
                          channelNumber={station.channelNumber}
                          tileColor={station.tileColor}
                          thumbnailUrl={station.thumbnailUrl}
                          category={station.category}
                          size="sm"
                          isTuned={isTuned}
                          isPlaying={isPlaying}
                        />
                      </div>
                      <div className="hidden sm:block">
                        <ChannelBadge
                          channelNumber={station.channelNumber}
                          tileColor={station.tileColor}
                          thumbnailUrl={station.thumbnailUrl}
                          category={station.category}
                          size={
                            appearance.guideDensity === 'compact' ? 'sm' : 'md'
                          }
                          isTuned={isTuned}
                          isPlaying={isPlaying}
                        />
                      </div>
                    </div>

                    <div className="min-w-0 flex-1 flex flex-col items-start justify-center">
                      <div className="w-full flex items-center justify-between gap-1">
                        <span className="text-[11px] sm:text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate leading-tight flex-1">
                          {station.name}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const isCurrentDefault =
                              appearance.defaultStationId === station.id;
                            updateAppearance({
                              defaultStationId: isCurrentDefault ? null : station.id,
                            });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.stopPropagation();
                            }
                          }}
                          className={`p-1 -mr-1 rounded-md transition cursor-pointer shrink-0 ${
                            appearance.defaultStationId === station.id
                              ? 'text-zinc-700 dark:text-zinc-200'
                              : 'text-zinc-300 dark:text-zinc-600 hover:text-zinc-700 hover:dark:text-zinc-200'
                          }`}
                          title={
                            appearance.defaultStationId === station.id
                              ? 'Default Autoplay Station (Click to remove default designation)'
                              : `Set ${station.name} as Default Autoplay Station`
                          }
                          aria-label={
                            appearance.defaultStationId === station.id
                              ? `Remove ${station.name} as default station`
                              : `Set ${station.name} as default station`
                          }
                        >
                          <Star
                            className={`w-3.5 h-3.5 transition ${
                              appearance.defaultStationId === station.id
                                ? 'fill-zinc-700 text-zinc-700 dark:fill-zinc-200 dark:text-zinc-200 drop-shadow-xs'
                                : 'hover:fill-zinc-400/30 dark:hover:fill-zinc-300/30'
                            }`}
                          />
                        </button>
                      </div>
                      {appearance.guideShowRuleSummary &&
                        appearance.guideDensity !== 'compact' && (
                          <div className="mt-0.5 sm:mt-1 flex items-center gap-1 max-w-full overflow-hidden">
                            <StationCategoryPill
                              category={station.category}
                              compact
                            />
                            {station.daypartsEnabled && (
                              <span
                                className="inline-flex items-center gap-0.5 text-[9px] font-medium text-indigo-600 dark:text-indigo-400 shrink-0"
                                title={
                                  isServerNight
                                    ? 'Night Rotation active (8 PM–6 AM Chill)'
                                    : 'Radio Dayparting enabled (8 PM–6 AM Chill)'
                                }
                              >
                                <Moon className="w-2.5 h-2.5" />
                                <span className="hidden sm:inline">
                                  {isServerNight ? 'Night' : '8P–6A'}
                                </span>
                              </span>
                            )}
                            {!station.daypartsEnabled && rulePills[0] && (
                              <span className="hidden sm:inline text-[9px] text-zinc-500 dark:text-zinc-400 truncate">
                                {rulePills[0]}
                              </span>
                            )}
                          </div>
                        )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditStation(station.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                          }
                        }}
                        className="mt-0.5 sm:mt-1 inline-flex items-center gap-0.5 sm:gap-1 px-1 sm:px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-medium bg-zinc-100 hover:bg-indigo-100 dark:bg-zinc-800 dark:hover:bg-indigo-950/80 text-zinc-600 hover:text-indigo-600 dark:text-zinc-300 dark:hover:text-indigo-400 border border-zinc-200/80 dark:border-zinc-700/80 hover:border-indigo-300 dark:hover:border-indigo-700 transition cursor-pointer leading-none"
                        title={`Edit ${station.name} & station rules`}
                      >
                        <Edit3 className="w-2.5 h-2.5" />
                        <span>Edit</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Right Column: Horizontally Scrollable Media Cards Timeline */}
            <div
              ref={timelineScrollRef}
              onScroll={handleTimelineScroll}
              className="flex-1 overflow-x-auto relative select-none"
            >
              <div
                className="relative divide-y divide-zinc-200 dark:divide-zinc-800"
                style={{ width: `${totalWidthPx}px` }}
              >
                {/* Vertical Red "NOW" Marker Line spanning all station rows */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-10 pointer-events-none"
                  style={{ left: `${nowLeftPx}px` }}
                />

                {/* Timeline Rows per Station */}
                {stations.map(({ station, empty, slots }) => {
                  const isTuned = station.id === activeStationId;
                  const showAlbumDetails =
                    isAlbumOrArtistChannel(station) &&
                    appearance.guideDensity !== 'compact';
                  const visibleSlots = slots.filter(
                    (s) => s.endMs > windowStartMs && s.startMs < windowEndMs
                  );

                  return (
                    <div
                      key={station.id}
                      onClick={() => onTuneStation(station.id)}
                      className={`${rowHeightClass} relative cursor-pointer transition ${
                        isTuned
                          ? 'bg-indigo-50/40 dark:bg-indigo-950/20'
                          : 'hover:bg-zinc-50/70 dark:hover:bg-zinc-800/30'
                      }`}
                    >
                      {empty ? (
                        <div className="h-full flex items-center gap-2 px-4 sm:px-6 text-[11px] sm:text-xs text-amber-600 dark:text-amber-400">
                          <Radio className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                          <span>Empty station (no matching tracks)</span>
                        </div>
                      ) : (
                        visibleSlots.map((slot) => {
                          const clampedStart = Math.max(windowStartMs, slot.startMs);
                          const clampedEnd = Math.min(windowEndMs, slot.endMs);
                          const leftPx = Math.round(
                            ((clampedStart - windowStartMs) / 1000) * pixelsPerSecond
                          );
                          const widthPx = Math.max(
                            18,
                            Math.round(
                              ((clampedEnd - clampedStart) / 1000) * pixelsPerSecond
                            ) - 2
                          );
                          const isCurrent =
                            slot.startMs <= nowServerMs && slot.endMs > nowServerMs;
                          const isPlayingSlot =
                            isTuned && activeSlotStartMs === slot.startMs;

                          const elapsedMs = isPlayingSlot && !isCurrent
                            ? Math.max(0, currentTrackPositionMs)
                            : isCurrent
                              ? Math.max(0, nowServerMs - slot.startMs)
                              : 0;
                          const progressPct =
                            isCurrent || isPlayingSlot
                              ? Math.min(
                                  100,
                                  Math.max(0, (elapsedMs / slot.track.durationMs) * 100)
                                )
                              : 0;

                          const playheadInCardPx = isCurrent
                            ? Math.max(0, nowLeftPx - leftPx)
                            : 0;

                          // Keep labels aligned to the left of each card, but move with the left edge
                          // of the visible scroll window when a card is partially scrolled off-screen to the left.
                          const windowCutPx = Math.max(0, scrollLeftPx - leftPx);
                          const minReadableWidthPx = Math.min(
                            84,
                            Math.max(24, widthPx - 12)
                          );
                          const maxFollowOffsetPx = Math.max(
                            0,
                            widthPx - minReadableWidthPx
                          );
                          const windowFollowOffsetPx = Math.min(
                            maxFollowOffsetPx,
                            windowCutPx
                          );

                          const handleCardClick = (e: React.MouseEvent) => {
                            e.stopPropagation();
                            if (appearance.realtimeLock || (isCurrent && !isTuned)) {
                              onTuneStation(station.id);
                            } else {
                              onSelectSlot(station.id, slot.startMs);
                            }
                          };

                          return (
                            <div
                              key={`${slot.cycleNumber}-${slot.indexInCycle}-${slot.startMs}`}
                              role="button"
                              tabIndex={0}
                              onClick={handleCardClick}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (appearance.realtimeLock || (isCurrent && !isTuned)) {
                                    onTuneStation(station.id);
                                  } else {
                                    onSelectSlot(station.id, slot.startMs);
                                  }
                                }
                              }}
                              style={{
                                left: `${leftPx}px`,
                                width: `${widthPx}px`,
                              }}
                              title={
                                appearance.realtimeLock
                                  ? `${slot.track.artist} — ${slot.track.title} (Click to tune live to CH ${station.channelNumber} · Realtime Lock enabled)`
                                  : showAlbumDetails
                                    ? `Click to play: ${slot.track.artist} — ${slot.track.title} • ${slot.track.album} (Track ${slot.track.trackNumber} of ${slot.track.albumTrackCount})`
                                    : `Click to play: ${slot.track.artist} — ${slot.track.title}`
                              }
                              className={`group absolute top-1 bottom-1 rounded-lg px-1.5 sm:px-2 py-1 sm:py-1.5 border overflow-hidden flex flex-col justify-between transition cursor-pointer ${
                                isPlayingSlot && !isCurrent
                                  ? 'bg-indigo-600/20 dark:bg-indigo-500/30 border-indigo-500 ring-1 ring-indigo-500/60 text-zinc-900 dark:text-white shadow-xs z-10'
                                  : isCurrent
                                    ? 'bg-indigo-600/15 dark:bg-indigo-500/25 border-indigo-500/70 hover:border-indigo-500 text-zinc-900 dark:text-white shadow-xs z-10'
                                    : 'bg-zinc-100/90 dark:bg-zinc-800/70 border-zinc-200/90 dark:border-zinc-700/70 hover:bg-indigo-50/80 dark:hover:bg-indigo-950/40 hover:border-indigo-400/70 text-zinc-700 dark:text-zinc-300'
                              }`}
                            >
                              {/* Subtle shaded elapsed region behind the playhead on the active card */}
                              {isCurrent && playheadInCardPx > 0 && (
                                <div
                                  className="absolute inset-y-0 left-0 bg-indigo-950/10 dark:bg-black/25 pointer-events-none"
                                  style={{
                                    width: `${Math.min(widthPx, playheadInCardPx)}px`,
                                  }}
                                />
                              )}

                              <div
                                className="min-w-0 relative z-10"
                                style={
                                  windowFollowOffsetPx > 0
                                    ? { paddingLeft: `${windowFollowOffsetPx}px` }
                                    : undefined
                                }
                              >
                                {/* Track Title & Artist Name */}
                                <div className="text-[10px] sm:text-xs font-semibold truncate leading-tight group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">
                                  {slot.track.title}
                                </div>
                                <div className="text-[9px] sm:text-[11px] text-zinc-600 dark:text-zinc-300 truncate leading-tight mt-0.5">
                                  {slot.track.artist}
                                </div>

                                {/* Album Name + Track X of Y (Only on album or artist channels) */}
                                {showAlbumDetails && (
                                  <div className="hidden sm:block text-[9px] sm:text-[10px] text-indigo-600 dark:text-indigo-300 truncate leading-tight mt-0.5">
                                    {slot.track.album} &middot; {slot.track.trackNumber}/
                                    {slot.track.albumTrackCount}
                                  </div>
                                )}
                              </div>

                              {/* Live progress bar at the bottom of the currently playing media card */}
                              {(isCurrent || isPlayingSlot) && (
                                <div className="w-full h-0.5 sm:h-1 rounded-full bg-zinc-300/70 dark:bg-zinc-700 overflow-hidden mt-0.5 sm:mt-1 relative z-10">
                                  <div
                                    className="h-full bg-indigo-600 dark:bg-indigo-400 transition-all duration-300"
                                    style={{ width: `${progressPct}%` }}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
