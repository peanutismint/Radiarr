import express from 'express';
import { playbackLogService } from '../audio/PlaybackLogService.ts';
import { getServerSettings, saveServerSettings } from './settings.ts';

export const diagnosticsRouter = express.Router();

/**
 * GET /api/diagnostics/playback-logs
 * Returns in-memory circular buffer of streaming logs and overall audio/Plex health.
 */
diagnosticsRouter.get('/diagnostics/playback-logs', async (req, res) => {
  const level = typeof req.query.level === 'string' ? req.query.level : undefined;
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 100;

  try {
    const logs = playbackLogService.getLogs({ level, category, limit });
    const health = await playbackLogService.getHealthStatus();
    res.json({ logs, health });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to retrieve playback diagnostics',
    });
  }
});

/**
 * POST /api/diagnostics/client-log
 * Allows client browser/mobile players to report HTML5 <audio> errors, mediaError codes,
 * decode stalls, or auto-skip recovery events directly into the server diagnostics window.
 */
diagnosticsRouter.post('/diagnostics/client-log', (req, res) => {
  const {
    level = 'error',
    category = 'client',
    message,
    trackId,
    title,
    artist,
    album,
    ext,
    source,
    method,
    httpStatus,
    details,
    clientDeck,
  } = req.body || {};

  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message string is required.' });
    return;
  }

  const userAgent = req.headers['user-agent'] || undefined;
  const entry = playbackLogService.addLog({
    level: level === 'warn' || level === 'info' || level === 'success' ? level : 'error',
    category: category === 'stream' || category === 'plex' || category === 'transcode' ? category : 'client',
    message,
    trackId,
    title,
    artist,
    album,
    ext,
    source,
    method,
    httpStatus: typeof httpStatus === 'number' ? httpStatus : undefined,
    details:
      typeof details === 'object' && details !== null
        ? JSON.stringify(details, null, 2)
        : typeof details === 'string'
          ? details
          : undefined,
    clientDeck: clientDeck === 'B' ? 'B' : 'A',
    userAgent,
  });

  res.json({ ok: true, log: entry });
});

/**
 * POST /api/diagnostics/clear-logs
 * Clears the diagnostics buffer.
 */
diagnosticsRouter.post('/diagnostics/clear-logs', (_req, res) => {
  playbackLogService.clearLogs();
  res.json({ ok: true });
});

/**
 * POST /api/diagnostics/test-stream/:trackId
 * Probes a specific track to diagnose if it can be streamed or transcoded.
 */
diagnosticsRouter.post('/diagnostics/test-stream/:trackId', async (req, res) => {
  const { trackId } = req.params;
  try {
    const result = await playbackLogService.probeTrack(trackId);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to probe track',
    });
  }
});

/**
 * POST /api/diagnostics/settings
 * Updates playback-specific settings: forceTranscodeFlac, autoSkipUnplayable.
 */
diagnosticsRouter.post('/diagnostics/settings', (req, res) => {
  const { forceTranscodeFlac, autoSkipUnplayable } = req.body || {};
  const patch: Record<string, boolean> = {};

  if (typeof forceTranscodeFlac === 'boolean') {
    patch.forceTranscodeFlac = forceTranscodeFlac;
  }
  if (typeof autoSkipUnplayable === 'boolean') {
    patch.autoSkipUnplayable = autoSkipUnplayable;
  }

  const updated = saveServerSettings(patch);
  playbackLogService.addLog({
    level: 'info',
    category: 'health',
    message: `Updated playback settings: Force Transcode FLAC=${updated.forceTranscodeFlac}, Auto-Skip=${updated.autoSkipUnplayable}`,
  });

  res.json({ ok: true, settings: updated });
});
