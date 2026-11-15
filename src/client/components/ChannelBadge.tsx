import {
  Calendar,
  Disc,
  ListMusic,
  Mic2,
  Play,
  Radio,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { STATION_CATEGORY_FORMULA } from '../../shared/stationVisuals.ts';
import type { StationCategory } from '../../shared/types.ts';
import { useAppearance } from '../hooks/useAppearance.ts';

export function StationCategoryIcon({
  category,
  className = 'w-3.5 h-3.5',
}: {
  category: StationCategory;
  className?: string;
}) {
  switch (category) {
    case 'discography':
      return <Disc className={className} />;
    case 'artist_mix':
      return <Mic2 className={className} />;
    case 'era':
      return <Calendar className={className} />;
    case 'genre':
      return <Sparkles className={className} />;
    case 'curated':
      return <ListMusic className={className} />;
    case 'library':
    default:
      return <Radio className={className} />;
  }
}

export function StationCategoryPill({
  category,
  compact = false,
}: {
  category: StationCategory;
  compact?: boolean;
}) {
  const meta = STATION_CATEGORY_FORMULA[category] || STATION_CATEGORY_FORMULA.library;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border font-medium leading-none shrink-0 ${
        compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-1.5 py-0.5 text-[10px]'
      } ${meta.badgeBgClass} ${meta.badgeTextClass} ${meta.badgeBorderClass}`}
      title={meta.label}
    >
      <StationCategoryIcon
        category={category}
        className={compact ? 'w-2.5 h-2.5 shrink-0' : 'w-3 h-3 shrink-0'}
      />
      <span>{meta.shortLabel}</span>
    </span>
  );
}

interface ChannelBadgeProps {
  channelNumber: number | string;
  tileColor: string;
  thumbnailUrl?: string | null;
  category?: StationCategory;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  isTuned?: boolean;
  isPlaying?: boolean;
  className?: string;
}

export function ChannelBadge({
  channelNumber,
  tileColor,
  thumbnailUrl,
  category = 'library',
  size = 'md',
  isTuned = false,
  isPlaying = false,
  className = '',
}: ChannelBadgeProps) {
  const { appearance } = useAppearance();
  const isCircle = appearance.badgeShape === 'circle';

  const sizeClasses: Record<NonNullable<ChannelBadgeProps['size']>, string> = {
    sm: `w-9 h-9 ${isCircle ? 'rounded-full' : 'rounded-xl'}`,
    md: `w-10 h-10 ${isCircle ? 'rounded-full' : 'rounded-xl'}`,
    lg: `w-12 h-12 ${isCircle ? 'rounded-full' : 'rounded-2xl'}`,
    xl: `w-16 h-16 ${isCircle ? 'rounded-full' : 'rounded-2xl'}`,
  };

  const chHeaderClasses: Record<NonNullable<ChannelBadgeProps['size']>, string> = {
    sm: 'text-[8px]',
    md: 'text-[9px]',
    lg: 'text-[10px]',
    xl: 'text-xs',
  };

  const numClasses: Record<NonNullable<ChannelBadgeProps['size']>, string> = {
    sm: 'text-xs',
    md: 'text-xs sm:text-sm',
    lg: 'text-sm sm:text-base',
    xl: 'text-lg sm:text-xl',
  };

  return (
    <div
      className={`${sizeClasses[size]} relative flex flex-col items-center justify-center text-white font-bold shadow-xs shrink-0 select-none ${className}`}
      style={{ backgroundColor: tileColor }}
    >
      <div className="w-full h-full rounded-[inherit] overflow-hidden relative flex flex-col items-center justify-center">
        {thumbnailUrl ? (
          <>
            <img
              src={thumbnailUrl}
              alt={`CH ${channelNumber}`}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
            <div className="absolute bottom-0.5 inset-x-0.5 flex items-center justify-center">
              <span className="px-1 py-0.2 rounded bg-black/65 backdrop-blur-xs text-[9px] font-mono font-bold tracking-tight text-white leading-tight shadow-2xs">
                CH {channelNumber}
              </span>
            </div>
          </>
        ) : (
          <>
            {/* Top subtle studio sheen */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-black/20 pointer-events-none" />
            {/* Optional category watermark glyph in corner */}
            {appearance.badgeShowCategoryIcon && (
              <div className="absolute -bottom-1 -right-1 opacity-20 pointer-events-none">
                <StationCategoryIcon
                  category={category}
                  className={size === 'xl' ? 'w-8 h-8' : 'w-5 h-5'}
                />
              </div>
            )}
            <span
              className={`${chHeaderClasses[size]} uppercase tracking-wider opacity-85 leading-none relative z-10`}
            >
              CH
            </span>
            <span
              className={`${numClasses[size]} font-mono tabular-nums leading-tight relative z-10`}
            >
              {channelNumber}
            </span>
          </>
        )}
      </div>

      {isTuned && (
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-indigo-600 ring-2 ring-white dark:ring-zinc-900 text-white flex items-center justify-center shadow z-20">
          {isPlaying ? (
            <Volume2 className="w-2.5 h-2.5" />
          ) : (
            <Play className="w-2.5 h-2.5 fill-current" />
          )}
        </span>
      )}
    </div>
  );
}
