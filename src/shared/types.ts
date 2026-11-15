export const APP_VERSION = '0.8';

export const SUPPORTED_EXTENSIONS = [
  '.mp3',
  '.m4a',
  '.aac',
  '.flac',
  '.ogg',
  '.oga',
  '.opus',
  '.wav',
  '.aiff',
  '.aif',
  '.wma',
] as const;

export const DIRECT_PLAY_EXTENSIONS = [
  '.mp3',
  '.m4a',
  '.aac',
  '.flac',
  '.wav',
] as const;

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

export type PlayMode = 'straight' | 'album_shuffle' | 'shuffle';

export type CrossfadeDurationSeconds = 2 | 3 | 5 | 8;

export const CROSSFADE_DURATION_OPTIONS: readonly CrossfadeDurationSeconds[] = [2, 3, 5, 8] as const;

export type RescanIntervalMinutes = 0 | 60 | 360 | 720 | 1440;

export interface NasConfig {
  enabled: boolean;
  protocol: 'smb' | 'nfs';
  host: string;
  sharePath: string;
  username: string;
  password?: string;
  domain?: string;
  vers?: '3.0' | '2.1' | '2.0';
}

export interface PlexServerConnection {
  uri: string;
  address: string;
  port: number;
  protocol: string;
  local: boolean;
  relay: boolean;
}

export interface PlexServerDevice {
  name: string;
  clientIdentifier: string;
  accessToken: string;
  preferredUri: string;
  connections: PlexServerConnection[];
}

export interface PlexRemoteSection {
  key: string;
  title: string;
  type: string;
  connectedLibraryId: string | null;
}

export interface PlexConfig {
  clientId: string;
  authToken?: string;
  username?: string;
  email?: string;
  thumb?: string;
  serverName?: string;
  serverMachineId?: string;
  serverUri?: string;
  serverAccessToken?: string;
}

export interface ServerSettings {
  rescanIntervalMinutes: RescanIntervalMinutes;
  defaultLibraryIds: string[]; // empty array = all enabled libraries
  defaultPlayMode: PlayMode;
  defaultSmartUpdate?: boolean; // default true: stations auto-add new matching library tracks
  nasConfig?: NasConfig;
  plexConfig?: PlexConfig;
  forceTranscodeFlac?: boolean; // When true, transcode FLAC/ALAC to 320k MP3 for Safari/iOS and mobile compatibility
  autoSkipUnplayable?: boolean; // When true (default), automatically skip forward after a track error
}

export type StationCategory =
  | 'discography'
  | 'artist_mix'
  | 'era'
  | 'genre'
  | 'curated'
  | 'library';

export interface StationRules {
  libraryIds?: string[];
  artists?: string[];
  albums?: string[];
  genres?: string[];
  yearMin?: number | null;
  yearMax?: number | null;
  smartUpdate?: boolean; // true (default) = live rule matching; false = locked to pinnedTrackIds snapshot
  pinnedTrackIds?: string[];
  crossfadeEnabled?: boolean;
  crossfadeSeconds?: number;
  thumbnailUrl?: string | null;
  customColor?: boolean;
}

export interface DaypartRule {
  id: string;
  name: string;
  startTime: string; // "HH:MM" in 24-hour wall-clock time
  rules: StationRules;
}

export interface StationRecord {
  id: string;
  name: string;
  channelNumber: number;
  enabled: boolean;
  smartUpdate: boolean;
  crossfadeEnabled: boolean;
  crossfadeSeconds: number;
  playMode: PlayMode;
  rules: StationRules;
  daypartsEnabled: boolean;
  dayparts: DaypartRule[];
  tileColor: string;
  customColor: boolean;
  thumbnailUrl: string | null;
  category: StationCategory;
  seed: number;
  epochMs: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export type TrackEnergyLevel = 1 | 2 | 3;

export interface StationWithStats extends StationRecord {
  matchingTrackCount: number;
  matchingDurationMs: number;
  chillTrackCount?: number;
}

export interface TrackRecord {
  id: string;
  libraryId: string;
  albumId: string;
  filePath: string;
  ext: string;
  fileSize: number;
  mtimeMs: number;
  title: string;
  artist: string;
  albumArtist: string | null;
  album: string;
  albumYear: number | null;
  albumTrackCount: number;
  hasArt: boolean;
  trackNumber: number;
  discNumber: number;
  year: number | null;
  originalYear?: number | null;
  genre: string | null;
  bpm?: number | null;
  mood?: string | null;
  energyLevel?: TrackEnergyLevel;
  isReissueOrComp?: boolean;
  gainDb?: number | null;
  durationMs: number;
}

export interface ScheduledTrackSlot {
  track: {
    id: string;
    albumId: string;
    title: string;
    artist: string;
    album: string;
    trackNumber: number;
    albumTrackCount: number;
    year: number | null;
    originalYear?: number | null;
    genre: string | null;
    energyLevel?: TrackEnergyLevel;
    gainDb?: number | null;
    durationMs: number;
    ext: string;
    directPlay: boolean;
    hasArt: boolean;
    artUrl: string | null;
    audioUrl: string;
  };
  startMs: number;
  endMs: number;
  cycleNumber: number;
  indexInCycle: number;
  daypartId?: 'day' | 'night';
  segmentId?: string;
}

export interface TuneInResponse {
  station: StationWithStats;
  serverTimeMs: number;
  effectiveTimeMs: number;
  offsetMs: number;
  revision: number;
  empty: boolean;
  nowPlaying: (ScheduledTrackSlot & { positionMs: number; transcodeReady: boolean }) | null;
  upNext: ScheduledTrackSlot | null;
}

export interface EpgStationSchedule {
  station: StationWithStats;
  empty: boolean;
  slots: ScheduledTrackSlot[];
}

export interface EpgResponse {
  serverTimeMs: number;
  fromMs: number;
  toMs: number;
  stations: EpgStationSchedule[];
}

export interface LibraryInfo {
  id: string;
  name: string;
  sourceType: 'local' | 'plex';
  path: string;
  enabled: boolean;
  lastScannedAt: number | null;
  trackCount: number;
  albumCount: number;
  artistCount: number;
  /**
   * False only for folders auto-discovered inside a managed music root
   * (Docker's /music), which would simply be re-added on the next refresh.
   */
  removable: boolean;
}

export interface UnreadableFileReport {
  path: string;
  reason: string;
}

export interface TagProblemTrack {
  id: string;
  filePath: string;
  title: string;
  artist: string;
  album: string;
  missingFields: string[];
}

export interface ScanProgress {
  isScanning: boolean;
  /** True once a stop has been requested and the scan is winding down. */
  isCancelling: boolean;
  currentLibrary: string | null;
  filesProcessed: number;
  filesTotal: number;
  currentFile: string | null;
}

export interface ScanRunSummary {
  id: number;
  startedAt: number;
  finishedAt: number | null;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  tracksTotal: number;
  albumsTotal: number;
  artistsTotal: number;
  tagsIncompleteCount: number;
  skippedByExt: Record<string, number>;
  unreadableFiles: UnreadableFileReport[];
}

export interface AlbumSummary {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  trackCount: number;
  durationMs: number;
  hasArt: boolean;
}

export interface ArtistSummary {
  name: string;
  albumCount: number;
  trackCount: number;
  years: number[];
  genres: string[];
}

export interface ScanResultsOverview {
  progress: ScanProgress;
  latestRun: ScanRunSummary | null;
  libraries: LibraryInfo[];
  totals: {
    tracks: number;
    albums: number;
    artists: number;
    tagsIncomplete: number;
  };
  artists: ArtistSummary[];
  albums: AlbumSummary[];
  tagProblemTracks: TagProblemTrack[];
}

export interface StationPreviewResponse {
  matchingTrackCount: number;
  matchingDurationMs: number;
  chillTrackCount: number;
  balancedTrackCount: number;
  upbeatTrackCount: number;
  sampleTracks: Array<{
    id: string;
    title: string;
    artist: string;
    album: string;
    year: number | null;
    originalYear?: number | null;
    genre?: string | null;
    energyLevel?: TrackEnergyLevel;
    durationMs: number;
  }>;
  sampleArtworks: Array<{
    albumId: string;
    album: string;
    artist: string;
    artUrl: string;
    isArtistArt?: boolean;
  }>;
}

export interface StarterSuggestion {
  key: string;
  category: 'artist' | 'decade' | 'genre';
  name: string;
  description: string;
  playMode: PlayMode;
  rules: StationRules;
  crossfadeEnabled?: boolean;
  crossfadeSeconds?: number;
  matchingTrackCount: number;
  matchingDurationMs: number;
}

export interface CurationMetadataOptions {
  libraries: LibraryInfo[];
  artists: string[];
  albums: Array<{ id: string; title: string; artist: string }>;
  genres: string[];
  yearMin: number | null;
  yearMax: number | null;
}

export type AutoBackupUnit = 'minutes' | 'hours' | 'days';

export interface AutoBackupConfig {
  enabled: boolean;
  intervalValue: number;
  intervalUnit: AutoBackupUnit;
  maxBackupsToKeep: number;
  lastBackupAt: number | null;
  lastBackupFilename: string | null;
  nextBackupAt: number | null;
}

export interface StoredBackupItem {
  filename: string;
  sizeBytes: number;
  createdAt: number;
  isAuto: boolean;
  counts?: {
    libraries: number;
    albums: number;
    tracks: number;
    stations: number;
  };
}

export interface PlaybackLogEntry {
  id: string;
  timestamp: number;
  isoTime: string;
  level: 'info' | 'warn' | 'error' | 'success';
  category: 'stream' | 'plex' | 'transcode' | 'client' | 'health';
  trackId?: string;
  title?: string;
  artist?: string;
  album?: string;
  ext?: string;
  source?: 'plex' | 'local';
  method?: 'direct-play' | 'transcode-mp3' | 'fallback-transcode';
  httpStatus?: number;
  message: string;
  details?: string;
  clientDeck?: 'A' | 'B';
  userAgent?: string;
}

export interface PlaybackHealthStatus {
  serverTimeMs: number;
  ffmpegAvailable: boolean;
  ffmpegPath?: string;
  ffmpegVersion?: string;
  transcodeCacheBytes: number;
  transcodeCacheFiles: number;
  plexConfigured: boolean;
  plexServerName?: string;
  plexServerUri?: string;
  plexLatencyMs?: number | null;
  plexReachable?: boolean;
  libraryStats: {
    totalTracks: number;
    tracksByFormat: Record<string, number>;
    plexTracksCount: number;
    localTracksCount: number;
  };
  forceTranscodeFlac: boolean;
  autoSkipUnplayable: boolean;
}

export type UserRole = 'admin' | 'curator' | 'listener';

export interface UserProfile {
  id: string;
  username: string;
  role: UserRole;
  createdAt: number;
  updatedAt: number;
}

export interface AuthStatusResponse {
  authEnabled: boolean;
  hasAdminUser: boolean;
  user: UserProfile | null;
}

declare global {
  interface Window {
    radiarrDesktop?: {
      isDesktop: boolean;
      platform?: string;
      pickFolder: () => Promise<string | null>;
      openExternal?: (url: string) => Promise<void>;
      getInfo?: () => Promise<{
        platform: string;
        version: string;
        isPackaged: boolean;
        serverUrl?: string;
      }>;
    };
  }
}


