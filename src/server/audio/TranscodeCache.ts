import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  DIRECT_PLAY_EXTENSIONS,
  TrackRecord,
} from '../../shared/types.ts';
import {
  TRANSCODE_BITRATE_KBPS,
  TRANSCODE_CACHE_DIR,
  TRANSCODE_CACHE_MAX_MB,
} from '../config.ts';
import { db } from '../db/index.ts';
import { resolvePlexStreamUrl } from '../sources/PlexService.ts';

const execFileAsync = promisify(execFile);
const DIRECT_PLAY_SET = new Set<string>(DIRECT_PLAY_EXTENSIONS);

export function isDirectPlayExtension(ext: string): boolean {
  return DIRECT_PLAY_SET.has(ext.toLowerCase());
}

class TranscodeCache {
  private readonly inFlight = new Map<string, Promise<string>>();
  private readonly queue: TrackRecord[] = [];
  private activeWorkers = 0;
  private readonly maxConcurrency = 2;

  private getTargetFilePath(trackId: string): string {
    return path.join(TRANSCODE_CACHE_DIR, `${trackId}_${TRANSCODE_BITRATE_KBPS}k.mp3`);
  }

  /**
   * Checks if a transcoded MP3 is already on disk and updates its LRU timestamp if so.
   */
  public getCachedPathIfReady(trackId: string): string | null {
    const row = db
      .prepare(
        `SELECT cache_path FROM transcode_cache WHERE track_id = ? AND bitrate_kbps = ?`
      )
      .get(trackId, TRANSCODE_BITRATE_KBPS) as { cache_path: string } | undefined;

    const expectedPath = row?.cache_path || this.getTargetFilePath(trackId);
    if (fs.existsSync(expectedPath)) {
      const stat = fs.statSync(expectedPath);
      if (stat.size > 0) {
        const now = Date.now();
        db.prepare(`
          INSERT INTO transcode_cache (track_id, cache_path, size_bytes, bitrate_kbps, last_accessed_ms)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(track_id) DO UPDATE SET
            last_accessed_ms = excluded.last_accessed_ms,
            size_bytes = excluded.size_bytes
        `).run(trackId, expectedPath, stat.size, TRANSCODE_BITRATE_KBPS, now);
        return expectedPath;
      }
    }
    return null;
  }

  /**
   * Ensures a non-direct-play track is transcoded to MP3 in /config/transcode-cache
   * and returns the cached MP3 file path. Deduplicates concurrent requests for the same track.
   */
  public async ensureTranscoded(track: TrackRecord): Promise<string> {
    const existing = this.getCachedPathIfReady(track.id);
    if (existing) {
      return existing;
    }

    const existingPromise = this.inFlight.get(track.id);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = this.runFfmpegTranscode(track).finally(() => {
      this.inFlight.delete(track.id);
    });

    this.inFlight.set(track.id, promise);
    return promise;
  }

  /**
   * Enqueues tracks for background pre-transcoding so tuning and channel hopping stay fast (~1s).
   */
  public enqueueLookahead(tracks: readonly TrackRecord[]): void {
    for (const track of tracks) {
      if (isDirectPlayExtension(track.ext)) continue;
      if (this.getCachedPathIfReady(track.id)) continue;
      if (this.inFlight.has(track.id)) continue;
      if (this.queue.some((q) => q.id === track.id)) continue;

      this.queue.push(track);
    }
    this.drainQueue();
  }

  private drainQueue(): void {
    while (this.activeWorkers < this.maxConcurrency && this.queue.length > 0) {
      const nextTrack = this.queue.shift()!;
      if (this.getCachedPathIfReady(nextTrack.id) || this.inFlight.has(nextTrack.id)) {
        continue;
      }

      this.activeWorkers += 1;
      void this.ensureTranscoded(nextTrack)
        .catch((err) => {
          console.error(`Background transcode failed for ${nextTrack.filePath}:`, err);
        })
        .finally(() => {
          this.activeWorkers -= 1;
          this.drainQueue();
        });
    }
  }

  private async runFfmpegTranscode(track: TrackRecord): Promise<string> {
    const finalPath = this.getTargetFilePath(track.id);
    const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.tmp.mp3`;

    const inputSource = track.filePath.startsWith('plex://')
      ? resolvePlexStreamUrl(track.filePath)
      : track.filePath;

    if (!inputSource) {
      throw new Error('Plex server stream URL is not available.');
    }

    try {
      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-v',
          'error',
          '-i',
          inputSource,
          '-vn',
          '-c:a',
          'libmp3lame',
          '-b:a',
          `${TRANSCODE_BITRATE_KBPS}k`,
          '-f',
          'mp3',
          tmpPath,
        ],
        { timeout: 120000 }
      );

      await fsp.rename(tmpPath, finalPath);
      const stat = await fsp.stat(finalPath);
      const now = Date.now();

      db.prepare(`
        INSERT INTO transcode_cache (track_id, cache_path, size_bytes, bitrate_kbps, last_accessed_ms)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(track_id) DO UPDATE SET
          cache_path = excluded.cache_path,
          size_bytes = excluded.size_bytes,
          bitrate_kbps = excluded.bitrate_kbps,
          last_accessed_ms = excluded.last_accessed_ms
      `).run(track.id, finalPath, stat.size, TRANSCODE_BITRATE_KBPS, now);

      await this.enforceSizeCap();
      return finalPath;
    } catch (err) {
      try {
        await fsp.unlink(tmpPath);
      } catch {
        // ignore cleanup error
      }
      throw err;
    }
  }

  /**
   * Least-recently-used (LRU) eviction when /config/transcode-cache exceeds TRANSCODE_CACHE_MAX_MB.
   */
  private async enforceSizeCap(): Promise<void> {
    const maxBytes = TRANSCODE_CACHE_MAX_MB * 1024 * 1024;
    const sumRow = db
      .prepare(`SELECT COALESCE(SUM(size_bytes), 0) AS total_bytes FROM transcode_cache`)
      .get() as { total_bytes: number };

    let currentBytes = Number(sumRow?.total_bytes || 0);
    if (currentBytes <= maxBytes) {
      return;
    }

    const oldestRows = db
      .prepare(
        `SELECT track_id, cache_path, size_bytes FROM transcode_cache ORDER BY last_accessed_ms ASC`
      )
      .all() as Array<{ track_id: string; cache_path: string; size_bytes: number }>;

    const deleteStmt = db.prepare(`DELETE FROM transcode_cache WHERE track_id = ?`);

    for (const row of oldestRows) {
      if (currentBytes <= maxBytes) break;
      try {
        await fsp.unlink(row.cache_path);
      } catch {
        // ignore if already removed
      }
      deleteStmt.run(row.track_id);
      currentBytes -= Number(row.size_bytes);
    }
  }
}

export const transcodeCache = new TranscodeCache();
