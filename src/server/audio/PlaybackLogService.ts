import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TRANSCODE_CACHE_DIR } from '../config.ts';
import { db } from '../db/index.ts';
import { getServerSettings } from '../routes/settings.ts';
import { resolvePlexStreamUrl } from '../sources/PlexService.ts';

const execFileAsync = promisify(execFile);

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

class PlaybackLogService {
  private readonly maxInMemory = 250;
  private readonly logs: PlaybackLogEntry[] = [];
  private logCounter = 0;

  constructor() {
    this.addLog({
      level: 'info',
      category: 'health',
      message: 'Playback diagnostics and event logger initialized.',
    });
  }

  public addLog(entry: {
    level: 'info' | 'warn' | 'error' | 'success';
    category: 'stream' | 'plex' | 'transcode' | 'client' | 'health';
    message: string;
    trackId?: string;
    title?: string;
    artist?: string;
    album?: string;
    ext?: string;
    source?: 'plex' | 'local';
    method?: 'direct-play' | 'transcode-mp3' | 'fallback-transcode';
    httpStatus?: number;
    details?: string;
    clientDeck?: 'A' | 'B';
    userAgent?: string;
  }): PlaybackLogEntry {
    this.logCounter += 1;
    const now = Date.now();
    const sanitizedDetails =
      typeof entry.details === 'object' && entry.details !== null
        ? JSON.stringify(entry.details, null, 2)
        : typeof entry.details === 'string'
          ? entry.details
          : undefined;

    const fullEntry: PlaybackLogEntry = {
      id: `log_${now}_${this.logCounter}`,
      timestamp: now,
      isoTime: new Date(now).toISOString(),
      ...entry,
      details: sanitizedDetails,
    };

    this.logs.unshift(fullEntry);
    if (this.logs.length > this.maxInMemory) {
      this.logs.length = this.maxInMemory;
    }

    // Persist warnings and errors to SQLite playback_logs table for crash analysis
    if (entry.level === 'warn' || entry.level === 'error') {
      try {
        db.prepare(`
          INSERT INTO playback_logs (id, timestamp, level, category, track_id, title, artist, ext, source, method, http_status, message, details)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          fullEntry.id,
          fullEntry.timestamp,
          fullEntry.level,
          fullEntry.category,
          fullEntry.trackId || null,
          fullEntry.title || null,
          fullEntry.artist || null,
          fullEntry.ext || null,
          fullEntry.source || null,
          fullEntry.method || null,
          fullEntry.httpStatus || null,
          fullEntry.message,
          fullEntry.details || null
        );
      } catch {
        // Table might not exist yet if prior to migration, safe to ignore
      }
    }

    return fullEntry;
  }

  public getLogs(options?: {
    level?: string;
    category?: string;
    limit?: number;
  }): PlaybackLogEntry[] {
    let result = this.logs;
    if (options?.level && options.level !== 'all') {
      result = result.filter((l) => l.level === options.level);
    }
    if (options?.category && options.category !== 'all') {
      result = result.filter((l) => l.category === options.category);
    }
    const limit = Math.min(250, options?.limit || 100);
    return result.slice(0, limit);
  }

  public clearLogs(): void {
    this.logs.length = 0;
    try {
      db.prepare(`DELETE FROM playback_logs`).run();
    } catch {
      // ignore
    }
    this.addLog({
      level: 'info',
      category: 'health',
      message: 'Playback diagnostic logs cleared by user.',
    });
  }

  public async getHealthStatus(): Promise<PlaybackHealthStatus> {
    const settings = getServerSettings();

    // 1. Check FFmpeg binary
    let ffmpegAvailable = false;
    let ffmpegPath = '';
    let ffmpegVersion = '';
    try {
      const { stdout } = await execFileAsync('ffmpeg', ['-version']);
      ffmpegAvailable = true;
      ffmpegPath = '/usr/bin/ffmpeg';
      const firstLine = stdout.split('\n')[0] || '';
      ffmpegVersion = firstLine.replace(/^ffmpeg version /, '').split(' ')[0];
    } catch {
      ffmpegAvailable = false;
    }

    // 2. Check Transcode Cache stats
    let transcodeCacheBytes = 0;
    let transcodeCacheFiles = 0;
    try {
      if (fs.existsSync(TRANSCODE_CACHE_DIR)) {
        const files = fs.readdirSync(TRANSCODE_CACHE_DIR);
        transcodeCacheFiles = files.length;
        for (const file of files) {
          try {
            const stat = fs.statSync(path.join(TRANSCODE_CACHE_DIR, file));
            transcodeCacheBytes += stat.size;
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }

    // 3. Check Plex Connectivity & ping latency
    const plex = settings.plexConfig;
    const plexConfigured = Boolean(plex?.serverUri && (plex.serverAccessToken || plex.authToken));
    let plexReachable: boolean | undefined = undefined;
    let plexLatencyMs: number | null = null;

    if (plexConfigured && plex?.serverUri) {
      const token = plex.serverAccessToken || plex.authToken;
      const baseUri = plex.serverUri.replace(/\/+$/, '');
      const testUrl = `${baseUri}/identity?X-Plex-Token=${encodeURIComponent(token || '')}`;
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(testUrl, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        plexLatencyMs = Date.now() - start;
        plexReachable = res.ok;
      } catch {
        plexReachable = false;
        plexLatencyMs = null;
      }
    }

    // 4. Query library format breakdown from SQLite
    const tracksByFormat: Record<string, number> = {};
    let totalTracks = 0;
    let plexTracksCount = 0;
    let localTracksCount = 0;

    try {
      const formatRows = db
        .prepare(`SELECT ext, COUNT(*) as count FROM tracks GROUP BY ext`)
        .all() as Array<{ ext: string; count: number }>;

      for (const row of formatRows) {
        const ext = (row.ext || '').toLowerCase();
        tracksByFormat[ext] = Number(row.count);
        totalTracks += Number(row.count);
      }

      const plexRow = db
        .prepare(`SELECT COUNT(*) as count FROM tracks WHERE file_path LIKE 'plex://%'`)
        .get() as { count: number } | undefined;
      plexTracksCount = Number(plexRow?.count || 0);
      localTracksCount = Math.max(0, totalTracks - plexTracksCount);
    } catch {
      // ignore
    }

    return {
      serverTimeMs: Date.now(),
      ffmpegAvailable,
      ffmpegPath,
      ffmpegVersion,
      transcodeCacheBytes,
      transcodeCacheFiles,
      plexConfigured,
      plexServerName: plex?.serverName,
      plexServerUri: plex?.serverUri,
      plexLatencyMs,
      plexReachable,
      libraryStats: {
        totalTracks,
        tracksByFormat,
        plexTracksCount,
        localTracksCount,
      },
      forceTranscodeFlac: Boolean(settings.forceTranscodeFlac),
      autoSkipUnplayable: settings.autoSkipUnplayable !== false,
    };
  }

  /**
   * Diagnostic probe for a specific track to pinpoint why it will not stream.
   */
  public async probeTrack(trackId: string): Promise<{
    ok: boolean;
    trackId: string;
    title: string;
    artist: string;
    album: string;
    ext: string;
    source: 'plex' | 'local';
    filePath: string;
    directPlayAllowed: boolean;
    resolvedStreamUrl?: string | null;
    httpStatus?: number;
    contentType?: string;
    contentLength?: number;
    errorMessage?: string;
    diagnosticAdvice?: string;
  }> {
    const row = db
      .prepare(`SELECT id, title, artist, album, ext, file_path FROM tracks WHERE id = ?`)
      .get(trackId) as {
        id: string;
        title: string;
        artist: string;
        album: string;
        ext: string;
        file_path: string;
      } | undefined;

    if (!row) {
      return {
        ok: false,
        trackId,
        title: 'Unknown',
        artist: 'Unknown',
        album: 'Unknown',
        ext: '',
        source: 'local',
        filePath: '',
        directPlayAllowed: false,
        errorMessage: `Track with ID "${trackId}" does not exist in the Radiarr database. Re-scan your library.`,
      };
    }

    const isPlex = row.file_path.startsWith('plex://');
    const source: 'plex' | 'local' = isPlex ? 'plex' : 'local';

    if (isPlex) {
      const resolvedUrl = resolvePlexStreamUrl(row.file_path);
      if (!resolvedUrl) {
        return {
          ok: false,
          trackId: row.id,
          title: row.title,
          artist: row.artist,
          album: row.album,
          ext: row.ext,
          source,
          filePath: row.file_path,
          directPlayAllowed: true,
          resolvedStreamUrl: null,
          errorMessage: 'Plex credentials or server address missing in settings.',
          diagnosticAdvice: 'Go to Settings > Sources > Plex and re-authenticate or re-select your server connection.',
        };
      }

      try {
        const start = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const headRes = await fetch(resolvedUrl, {
          method: 'GET',
          headers: { Range: 'bytes=0-1024' },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const latency = Date.now() - start;
        const status = headRes.status;
        const contentType = headRes.headers.get('content-type') || 'unknown';
        const contentLength = Number(headRes.headers.get('content-length') || 0);

        if (status === 200 || status === 206) {
          let advice = `Plex stream is healthy and responding with HTTP ${status} (${latency}ms latency).`;
          if (row.ext.toLowerCase() === '.flac') {
            advice += ' Note: This track is in FLAC format. If playing on iOS Safari or certain mobile browsers, enable "Force Transcode FLAC to MP3" in Settings > Diagnostics.';
          }
          return {
            ok: true,
            trackId: row.id,
            title: row.title,
            artist: row.artist,
            album: row.album,
            ext: row.ext,
            source,
            filePath: row.file_path,
            directPlayAllowed: true,
            resolvedStreamUrl: resolvedUrl.replace(/X-Plex-Token=[^&]+/g, 'X-Plex-Token=REDACTED'),
            httpStatus: status,
            contentType,
            contentLength,
            diagnosticAdvice: advice,
          };
        } else {
          let advice = `Plex returned HTTP error ${status}.`;
          if (status === 404) {
            advice += ' The file may have been moved, renamed, or deleted inside your Plex music folder. Trigger a Plex library scan, then re-sync in Radiarr.';
          } else if (status === 401 || status === 403) {
            advice += ' Plex authentication failed. Your Plex token may have expired. Re-authenticate with Plex in Settings > Sources.';
          }
          return {
            ok: false,
            trackId: row.id,
            title: row.title,
            artist: row.artist,
            album: row.album,
            ext: row.ext,
            source,
            filePath: row.file_path,
            directPlayAllowed: true,
            resolvedStreamUrl: resolvedUrl.replace(/X-Plex-Token=[^&]+/g, 'X-Plex-Token=REDACTED'),
            httpStatus: status,
            contentType,
            errorMessage: `Plex upstream error: HTTP ${status}`,
            diagnosticAdvice: advice,
          };
        }
      } catch (err) {
        return {
          ok: false,
          trackId: row.id,
          title: row.title,
          artist: row.artist,
          album: row.album,
          ext: row.ext,
          source,
          filePath: row.file_path,
          directPlayAllowed: true,
          errorMessage: `Network error connecting to Plex: ${err instanceof Error ? err.message : String(err)}`,
          diagnosticAdvice: 'Check that your Plex Media Server is awake, running, and accessible from the Radiarr host.',
        };
      }
    } else {
      // Local file check
      const exists = fs.existsSync(row.file_path);
      if (!exists) {
        return {
          ok: false,
          trackId: row.id,
          title: row.title,
          artist: row.artist,
          album: row.album,
          ext: row.ext,
          source,
          filePath: row.file_path,
          directPlayAllowed: true,
          errorMessage: `Local file not found on disk: "${row.file_path}".`,
          diagnosticAdvice: 'Verify your /music directory mount and run a library rescan in Settings > Sources.',
        };
      }

      const stat = fs.statSync(row.file_path);
      return {
        ok: true,
        trackId: row.id,
        title: row.title,
        artist: row.artist,
        album: row.album,
        ext: row.ext,
        source,
        filePath: row.file_path,
        directPlayAllowed: true,
        contentLength: stat.size,
        diagnosticAdvice: 'Local audio file exists and is accessible by the server.',
      };
    }
  }
}

export const playbackLogService = new PlaybackLogService();
