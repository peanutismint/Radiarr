import type { Request, Response } from 'express';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { TrackRecord } from '../../shared/types.ts';
import { db } from '../db/index.ts';
import { resolvePlexStreamUrl } from '../sources/PlexService.ts';
import { isDirectPlayExtension, transcodeCache } from './TranscodeCache.ts';

import { getServerSettings } from '../routes/settings.ts';
import { playbackLogService } from './PlaybackLogService.ts';

function getMimeType(ext: string, isTranscodedMp3: boolean): string {
  if (isTranscodedMp3) return 'audio/mpeg';
  switch (ext.toLowerCase()) {
    case '.mp3':
      return 'audio/mpeg';
    case '.m4a':
      return 'audio/mp4';
    case '.aac':
      return 'audio/aac';
    case '.flac':
      return 'audio/flac';
    case '.wav':
      return 'audio/wav';
    default:
      return 'audio/mpeg';
  }
}

export function getTrackByIdFromDb(trackId: string): TrackRecord | null {
  const row = db
    .prepare(`
      SELECT
        t.id,
        t.library_id,
        t.album_id,
        t.file_path,
        t.ext,
        t.file_size,
        t.mtime_ms,
        t.title,
        t.artist,
        t.album_artist,
        t.album,
        a.year AS album_year,
        a.art_path,
        t.track_number,
        t.disc_number,
        t.year,
        t.genre,
        t.duration_ms,
        (SELECT COUNT(*) FROM tracks t2 WHERE t2.album_id = t.album_id) AS album_track_count
      FROM tracks t
      JOIN albums a ON a.id = t.album_id
      WHERE t.id = ?
    `)
    .get(trackId) as
    | {
        id: string;
        library_id: string;
        album_id: string;
        file_path: string;
        ext: string;
        file_size: number;
        mtime_ms: number;
        title: string;
        artist: string;
        album_artist: string | null;
        album: string;
        album_year: number | null;
        art_path: string | null;
        track_number: number;
        disc_number: number;
        year: number | null;
        genre: string | null;
        duration_ms: number;
        album_track_count: number;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    libraryId: row.library_id,
    albumId: row.album_id,
    filePath: row.file_path,
    ext: row.ext,
    fileSize: Number(row.file_size),
    mtimeMs: Number(row.mtime_ms),
    title: row.title,
    artist: row.artist,
    albumArtist: row.album_artist,
    album: row.album,
    albumYear: row.album_year !== null ? Number(row.album_year) : null,
    albumTrackCount: Math.max(1, Number(row.album_track_count || 1)),
    hasArt: Boolean(row.art_path),
    trackNumber: Number(row.track_number),
    discNumber: Number(row.disc_number),
    year: row.year !== null ? Number(row.year) : null,
    genre: row.genre,
    durationMs: Number(row.duration_ms),
  };
}

/**
 * Serves an audio file (either original direct-play file or cached/on-demand MP3 transcode)
 * with full HTTP 206 Partial Content Range support required by iOS Safari.
 */
export async function streamTrackAudio(req: Request, res: Response): Promise<void> {
  const { trackId } = req.params;
  const track = getTrackByIdFromDb(trackId);

  if (!track) {
    playbackLogService.addLog({
      level: 'error',
      category: 'stream',
      message: `Track ID "${trackId}" not found in database.`,
      trackId,
      httpStatus: 404,
    });
    res.status(404).json({ error: `Track "${trackId}" not found.` });
    return;
  }

  const settings = getServerSettings();
  const isPlex = track.filePath.startsWith('plex://');
  const source: 'plex' | 'local' = isPlex ? 'plex' : 'local';
  const forceTranscode =
    req.query.transcode === '1' ||
    req.query.force === '1' ||
    (Boolean(settings.forceTranscodeFlac) && (track.ext.toLowerCase() === '.flac' || track.ext.toLowerCase() === '.alac'));

  const directPlay = !forceTranscode && isDirectPlayExtension(track.ext);
  let targetFilePath = track.filePath;
  let isTranscodedMp3 = false;
  let playMethod: 'direct-play' | 'transcode-mp3' | 'fallback-transcode' = directPlay ? 'direct-play' : 'transcode-mp3';

  if (!directPlay) {
    try {
      targetFilePath = await transcodeCache.ensureTranscoded(track);
      isTranscodedMp3 = true;
      playMethod = 'transcode-mp3';
      if (!req.headers.range || req.headers.range.startsWith('bytes=0-')) {
        playbackLogService.addLog({
          level: 'info',
          category: 'transcode',
          message: `Transcoding track to MP3: "${track.title}" by ${track.artist} (${track.ext})`,
          trackId: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album,
          ext: track.ext,
          source,
          method: 'transcode-mp3',
          httpStatus: 200,
        });
      }
    } catch (err) {
      playbackLogService.addLog({
        level: 'error',
        category: 'transcode',
        message: `FFmpeg transcode failed for "${track.title}": ${err instanceof Error ? err.message : String(err)}`,
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        ext: track.ext,
        source,
        details: err instanceof Error ? err.stack : undefined,
        httpStatus: 500,
      });
      res.status(500).json({
        error:
          err instanceof Error
            ? `Transcode failed: ${err.message}`
            : 'Failed to transcode audio file',
      });
      return;
    }
  } else if (isPlex) {
    const plexStreamUrl = resolvePlexStreamUrl(track.filePath);
    if (!plexStreamUrl) {
      playbackLogService.addLog({
        level: 'error',
        category: 'plex',
        message: `Plex server stream URL is not configured or token is missing for "${track.title}".`,
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        source: 'plex',
        httpStatus: 503,
      });
      res.status(503).json({ error: 'Plex server stream URL is not configured.' });
      return;
    }

    try {
      const forwardHeaders: Record<string, string> = {};
      if (req.headers.range) {
        forwardHeaders.Range = req.headers.range;
      }

      const upstream = await fetch(plexStreamUrl, {
        headers: forwardHeaders,
      });

      if (!upstream.ok && upstream.status !== 206) {
        playbackLogService.addLog({
          level: 'warn',
          category: 'plex',
          message: `Plex direct stream returned HTTP ${upstream.status} for "${track.title}". Attempting automatic MP3 transcode fallback...`,
          trackId: track.id,
          title: track.title,
          artist: track.artist,
          ext: track.ext,
          source: 'plex',
          httpStatus: upstream.status,
        });

        // Automatic fallback: Try transcoding the track via FFmpeg
        try {
          targetFilePath = await transcodeCache.ensureTranscoded(track);
          isTranscodedMp3 = true;
          playMethod = 'fallback-transcode';
          playbackLogService.addLog({
            level: 'success',
            category: 'transcode',
            message: `Recovered "${track.title}" using automatic MP3 transcode fallback.`,
            trackId: track.id,
            title: track.title,
            artist: track.artist,
            source: 'plex',
            method: 'fallback-transcode',
          });
          // Continue to disk streaming below
        } catch (transcodeErr) {
          playbackLogService.addLog({
            level: 'error',
            category: 'plex',
            message: `Plex stream HTTP ${upstream.status} and fallback transcode both failed for "${track.title}".`,
            trackId: track.id,
            title: track.title,
            artist: track.artist,
            source: 'plex',
            details: transcodeErr instanceof Error ? transcodeErr.message : undefined,
            httpStatus: upstream.status,
          });
          res.status(upstream.status).json({
            error: `Plex audio stream returned HTTP ${upstream.status}`,
          });
          return;
        }
      } else {
        if (!req.headers.range || req.headers.range.startsWith('bytes=0-')) {
          playbackLogService.addLog({
            level: 'info',
            category: 'stream',
            message: `Direct-playing Plex stream: "${track.title}" by ${track.artist} (${track.ext})`,
            trackId: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            ext: track.ext,
            source: 'plex',
            method: 'direct-play',
            httpStatus: upstream.status,
          });
        }

        const contentType =
          upstream.headers.get('content-type') || getMimeType(track.ext, false);
        res.status(upstream.status);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', contentType);
        res.setHeader('X-Radiarr-Play-Method', 'plex-direct-play');

        const contentLength = upstream.headers.get('content-length');
        if (contentLength) {
          res.setHeader('Content-Length', contentLength);
        }
        const contentRange = upstream.headers.get('content-range');
        if (contentRange) {
          res.setHeader('Content-Range', contentRange);
        }

        if (upstream.body) {
          Readable.fromWeb(upstream.body as unknown as WebReadableStream).pipe(res);
        } else {
          res.end();
        }
        return;
      }
    } catch (err) {
      playbackLogService.addLog({
        level: 'error',
        category: 'plex',
        message: `Failed to connect to Plex stream for "${track.title}": ${err instanceof Error ? err.message : String(err)}`,
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        source: 'plex',
        details: err instanceof Error ? err.stack : undefined,
        httpStatus: 502,
      });
      res.status(502).json({
        error:
          err instanceof Error
            ? `Failed to stream from Plex: ${err.message}`
            : 'Failed to stream from Plex',
      });
      return;
    }
  }

  if (!fs.existsSync(targetFilePath)) {
    playbackLogService.addLog({
      level: 'error',
      category: 'stream',
      message: `Audio source file is missing on disk: "${targetFilePath}" for track "${track.title}".`,
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      ext: track.ext,
      source,
      httpStatus: 404,
    });
    res.status(404).json({ error: 'Audio source file is missing on disk.' });
    return;
  }

  const stat = fs.statSync(targetFilePath);
  const fileSize = stat.size;
  const contentType = getMimeType(track.ext, isTranscodedMp3);
  const rangeHeader = req.headers.range;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Radiarr-Play-Method', isTranscodedMp3 ? 'transcode-mp3' : 'direct-play');

  if (!rangeHeader) {
    res.status(200);
    res.setHeader('Content-Length', String(fileSize));
    fs.createReadStream(targetFilePath).pipe(res);
    return;
  }

  // Parse HTTP Range header: "bytes=start-end"
  const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!match) {
    res.status(416);
    res.setHeader('Content-Range', `bytes */${fileSize}`);
    res.end();
    return;
  }

  const startStr = match[1];
  const endStr = match[2];

  let start = startStr ? parseInt(startStr, 10) : 0;
  let end = endStr ? parseInt(endStr, 10) : fileSize - 1;

  if (!startStr && endStr) {
    // Suffix byte-range-spec: "bytes=-500" means last 500 bytes
    const suffixLength = parseInt(endStr, 10);
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  }

  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start < 0 ||
    end >= fileSize ||
    start > end
  ) {
    res.status(416);
    res.setHeader('Content-Range', `bytes */${fileSize}`);
    res.end();
    return;
  }

  const chunkSize = end - start + 1;
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
  res.setHeader('Content-Length', String(chunkSize));

  fs.createReadStream(targetFilePath, { start, end }).pipe(res);
}
