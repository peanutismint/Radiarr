import express from 'express';
import { PlayMode, StationRules } from '../../shared/types.ts';
import { streamTrackAudio } from '../audio/StreamService.ts';
import { scheduleEngine } from '../engine/ScheduleEngine.ts';
import {
  serveM3uPlaylist,
  serveXmltvEpg,
  streamLiveStationMp3,
} from '../iptv/IptvExportService.ts';
import { requireAuth } from '../middleware/authMiddleware.ts';

export const stationsRouter = express.Router();

// IPTV M3U Playlist & XMLTV EPG exports (Tunarr-style endpoints for external apps)
stationsRouter.get(['/channels.m3u', '/m3u'], (req, res) => {
  serveM3uPlaylist(req, res);
});

stationsRouter.get(['/xmltv.xml', '/epg.xml'], (req, res) => {
  serveXmltvEpg(req, res);
});

// Continuous live MP3 stream for a station (used by external M3U players)
stationsRouter.get(['/stations/:id/stream.mp3', '/stations/:id/stream'], (req, res) => {
  void streamLiveStationMp3(req, res);
});

// Voice-triggered routine webhook for Home Assistant / Google Assistant ("Hey Google, play [station] on Radiarr")
stationsRouter.all('/integrations/voice-play', (req, res) => {
  const queryParam = req.query.station || req.query.name || req.query.q;
  const bodyParam =
    (req.body as { station?: string; name?: string; q?: string } | undefined)?.station ||
    (req.body as { station?: string; name?: string; q?: string } | undefined)?.name ||
    (req.body as { station?: string; name?: string; q?: string } | undefined)?.q;
  const queryStr = String(queryParam || bodyParam || '').trim().toLowerCase();

  const stations = scheduleEngine.listStations().filter((s) => s.enabled);
  if (stations.length === 0) {
    res.status(404).json({ error: 'No enabled stations found' });
    return;
  }

  let matched = stations[0];
  if (queryStr) {
    const exactName = stations.find((s) => s.name.toLowerCase() === queryStr);
    const partialName = stations.find((s) => s.name.toLowerCase().includes(queryStr));
    const artistMatch = stations.find((s) =>
      s.rules.artists?.some((a) => a.toLowerCase().includes(queryStr))
    );
    matched = exactName || partialName || artistMatch || stations[0];
  }

  const protoHeader = req.headers['x-forwarded-proto'];
  const proto =
    typeof protoHeader === 'string' && protoHeader.trim() !== ''
      ? protoHeader.split(',')[0].trim()
      : req.protocol || 'http';
  const host = req.get('host') || 'localhost:3000';
  const streamUrl = `${proto}://${host}/api/stations/${encodeURIComponent(matched.id)}/stream.mp3`;

  res.json({
    success: true,
    station: {
      id: matched.id,
      name: matched.name,
      channelNumber: matched.channelNumber,
      playMode: matched.playMode,
      streamUrl,
    },
  });
});

// List all stations in channel order
stationsRouter.get('/stations', (_req, res) => {
  const stations = scheduleEngine.listStations();
  res.json({ stations });
});

// Live preview of matching tracks & total hours for candidate rules
stationsRouter.post('/stations/preview', (req, res) => {
  const { rules } = req.body as { rules?: StationRules };
  const preview = scheduleEngine.previewRules(rules || {});
  res.json(preview);
});

// Batch move stations en masse ('top', 'bottom', 'up', 'down')
stationsRouter.post('/stations/batch/move', requireAuth('curator'), (req, res) => {
  const { ids, direction } = req.body as { ids?: string[]; direction?: 'top' | 'bottom' | 'up' | 'down' };
  if (!Array.isArray(ids) || ids.length === 0 || !direction) {
    res.status(400).json({ error: 'Fields "ids" (string[]) and "direction" ("top"|"bottom"|"up"|"down") are required.' });
    return;
  }
  try {
    const stations = scheduleEngine.batchMoveStations(ids, direction);
    res.json({ success: true, stations });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to move stations' });
  }
});

// Batch delete stations en masse
stationsRouter.post('/stations/batch/delete', requireAuth('curator'), (req, res) => {
  const { ids } = req.body as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'Field "ids" (string[]) is required.' });
    return;
  }
  try {
    const result = scheduleEngine.batchDeleteStations(ids);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete stations' });
  }
});

// Batch duplicate stations en masse
stationsRouter.post('/stations/batch/duplicate', requireAuth('curator'), (req, res) => {
  const { ids } = req.body as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'Field "ids" (string[]) is required.' });
    return;
  }
  try {
    const stations = scheduleEngine.batchDuplicateStations(ids);
    res.json({ success: true, stations });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to duplicate stations' });
  }
});

// Batch update play mode / shuffle settings en masse
stationsRouter.post('/stations/batch/play-mode', requireAuth('curator'), (req, res) => {
  const { ids, playMode } = req.body as { ids?: string[]; playMode?: PlayMode };
  const validModes: PlayMode[] = ['straight', 'album_shuffle', 'shuffle'];
  if (!Array.isArray(ids) || ids.length === 0 || !playMode || !validModes.includes(playMode)) {
    res.status(400).json({ error: 'Valid "ids" (string[]) and "playMode" ("shuffle"|"album_shuffle"|"straight") are required.' });
    return;
  }
  try {
    const stations = scheduleEngine.batchUpdatePlayMode(ids, playMode);
    res.json({ success: true, stations });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update play mode' });
  }
});

// Batch toggle enabled/disabled en masse
stationsRouter.post('/stations/batch/toggle-enabled', requireAuth('curator'), (req, res) => {
  const { ids, enabled } = req.body as { ids?: string[]; enabled?: boolean };
  if (!Array.isArray(ids) || ids.length === 0 || typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'Fields "ids" (string[]) and "enabled" (boolean) are required.' });
    return;
  }
  try {
    const stations = scheduleEngine.batchToggleEnabled(ids, enabled);
    res.json({ success: true, stations });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to toggle stations' });
  }
});

// Batch regenerate schedules en masse
stationsRouter.post('/stations/batch/regenerate', requireAuth('curator'), (req, res) => {
  const { ids } = req.body as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'Field "ids" (string[]) is required.' });
    return;
  }
  try {
    const stations = scheduleEngine.batchRegenerateStations(ids);
    res.json({ success: true, stations });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to regenerate stations' });
  }
});

// Reorder stations in channel order
stationsRouter.put('/stations/reorder', requireAuth('curator'), (req, res) => {
  const { orderedIds } = req.body as { orderedIds?: string[] };
  if (!Array.isArray(orderedIds)) {
    res.status(400).json({ error: 'Field "orderedIds" (string[]) is required.' });
    return;
  }

  try {
    const stations = scheduleEngine.reorderStations(orderedIds);
    res.json({ stations });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to reorder stations',
    });
  }
});

// Regenerate schedules for all stations with fresh random seeds and reset epochs
stationsRouter.post('/stations/regenerate', requireAuth('curator'), (_req, res) => {
  try {
    const stations = scheduleEngine.regenerateAllStations();
    res.json({ success: true, stations, message: 'All station schedules regenerated' });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to regenerate station schedules',
    });
  }
});

// Regenerate schedule for a single station
stationsRouter.post('/stations/:id/regenerate', requireAuth('curator'), (req, res) => {
  try {
    const { id } = req.params;
    const station = scheduleEngine.regenerateStation(id);
    if (!station) {
      res.status(404).json({ error: 'Station not found' });
      return;
    }
    res.json({ success: true, station, message: `Schedule for "${station.name}" regenerated` });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to regenerate station schedule',
    });
  }
});

// Serve a station's custom thumbnail image (supports data URLs or redirects to local/remote art URLs for M3U/XMLTV clients)
stationsRouter.get('/stations/:id/thumbnail', (req, res) => {
  const { id } = req.params;
  const station = scheduleEngine.getStationById(id);
  if (!station || !station.thumbnailUrl) {
    res.status(404).end();
    return;
  }

  const thumb = station.thumbnailUrl.trim();
  if (thumb.startsWith('data:image/')) {
    const match = thumb.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      res.status(400).end();
      return;
    }
    const mimeType = match[1];
    const buf = Buffer.from(match[2], 'base64');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buf);
    return;
  }

  res.redirect(thumb);
});

// Create a new station
stationsRouter.post('/stations', requireAuth('curator'), (req, res) => {
  const {
    name,
    channelNumber,
    playMode,
    rules,
    enabled,
    smartUpdate,
    crossfadeEnabled,
    crossfadeSeconds,
    daypartsEnabled,
    tileColor,
    customColor,
    thumbnailUrl,
  } = req.body as {
    name?: string;
    channelNumber?: number;
    playMode?: PlayMode;
    rules?: StationRules;
    enabled?: boolean;
    smartUpdate?: boolean;
    crossfadeEnabled?: boolean;
    crossfadeSeconds?: number;
    daypartsEnabled?: boolean;
    tileColor?: string;
    customColor?: boolean;
    thumbnailUrl?: string | null;
  };

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Station name is required.' });
    return;
  }

  const validModes: PlayMode[] = ['straight', 'album_shuffle', 'shuffle'];
  const mode: PlayMode =
    playMode && validModes.includes(playMode) ? playMode : 'shuffle';

  try {
    const station = scheduleEngine.createStation({
      name,
      channelNumber,
      playMode: mode,
      rules: rules || {},
      enabled,
      smartUpdate,
      crossfadeEnabled,
      crossfadeSeconds,
      daypartsEnabled,
      tileColor,
      customColor,
      thumbnailUrl,
    });
    res.status(201).json({ station });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to create station',
    });
  }
});

// Duplicate an existing station
stationsRouter.post('/stations/:id/duplicate', requireAuth('curator'), (req, res) => {
  const { id } = req.params;
  const duplicated = scheduleEngine.duplicateStation(id);
  if (!duplicated) {
    res.status(404).json({ error: `Station "${id}" not found.` });
    return;
  }
  res.status(201).json({ station: duplicated });
});

// Update a station (increments revision and resets epoch to now if rules or playMode change)
stationsRouter.put('/stations/:id', requireAuth('curator'), (req, res) => {
  const { id } = req.params;
  const patch = req.body as {
    name?: string;
    channelNumber?: number;
    enabled?: boolean;
    smartUpdate?: boolean;
    crossfadeEnabled?: boolean;
    crossfadeSeconds?: number;
    daypartsEnabled?: boolean;
    refreshPinnedPool?: boolean;
    playMode?: PlayMode;
    rules?: StationRules;
    tileColor?: string;
    customColor?: boolean;
    thumbnailUrl?: string | null;
  };

  try {
    const updated = scheduleEngine.updateStation(id, patch);
    if (!updated) {
      res.status(404).json({ error: `Station "${id}" not found.` });
      return;
    }
    res.json({ station: updated });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to update station',
    });
  }
});

// Delete a station
stationsRouter.delete('/stations/:id', requireAuth('curator'), (req, res) => {
  const { id } = req.params;
  const deleted = scheduleEngine.deleteStation(id);
  if (!deleted) {
    res.status(404).json({ error: `Station "${id}" not found.` });
    return;
  }
  res.json({ deleted: true });
});

// Curation metadata options (available libraries, artists, albums, genres, year bounds)
stationsRouter.get('/curation/options', (_req, res) => {
  const options = scheduleEngine.getCurationMetadataOptions();
  res.json(options);
});

// Starter station suggestions from scanned tags
stationsRouter.get('/suggestions', (_req, res) => {
  const suggestions = scheduleEngine.getStarterSuggestions();
  res.json({ suggestions });
});

// Dismiss a starter suggestion
stationsRouter.post('/suggestions/dismiss', (req, res) => {
  const { key } = req.body as { key?: string };
  if (!key || typeof key !== 'string') {
    res.status(400).json({ error: 'Suggestion "key" is required.' });
    return;
  }
  scheduleEngine.dismissSuggestion(key);
  res.json({ dismissed: true });
});

// Tune in to a station (returns now playing, positionMs, upNext, revision, and serverTimeMs)
stationsRouter.get('/stations/:id/tune', (req, res) => {
  const { id } = req.params;
  const offsetParam = req.query.offsetMs;
  const targetTimeParam = req.query.targetTimeMs;
  const serverTimeMs = Date.now();

  let offsetMs = 0;
  if (typeof targetTimeParam === 'string' && targetTimeParam.trim() !== '') {
    const targetTimeMs = Number(targetTimeParam);
    if (Number.isFinite(targetTimeMs)) {
      offsetMs = targetTimeMs - serverTimeMs;
    }
  } else if (typeof offsetParam === 'string' && offsetParam.trim() !== '') {
    const parsedOffset = Number(offsetParam);
    if (Number.isFinite(parsedOffset)) {
      offsetMs = parsedOffset;
    }
  }

  const tune = scheduleEngine.tuneStation(
    id,
    Number.isFinite(offsetMs) ? offsetMs : 0,
    serverTimeMs
  );

  if (!tune) {
    res.status(404).json({ error: `Station "${id}" not found.` });
    return;
  }

  res.json(tune);
});

// Time-shift track navigation (previous / next track on the deterministic timeline)
stationsRouter.post('/stations/:id/navigate', (req, res) => {
  const { id } = req.params;
  const { offsetMs = 0, direction, currentTimeMs } = req.body as {
    offsetMs?: number;
    direction?: 'prev' | 'next';
    currentTimeMs?: number;
  };

  if (direction !== 'prev' && direction !== 'next') {
    res.status(400).json({ error: 'Field "direction" must be "prev" or "next".' });
    return;
  }

  const result = scheduleEngine.navigateTrackOffset(
    id,
    Number.isFinite(offsetMs) ? Number(offsetMs) : 0,
    direction,
    Date.now(),
    typeof currentTimeMs === 'number' && Number.isFinite(currentTimeMs)
      ? currentTimeMs
      : undefined
  );

  if (!result) {
    res.status(404).json({ error: `Station "${id}" not found.` });
    return;
  }

  res.json(result);
});

// Schedule window (EPG) across all enabled stations
stationsRouter.get('/epg', (req, res) => {
  const fromParam = req.query.fromMs;
  const toParam = req.query.toMs;

  const fromMs =
    typeof fromParam === 'string' && fromParam.trim() !== ''
      ? Number(fromParam)
      : undefined;
  const toMs =
    typeof toParam === 'string' && toParam.trim() !== ''
      ? Number(toParam)
      : undefined;

  const epg = scheduleEngine.getEpgWindow(fromMs, toMs);
  res.json(epg);
});

// Audio streaming with HTTP 206 Partial Content Range support (direct-play or MP3 transcode fallback)
stationsRouter.get(['/audio/:trackId', '/tracks/:trackId/stream', '/tracks/:trackId/audio'], (req, res) => {
  void streamTrackAudio(req, res);
});
