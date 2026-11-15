import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Database,
  HardDrive,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Terminal,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  PlaybackHealthStatus,
  PlaybackLogEntry,
  ServerSettings,
  StationWithStats,
} from '../../shared/types.ts';
import { apiFetch } from '../utils/apiInterceptor.ts';

interface DiagnosticsTabProps {
  settings: ServerSettings | null;
  onUpdateSettings: (patch: Partial<ServerSettings>) => Promise<void>;
  stations?: StationWithStats[];
  activeStationId?: string | null;
}

export function DiagnosticsTab({
  settings,
  onUpdateSettings,
}: DiagnosticsTabProps) {
  const [logs, setLogs] = useState<PlaybackLogEntry[]>([]);
  const [health, setHealth] = useState<PlaybackHealthStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [filterLevel, setFilterLevel] = useState<'all' | 'errors' | 'transcode' | 'plex' | 'client'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedReport, setCopiedReport] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);

  // Track probe state
  const [probeTrackId, setProbeTrackId] = useState<string>('');
  const [isProbing, setIsProbing] = useState<boolean>(false);
  const [probeResult, setProbeResult] = useState<{
    trackId: string;
    success: boolean;
    dbFound: boolean;
    track?: {
      title: string;
      artist: string;
      album: string;
      container: string;
      codec: string;
      streamUrl: string;
      isPlex: boolean;
    };
    sourceProbe: {
      type: string;
      accessible: boolean;
      httpStatus?: number;
      contentType?: string;
      contentLength?: number;
      error?: string;
    };
    advice: string;
  } | null>(null);

  const fetchLogsAndHealth = useCallback(async (showLoading = false) => {
    if (showLoading) setIsLoading(true);
    try {
      const res = await apiFetch('/api/diagnostics/playback-logs?limit=250');
      if (!res.ok) return;
      const data = await res.json();
      setLogs(data.logs || []);
      setHealth(data.health || null);
    } catch {
      // transient network error
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLogsAndHealth(true);
  }, [fetchLogsAndHealth]);

  // Periodic auto-refresh every 3.5 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      void fetchLogsAndHealth(false);
    }, 3500);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogsAndHealth]);

  const handleClearLogs = async () => {
    setIsClearing(true);
    try {
      await apiFetch('/api/diagnostics/clear-logs', { method: 'POST' });
      setLogs([]);
    } catch {
      // ignore
    } finally {
      setIsClearing(false);
    }
  };

  const handleToggleForceTranscode = async () => {
    const nextVal = !(settings?.forceTranscodeFlac ?? false);
    await onUpdateSettings({ forceTranscodeFlac: nextVal });
    void fetchLogsAndHealth(false);
  };

  const handleToggleAutoSkip = async () => {
    const nextVal = !(settings?.autoSkipUnplayable ?? true);
    await onUpdateSettings({ autoSkipUnplayable: nextVal });
    void fetchLogsAndHealth(false);
  };

  const handleRunProbe = async (idToProbe?: string) => {
    const targetId = idToProbe || probeTrackId.trim();
    if (!targetId) return;
    setIsProbing(true);
    setProbeResult(null);
    try {
      const res = await apiFetch(`/api/diagnostics/test-stream/${encodeURIComponent(targetId)}`, {
        method: 'POST',
      });
      const data = await res.json();
      setProbeResult(data);
    } catch (err) {
      setProbeResult({
        trackId: targetId,
        success: false,
        dbFound: false,
        sourceProbe: {
          type: 'error',
          accessible: false,
          error: err instanceof Error ? err.message : 'Probe request failed',
        },
        advice: 'Network request to server failed. Verify Radiarr server is running.',
      });
    } finally {
      setIsProbing(false);
    }
  };

  const transcodeCacheMb = health?.transcodeCacheBytes
    ? (health.transcodeCacheBytes / (1024 * 1024)).toFixed(1)
    : '0';

  const handleCopyReport = async () => {
    const lines: string[] = [
      `=== RADIARR PLAYBACK & STREAM DIAGNOSTICS REPORT ===`,
      `Generated: ${new Date().toISOString()}`,
      `FFmpeg Available: ${health?.ffmpegAvailable ? 'YES' : 'NO'}`,
      `Transcode Cache Size: ${transcodeCacheMb} MB (${health?.transcodeCacheFiles ?? 0} files)`,
      `Plex Configured: ${health?.plexConfigured ? 'YES' : 'NO'}`,
      `Plex Reachable: ${health?.plexReachable ? 'YES' : 'NO'} (${health?.plexLatencyMs ?? 0}ms)`,
      `Plex Host: ${health?.plexServerUri || 'N/A'}`,
      `Catalog Formats: ${JSON.stringify(health?.libraryStats?.tracksByFormat || {})}`,
      `Force Transcode FLAC: ${settings?.forceTranscodeFlac ? 'ENABLED' : 'DISABLED'}`,
      `Auto-Skip Unplayable: ${settings?.autoSkipUnplayable !== false ? 'ENABLED' : 'DISABLED'}`,
      ``,
      `=== RECENT LOG ENTRIES (${logs.length}) ===`,
    ];

    for (const log of logs.slice(0, 50)) {
      const timeStr = log.isoTime || (log.timestamp ? new Date(log.timestamp).toISOString() : new Date().toISOString());
      const levelStr = (log.level || 'info').toUpperCase();
      const catStr = log.category || 'general';
      const msgStr = typeof log.message === 'string' ? log.message : JSON.stringify(log.message);
      lines.push(`[${timeStr}] [${levelStr}] [${catStr}] ${msgStr}`);
      if (log.details !== undefined && log.details !== null) {
        const detailStr = typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2);
        lines.push(`   details: ${detailStr}`);
      }
    }

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2500);
    } catch {
      // ignore
    }
  };

  // Filter logs based on selection and search
  const filteredLogs = useMemo(() => {
    return logs.filter((item) => {
      if (filterLevel === 'errors' && item.level !== 'error' && item.level !== 'warn') {
        return false;
      }
      if (filterLevel === 'transcode' && item.category !== 'transcode') {
        return false;
      }
      if (filterLevel === 'plex' && item.category !== 'plex') {
        return false;
      }
      if (filterLevel === 'client' && item.category !== 'client') {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const msgMatch = item.message && typeof item.message === 'string' ? item.message.toLowerCase().includes(q) : false;
        const titleMatch = item.title && typeof item.title === 'string' ? item.title.toLowerCase().includes(q) : false;
        const catMatch = item.category && typeof item.category === 'string' ? item.category.toLowerCase().includes(q) : false;
        return Boolean(msgMatch || titleMatch || catMatch);
      }

      return true;
    });
  }, [logs, filterLevel, searchQuery]);

  const errorCount = logs.filter((l) => l.level === 'error').length;
  const warnCount = logs.filter((l) => l.level === 'warn').length;

  const tracksByFormat = health?.libraryStats?.tracksByFormat || {};
  const flacCount = tracksByFormat['flac'] || tracksByFormat['alac'] || 0;

  return (
    <div className="space-y-6">
      {/* SECTION 1: Health Status Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Plex Server Health */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              Plex Connection
            </span>
            {health?.plexConfigured ? (
              health.plexReachable ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full">
                  <Wifi className="w-3 h-3" />
                  {health.plexLatencyMs ?? 0}ms
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 px-2 py-0.5 rounded-full">
                  <WifiOff className="w-3 h-3" />
                  Offline
                </span>
              )
            ) : (
              <span className="text-[11px] text-zinc-400">Not Configured</span>
            )}
          </div>
          <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
            {health?.plexConfigured
              ? health.plexReachable
                ? 'Plex Server Online'
                : 'Plex Unreachable'
              : 'Local Media Only'}
          </div>
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate font-mono">
            {health?.plexServerUri || 'No remote Plex host'}
          </div>
        </div>

        {/* Card 2: FFmpeg Transcoder Engine */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              FFmpeg Engine
            </span>
            {health?.ffmpegAvailable ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="w-3 h-3" /> Ready
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-full">
                <AlertTriangle className="w-3 h-3" /> Passthrough
              </span>
            )}
          </div>
          <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            {health?.ffmpegAvailable ? 'Transcoder Active' : 'Passthrough Only'}
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {health?.ffmpegAvailable
              ? 'Real-time 320k MP3 audio conversion'
              : 'Direct-play only (no live transcoding)'}
          </p>
        </div>

        {/* Card 3: Transcode Cache */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              Transcode Cache
            </span>
            <HardDrive className="w-3.5 h-3.5 text-zinc-400" />
          </div>
          <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            {transcodeCacheMb} MB
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {health?.transcodeCacheFiles ?? 0} cached audio segments on disk
          </p>
        </div>

        {/* Card 4: Catalog Formats */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              Audio Codecs
            </span>
            <Database className="w-3.5 h-3.5 text-zinc-400" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {Object.keys(tracksByFormat).length > 0 ? (
              Object.entries(tracksByFormat).map(([fmt, cnt]) => (
                <span
                  key={fmt}
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-medium ${
                    fmt.toLowerCase() === 'flac' || fmt.toLowerCase() === 'alac'
                      ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  {fmt.toUpperCase()}: {String(cnt)}
                </span>
              ))
            ) : (
              <span className="text-[11px] text-zinc-400">No tracks scanned</span>
            )}
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {flacCount > 0
              ? `${flacCount} FLAC tracks (FLAC transcoding recommended for Safari/iOS)`
              : 'Standard browser-supported formats'}
          </p>
        </div>
      </section>

      {/* SECTION 2: Playback Resilience Controls */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-indigo-500" />
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Playback Resilience &amp; Format Fallbacks
          </h2>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Tune how Radiarr handles incompatible audio formats, browser limitations, and unplayable tracks.
        </p>

        <div className="space-y-4 pt-2">
          {/* Toggle 1: Force Transcode FLAC */}
          <div className="flex items-start justify-between gap-4 p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Transcode Lossless (FLAC/ALAC) to MP3
                </span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                  Recommended for iOS &amp; Safari
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Safari on iPhone, iPad, and macOS cannot natively stream raw FLAC audio inside HTML5 audio tags.
                Enabling this converts FLAC/ALAC tracks on-the-fly to 320kbps MP3 before streaming to the browser,
                guaranteeing instant playback on all devices.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings?.forceTranscodeFlac ?? false}
              onClick={() => void handleToggleForceTranscode()}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                settings?.forceTranscodeFlac
                  ? 'bg-indigo-600'
                  : 'bg-zinc-200 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  settings?.forceTranscodeFlac ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Toggle 2: Auto-Skip Unplayable Songs */}
          <div className="flex items-start justify-between gap-4 p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Auto-Skip Unplayable Tracks
                </span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                  Active
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                If a track fails to decode or cannot be reached from Plex/disk, Radiarr logs the error to this window
                and automatically advances to the next scheduled song so the station never freezes or falls silent.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings?.autoSkipUnplayable !== false}
              onClick={() => void handleToggleAutoSkip()}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                settings?.autoSkipUnplayable !== false
                  ? 'bg-indigo-600'
                  : 'bg-zinc-200 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  settings?.autoSkipUnplayable !== false ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </section>

      {/* SECTION 3: Deep Stream Probe / Track Tester */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Track Stream Probe
            </h2>
          </div>
          <span className="text-[11px] text-zinc-400">
            Deep source &amp; HTTP header diagnostic
          </span>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Test any track ID to verify database presence, local disk accessibility, Plex server streaming headers, and content-type.
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="Enter Track ID (e.g. plex:12345 or track UUID)..."
              value={probeTrackId}
              onChange={(e) => setProbeTrackId(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={!probeTrackId.trim() || isProbing}
              onClick={() => void handleRunProbe()}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition cursor-pointer flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isProbing ? 'animate-spin' : ''}`} />
              <span>{isProbing ? 'Probing...' : 'Probe Track'}</span>
            </button>

            {/* Quick probe for most recent error track if available */}
            {logs.find((l) => l.trackId)?.trackId && (
              <button
                type="button"
                onClick={() => {
                  const lastErrTrack = logs.find((l) => l.trackId)?.trackId;
                  if (lastErrTrack) {
                    setProbeTrackId(lastErrTrack);
                    void handleRunProbe(lastErrTrack);
                  }
                }}
                className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition cursor-pointer"
              >
                Probe Last Error Track
              </button>
            )}
          </div>
        </div>

        {/* Probe Output Result Card */}
        {probeResult && (
          <div
            className={`p-4 rounded-xl border text-xs space-y-3 ${
              probeResult.success
                ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-950 dark:text-emerald-200'
                : 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900 text-rose-950 dark:text-rose-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {probeResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                )}
                <span className="font-semibold text-sm">
                  {probeResult.success ? 'Track Stream Reachable & Playable' : 'Stream Failed Diagnostic'}
                </span>
              </div>
              <span className="font-mono text-[11px] opacity-80">{probeResult.trackId}</span>
            </div>

            {probeResult.track && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] p-2.5 rounded-lg bg-black/5 dark:bg-black/30 font-mono">
                <div>
                  <span className="opacity-60 block">Title</span>
                  <span className="font-semibold truncate block">{probeResult.track.title}</span>
                </div>
                <div>
                  <span className="opacity-60 block">Artist</span>
                  <span className="truncate block">{probeResult.track.artist}</span>
                </div>
                <div>
                  <span className="opacity-60 block">Codec / Container</span>
                  <span>{probeResult.track.codec} ({probeResult.track.container})</span>
                </div>
                <div>
                  <span className="opacity-60 block">Source</span>
                  <span>{probeResult.track.isPlex ? 'Plex Remote' : 'Local Drive'}</span>
                </div>
              </div>
            )}

            <div className="space-y-1 text-[11px]">
              <div className="font-semibold">Source Probe Details:</div>
              <div className="font-mono bg-black/5 dark:bg-black/30 p-2 rounded">
                <div>Type: {probeResult.sourceProbe.type}</div>
                <div>Accessible: {probeResult.sourceProbe.accessible ? 'YES' : 'NO'}</div>
                {probeResult.sourceProbe.httpStatus && (
                  <div>HTTP Status: {probeResult.sourceProbe.httpStatus}</div>
                )}
                {probeResult.sourceProbe.contentType && (
                  <div>Content-Type: {probeResult.sourceProbe.contentType}</div>
                )}
                {probeResult.sourceProbe.contentLength && (
                  <div>Size: {(probeResult.sourceProbe.contentLength / (1024 * 1024)).toFixed(2)} MB</div>
                )}
                {probeResult.sourceProbe.error && (
                  <div className="text-rose-600 dark:text-rose-400 font-bold">
                    Error: {probeResult.sourceProbe.error}
                  </div>
                )}
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-white/70 dark:bg-zinc-900/70 border border-current/20 text-xs">
              <span className="font-semibold">Diagnostic Advice: </span>
              <span>{probeResult.advice}</span>
            </div>
          </div>
        )}
      </section>

      {/* SECTION 4: Interactive Playback Log Viewer */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-500" />
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Live Playback &amp; Stream Log
              </h2>
              {errorCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500 text-white">
                  {errorCount} {errorCount === 1 ? 'Error' : 'Errors'}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Real-time audit log of audio requests, client decoder errors, Plex pings, and transcode events.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer flex items-center gap-1.5 border ${
                autoRefresh
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  autoRefresh ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'
                }`}
              />
              <span>{autoRefresh ? 'Live (Auto-refresh)' : 'Paused'}</span>
            </button>

            <button
              type="button"
              onClick={() => void fetchLogsAndHealth(true)}
              disabled={isLoading}
              className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition cursor-pointer"
              title="Refresh logs now"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => void handleCopyReport()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition cursor-pointer"
            >
              {copiedReport ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Report</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => void handleClearLogs()}
              disabled={isClearing || logs.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 text-xs font-medium text-zinc-500 dark:text-zinc-400 transition cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          </div>
        </div>

        {/* Filter Pills and Search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilterLevel('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                filterLevel === 'all'
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              All ({logs.length})
            </button>

            <button
              type="button"
              onClick={() => setFilterLevel('errors')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-1 ${
                filterLevel === 'errors'
                  ? 'bg-rose-600 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-rose-600'
              }`}
            >
              <span>Errors &amp; Warnings</span>
              {errorCount + warnCount > 0 && (
                <span className="font-mono text-[10px] px-1 rounded bg-black/20">
                  {errorCount + warnCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setFilterLevel('transcode')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                filterLevel === 'transcode'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-indigo-600'
              }`}
            >
              Transcodes
            </button>

            <button
              type="button"
              onClick={() => setFilterLevel('plex')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                filterLevel === 'plex'
                  ? 'bg-amber-600 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-amber-600'
              }`}
            >
              Plex
            </button>

            <button
              type="button"
              onClick={() => setFilterLevel('client')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                filterLevel === 'client'
                  ? 'bg-purple-600 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-purple-600'
              }`}
            >
              Client / Audio Deck
            </button>
          </div>

          <div className="relative min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-400" />
            <input
              type="text"
              placeholder="Search log messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Terminal Log Console */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 sm:p-4 font-mono text-[11px] leading-relaxed text-zinc-300 shadow-inner max-h-[460px] overflow-y-auto space-y-2">
          {filteredLogs.length === 0 ? (
            <div className="py-12 text-center text-zinc-500">
              {searchQuery || filterLevel !== 'all'
                ? 'No log entries match your filter criteria.'
                : 'No playback events recorded yet. Play a station to stream audio and populate logs.'}
            </div>
          ) : (
            filteredLogs.map((entry) => {
              const dateStr = entry.isoTime
                ? new Date(entry.isoTime).toLocaleTimeString()
                : new Date(entry.timestamp).toLocaleTimeString();
              const isErr = entry.level === 'error';
              const isWarn = entry.level === 'warn';

              return (
                <div
                  key={entry.id}
                  className={`p-2 rounded-lg transition-colors border ${
                    isErr
                      ? 'bg-rose-950/40 border-rose-900/60 text-rose-200'
                      : isWarn
                      ? 'bg-amber-950/30 border-amber-900/50 text-amber-200'
                      : 'bg-zinc-900/60 border-zinc-800/60 text-zinc-300 hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-zinc-500 select-none text-[10px]">{dateStr}</span>
                    <span
                      className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                        isErr
                          ? 'bg-rose-600 text-white'
                          : isWarn
                          ? 'bg-amber-600 text-white'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {entry.level}
                    </span>
                    <span className="text-[10px] text-indigo-400 font-semibold uppercase">
                      [{entry.category}]
                    </span>
                    {entry.title ? (
                      <span className="text-[10px] text-zinc-400 truncate max-w-[200px] sm:max-w-xs font-sans">
                        &quot;{typeof entry.title === 'string' ? entry.title : JSON.stringify(entry.title)}&quot;
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-1 text-zinc-200 break-words font-mono text-[11px]">
                    {typeof entry.message === 'string' ? entry.message : JSON.stringify(entry.message)}
                  </div>

                  {entry.details !== undefined && entry.details !== null && (
                    <pre className="mt-1 p-1.5 rounded bg-black/40 text-[10px] text-zinc-400 overflow-x-auto whitespace-pre-wrap">
                      {typeof entry.details === 'string'
                        ? entry.details
                        : JSON.stringify(entry.details, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
