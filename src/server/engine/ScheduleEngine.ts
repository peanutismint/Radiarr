import crypto from 'node:crypto';
import {
  extractCanonicalGenreDisplays,
  partitionDaypartTrackPools,
  resolveTrackEraMetadata,
} from '../../shared/metadataNormalizer.ts';
import {
  computeBatchMovedIds,
  inferStationCategory,
  resolveStationTileColor,
} from '../../shared/stationVisuals.ts';
import {
  CurationMetadataOptions,
  DaypartRule,
  EpgResponse,
  EpgStationSchedule,
  PlayMode,
  StarterSuggestion,
  StationPreviewResponse,
  StationRecord,
  StationRules,
  StationWithStats,
  TrackRecord,
  TuneInResponse,
} from '../../shared/types.ts';
import { isDirectPlayExtension, transcodeCache } from '../audio/TranscodeCache.ts';
import { db } from '../db/index.ts';
import { scannerService } from '../scanner/ScannerService.ts';
import { getMatchingTracksFromDb } from './RuleMatcher.ts';
import { resolveStationAtTime, resolveStationWindow } from './ScheduleResolver.ts';

const MAX_TIMESHIFT_MS = 6 * 60 * 60 * 1000; // +/- 6 hours

function randomSeed32(): number {
  return crypto.randomBytes(4).readUInt32BE(0);
}

interface StationRow {
  id: string;
  name: string;
  channel_number: number;
  enabled: number;
  play_mode: PlayMode;
  rules_json: string;
  dayparts_enabled: number;
  dayparts_json: string;
  tile_color: string;
  thumbnail_url?: string | null;
  custom_color?: number;
  seed: number;
  epoch_ms: number;
  revision: number;
  created_at: number;
  updated_at: number;
}

function stripRuleMetaForComparison(
  rules: StationRules
): Omit<
  StationRules,
  | 'smartUpdate'
  | 'pinnedTrackIds'
  | 'crossfadeEnabled'
  | 'crossfadeSeconds'
  | 'thumbnailUrl'
  | 'customColor'
> {
  const {
    smartUpdate: _s,
    pinnedTrackIds: _p,
    crossfadeEnabled: _ce,
    crossfadeSeconds: _cs,
    thumbnailUrl: _th,
    customColor: _cc,
    ...rest
  } = rules;
  return rest;
}

export function inferDefaultCrossfadeEnabled(playMode: PlayMode, rules: StationRules): boolean {
  // Default ON for era/genre/singles track shuffle stations; OFF for full albums (straight / album_shuffle / specific albums)
  if (playMode !== 'shuffle') {
    return false;
  }
  if (rules.albums && rules.albums.length > 0) {
    return false;
  }
  return true;
}

export function normalizeCrossfadeSeconds(seconds?: number): number {
  if (typeof seconds === 'number' && [2, 3, 5, 8].includes(seconds)) {
    return seconds;
  }
  return 5;
}

function rowToStation(row: StationRow): StationRecord {
  const rules = JSON.parse(row.rules_json || '{}') as StationRules;
  const smartUpdate = rules.smartUpdate !== false;
  const crossfadeEnabled =
    typeof rules.crossfadeEnabled === 'boolean'
      ? rules.crossfadeEnabled
      : inferDefaultCrossfadeEnabled(row.play_mode, rules);
  const crossfadeSeconds = normalizeCrossfadeSeconds(rules.crossfadeSeconds);

  const customColor = Boolean(row.custom_color === 1 || rules.customColor);
  const thumbnailUrl =
    (row.thumbnail_url && row.thumbnail_url.trim()) ||
    (rules.thumbnailUrl && rules.thumbnailUrl.trim()) ||
    null;

  const category = inferStationCategory(row.play_mode, rules, smartUpdate);
  const tileColor = resolveStationTileColor(
    row.play_mode,
    { ...rules, smartUpdate },
    row.tile_color,
    customColor
  );

  return {
    id: row.id,
    name: row.name,
    channelNumber: Number(row.channel_number),
    enabled: row.enabled === 1,
    smartUpdate,
    crossfadeEnabled,
    crossfadeSeconds,
    playMode: row.play_mode,
    rules: {
      ...rules,
      thumbnailUrl,
      customColor,
    },
    daypartsEnabled: row.dayparts_enabled === 1,
    dayparts: JSON.parse(row.dayparts_json || '[]') as DaypartRule[],
    tileColor,
    customColor,
    thumbnailUrl,
    category,
    seed: Number(row.seed),
    epochMs: Number(row.epoch_ms),
    revision: Number(row.revision),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

class ScheduleEngine {
  private cachedCurationOptions: CurationMetadataOptions | null = null;
  private cachedStarterSuggestions: StarterSuggestion[] | null = null;

  public invalidateCurationCache(): void {
    this.cachedCurationOptions = null;
    this.cachedStarterSuggestions = null;
  }

  /**
   * Seeds starter stations on first startup if the stations table is empty
   * so the EPG, tune-in API, and curl commands work out of the box.
   */
  public seedDefaultStationsIfEmpty(): void {
    const countRow = db
      .prepare(`SELECT COUNT(*) AS cnt FROM stations`)
      .get() as { cnt: number };

    if (Number(countRow.cnt) > 0) {
      return;
    }

    const now = Date.now();
    const initialEpoch = now - 2 * 60 * 60 * 1000;

    const defaults: Array<{
      id: string;
      name: string;
      channelNumber: number;
      playMode: PlayMode;
      rules: StationRules;
      seed: number;
    }> = [
      {
        id: 'ch-midnight-echo',
        name: 'The Midnight Echo (Chronological)',
        channelNumber: 1,
        playMode: 'straight',
        rules: { artists: ['The Midnight Echo'] },
        seed: 10101,
      },
      {
        id: 'ch-hawthorne-albums',
        name: 'Hawthorne Pines (Chronological)',
        channelNumber: 2,
        playMode: 'straight',
        rules: { artists: ['Hawthorne Pines'] },
        seed: 20202,
      },
      {
        id: 'ch-2000s-mix',
        name: '2000s Era Mix (Shuffle Bag)',
        channelNumber: 3,
        playMode: 'shuffle',
        rules: { yearMin: 2000, yearMax: 2009 },
        seed: 30303,
      },
      {
        id: 'ch-all-library',
        name: 'All Music Shuffle',
        channelNumber: 4,
        playMode: 'shuffle',
        rules: {},
        seed: 40404,
      },
    ];

    const stmt = db.prepare(`
      INSERT INTO stations (
        id, name, channel_number, enabled, play_mode, rules_json,
        dayparts_enabled, dayparts_json, tile_color, seed, epoch_ms,
        revision, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?, 0, '[]', ?, ?, ?, 1, ?, ?)
    `);

    for (const st of defaults) {
      const tileColor = resolveStationTileColor(st.playMode, st.rules, null, false);
      stmt.run(
        st.id,
        st.name,
        st.channelNumber,
        st.playMode,
        JSON.stringify(st.rules),
        tileColor,
        st.seed,
        initialEpoch,
        now,
        now
      );
    }
  }

  public listStations(): StationWithStats[] {
    const rows = db
      .prepare(`SELECT * FROM stations ORDER BY channel_number ASC`)
      .all() as unknown as StationRow[];

    return rows.map((r) => {
      const station = rowToStation(r);
      const matching = getMatchingTracksFromDb(station.rules);
      const matchingDurationMs = matching.reduce((acc, t) => acc + t.durationMs, 0);
      const { chillCount } = partitionDaypartTrackPools(matching);
      return {
        ...station,
        matchingTrackCount: matching.length,
        matchingDurationMs,
        chillTrackCount: chillCount,
      };
    });
  }

  public getStationById(stationId: string): StationWithStats | null {
    const row = db
      .prepare(`SELECT * FROM stations WHERE id = ?`)
      .get(stationId) as StationRow | undefined;

    if (!row) return null;
    const station = rowToStation(row);
    const matching = getMatchingTracksFromDb(station.rules);
    const matchingDurationMs = matching.reduce((acc, t) => acc + t.durationMs, 0);
    const { chillCount } = partitionDaypartTrackPools(matching);
    return {
      ...station,
      matchingTrackCount: matching.length,
      matchingDurationMs,
      chillTrackCount: chillCount,
    };
  }

  public createStation(input: {
    name: string;
    channelNumber?: number;
    playMode: PlayMode;
    rules: StationRules;
    enabled?: boolean;
    smartUpdate?: boolean;
    crossfadeEnabled?: boolean;
    crossfadeSeconds?: number;
    daypartsEnabled?: boolean;
    tileColor?: string;
    customColor?: boolean;
    thumbnailUrl?: string | null;
  }): StationWithStats {
    const now = Date.now();
    const id = `st-${crypto.randomBytes(5).toString('hex')}`;

    let channelNumber = input.channelNumber;
    if (typeof channelNumber !== 'number' || !Number.isFinite(channelNumber)) {
      const maxRow = db
        .prepare(`SELECT COALESCE(MAX(channel_number), 0) AS max_ch FROM stations`)
        .get() as { max_ch: number };
      channelNumber = Number(maxRow.max_ch) + 1;
    }

    const seed = randomSeed32();

    const smartUpdate =
      typeof input.smartUpdate === 'boolean'
        ? input.smartUpdate
        : input.rules?.smartUpdate !== false;

    const crossfadeEnabled =
      typeof input.crossfadeEnabled === 'boolean'
        ? input.crossfadeEnabled
        : typeof input.rules?.crossfadeEnabled === 'boolean'
          ? input.rules.crossfadeEnabled
          : inferDefaultCrossfadeEnabled(input.playMode, input.rules || {});

    const crossfadeSeconds = normalizeCrossfadeSeconds(
      input.crossfadeSeconds ?? input.rules?.crossfadeSeconds
    );

    const daypartsEnabled = Boolean(input.daypartsEnabled);

    const customColor = Boolean(
      typeof input.customColor === 'boolean'
        ? input.customColor
        : input.rules?.customColor
    );

    let thumbnailUrl =
      input.thumbnailUrl !== undefined
        ? input.thumbnailUrl || null
        : input.rules?.thumbnailUrl || null;

    // Automatically set any of the available artwork images as their thumbnail by default
    // Prioritize generic artist press photos (artist.jpg, band.jpg, fanart.jpg, Plex grandparentThumb)
    if (!thumbnailUrl || !thumbnailUrl.trim()) {
      const matching = getMatchingTracksFromDb(input.rules || {});
      const artistCandidates = new Set<string>();
      if (input.rules?.artists && input.rules.artists.length > 0) {
        for (const a of input.rules.artists) {
          if (a.trim()) artistCandidates.add(a.trim());
        }
      }
      for (const t of matching) {
        if (t.artist) artistCandidates.add(t.artist.trim());
        if (t.albumArtist) artistCandidates.add(t.albumArtist.trim());
        if (artistCandidates.size >= 12) break;
      }

      for (const artist of artistCandidates) {
        const row = db
          .prepare(`SELECT art_path FROM artists WHERE LOWER(name) = LOWER(?)`)
          .get(artist) as { art_path: string | null } | undefined;
        if (row && row.art_path) {
          thumbnailUrl = `/api/art/artist/${encodeURIComponent(artist)}`;
          break;
        }
      }

      if (!thumbnailUrl) {
        const trackWithArt = matching.find((t) => t.hasArt && t.albumId);
        if (trackWithArt) {
          thumbnailUrl = `/api/art/${encodeURIComponent(trackWithArt.albumId)}`;
        }
      }
    }

    const finalRules: StationRules = {
      ...(input.rules || {}),
      smartUpdate,
      crossfadeEnabled,
      crossfadeSeconds,
      customColor,
      thumbnailUrl,
    };

    const tileColor = resolveStationTileColor(
      input.playMode,
      finalRules,
      input.tileColor,
      customColor
    );

    if (!smartUpdate) {
      const currentMatching = getMatchingTracksFromDb(finalRules, {
        ignorePinnedSnapshot: true,
      });
      finalRules.pinnedTrackIds = currentMatching.map((t) => t.id);
    } else {
      delete finalRules.pinnedTrackIds;
    }

    db.prepare(`
      INSERT INTO stations (
        id, name, channel_number, enabled, play_mode, rules_json,
        dayparts_enabled, dayparts_json, tile_color, thumbnail_url, custom_color,
        seed, epoch_ms, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id,
      input.name.trim(),
      channelNumber,
      input.enabled === false ? 0 : 1,
      input.playMode,
      JSON.stringify(finalRules),
      daypartsEnabled ? 1 : 0,
      tileColor,
      thumbnailUrl,
      customColor ? 1 : 0,
      seed,
      now,
      now,
      now
    );

    this.cachedStarterSuggestions = null;
    return this.getStationById(id)!;
  }

  /**
   * Duplicates an existing station with a new channel number, fresh seed, and "(Copy)" name.
   */
  public duplicateStation(stationId: string): StationWithStats | null {
    const existing = this.getStationById(stationId);
    if (!existing) return null;

    return this.createStation({
      name: `${existing.name} (Copy)`,
      playMode: existing.playMode,
      rules: existing.rules,
      enabled: existing.enabled,
      smartUpdate: existing.smartUpdate,
      crossfadeEnabled: existing.crossfadeEnabled,
      crossfadeSeconds: existing.crossfadeSeconds,
      daypartsEnabled: existing.daypartsEnabled,
      tileColor: existing.tileColor,
      customColor: existing.customColor,
      thumbnailUrl: existing.thumbnailUrl,
    });
  }

  /**
   * Reorders stations by assigning sequential channel numbers (1..N) in a single transaction.
   * Uses a temporary high offset first so the UNIQUE constraint on channel_number is never violated.
   */
  public reorderStations(orderedIds: string[]): StationWithStats[] {
    const existing = this.listStations();
    const existingMap = new Map(existing.map((s) => [s.id, s]));

    const finalOrder: string[] = [];
    for (const id of orderedIds) {
      if (existingMap.has(id) && !finalOrder.includes(id)) {
        finalOrder.push(id);
      }
    }
    for (const st of existing) {
      if (!finalOrder.includes(st.id)) {
        finalOrder.push(st.id);
      }
    }

    const now = Date.now();
    const updateStmt = db.prepare(
      `UPDATE stations SET channel_number = ?, updated_at = ? WHERE id = ?`
    );

    db.exec('BEGIN');
    try {
      for (let i = 0; i < finalOrder.length; i++) {
        updateStmt.run(10000 + i + 1, now, finalOrder[i]);
      }
      for (let i = 0; i < finalOrder.length; i++) {
        updateStmt.run(i + 1, now, finalOrder[i]);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    return this.listStations();
  }

  /**
   * Updates a station.
   * Per Section 5.3: If a station's rules or play mode are edited, its schedule
   * regenerates from "now" (epoch_ms = now, new seed) and gets a new revision number.
   */
  public updateStation(
    stationId: string,
    patch: {
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
    },
    nowMs = Date.now()
  ): StationWithStats | null {
    const existing = this.getStationById(stationId);
    if (!existing) return null;

    const nextName = patch.name !== undefined ? patch.name.trim() : existing.name;
    const nextChannel =
      patch.channelNumber !== undefined ? patch.channelNumber : existing.channelNumber;
    const nextEnabled = patch.enabled !== undefined ? patch.enabled : existing.enabled;
    const nextPlayMode = patch.playMode !== undefined ? patch.playMode : existing.playMode;
    const nextDaypartsEnabled =
      typeof patch.daypartsEnabled === 'boolean'
        ? patch.daypartsEnabled
        : existing.daypartsEnabled;

    const nextSmartUpdate =
      typeof patch.smartUpdate === 'boolean'
        ? patch.smartUpdate
        : patch.rules?.smartUpdate !== undefined
          ? Boolean(patch.rules.smartUpdate)
          : existing.smartUpdate;

    const nextCrossfadeEnabled =
      typeof patch.crossfadeEnabled === 'boolean'
        ? patch.crossfadeEnabled
        : typeof patch.rules?.crossfadeEnabled === 'boolean'
          ? patch.rules.crossfadeEnabled
          : existing.crossfadeEnabled;

    const nextCrossfadeSeconds = normalizeCrossfadeSeconds(
      patch.crossfadeSeconds ?? patch.rules?.crossfadeSeconds ?? existing.crossfadeSeconds
    );

    const nextCustomColor =
      typeof patch.customColor === 'boolean'
        ? patch.customColor
        : typeof patch.rules?.customColor === 'boolean'
          ? patch.rules.customColor
          : existing.customColor;

    const nextThumbnailUrl =
      patch.thumbnailUrl !== undefined
        ? patch.thumbnailUrl || null
        : patch.rules?.thumbnailUrl !== undefined
          ? patch.rules.thumbnailUrl || null
          : existing.thumbnailUrl;

    const baseRules = patch.rules !== undefined ? { ...patch.rules } : { ...existing.rules };
    const filterRulesChanged =
      patch.rules !== undefined &&
      JSON.stringify(stripRuleMetaForComparison(patch.rules)) !==
        JSON.stringify(stripRuleMetaForComparison(existing.rules));

    const nextRules: StationRules = {
      ...baseRules,
      smartUpdate: nextSmartUpdate,
      crossfadeEnabled: nextCrossfadeEnabled,
      crossfadeSeconds: nextCrossfadeSeconds,
      customColor: nextCustomColor,
      thumbnailUrl: nextThumbnailUrl,
    };

    const nextTileColor = resolveStationTileColor(
      nextPlayMode,
      nextRules,
      patch.tileColor ?? existing.tileColor,
      nextCustomColor
    );

    if (!nextSmartUpdate) {
      // Snapshot matching tracks if we are turning off smartUpdate, editing filter rules, or explicitly refreshing the locked pool
      const needsFreshSnapshot =
        existing.smartUpdate ||
        filterRulesChanged ||
        patch.refreshPinnedPool ||
        !Array.isArray(existing.rules.pinnedTrackIds);

      if (needsFreshSnapshot) {
        const freshMatching = getMatchingTracksFromDb(nextRules, {
          ignorePinnedSnapshot: true,
        });
        nextRules.pinnedTrackIds = freshMatching.map((t) => t.id);
      } else {
        nextRules.pinnedTrackIds = existing.rules.pinnedTrackIds;
      }
    } else {
      delete nextRules.pinnedTrackIds;
    }

    const playModeChanged =
      patch.playMode !== undefined && patch.playMode !== existing.playMode;
    const crossfadeChanged =
      nextCrossfadeEnabled !== existing.crossfadeEnabled ||
      nextCrossfadeSeconds !== existing.crossfadeSeconds;
    const daypartsChanged = nextDaypartsEnabled !== existing.daypartsEnabled;
    const scheduleChanged =
      filterRulesChanged ||
      playModeChanged ||
      daypartsChanged ||
      Boolean(patch.refreshPinnedPool);
    const nextRevision =
      scheduleChanged || crossfadeChanged ? existing.revision + 1 : existing.revision;
    const nextEpochMs = scheduleChanged ? nowMs : existing.epochMs;
    const nextSeed = scheduleChanged ? randomSeed32() : existing.seed;

    db.prepare(`
      UPDATE stations
      SET name = ?,
          channel_number = ?,
          enabled = ?,
          play_mode = ?,
          rules_json = ?,
          dayparts_enabled = ?,
          tile_color = ?,
          thumbnail_url = ?,
          custom_color = ?,
          seed = ?,
          epoch_ms = ?,
          revision = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      nextName,
      nextChannel,
      nextEnabled ? 1 : 0,
      nextPlayMode,
      JSON.stringify(nextRules),
      nextDaypartsEnabled ? 1 : 0,
      nextTileColor,
      nextThumbnailUrl,
      nextCustomColor ? 1 : 0,
      nextSeed,
      nextEpochMs,
      nextRevision,
      nowMs,
      stationId
    );

    if (scheduleChanged) {
      db.prepare(`DELETE FROM station_checkpoints WHERE station_id = ?`).run(stationId);
    }

    this.cachedStarterSuggestions = null;
    return this.getStationById(stationId);
  }

  public deleteStation(stationId: string): boolean {
    const res = db.prepare(`DELETE FROM stations WHERE id = ?`).run(stationId);
    this.cachedStarterSuggestions = null;
    return Number(res.changes) > 0;
  }

  /**
   * Deletes multiple stations in a single transaction, resequencing the remaining channel numbers.
   */
  public batchDeleteStations(stationIds: string[]): { deletedCount: number; stations: StationWithStats[] } {
    if (!stationIds || stationIds.length === 0) {
      return { deletedCount: 0, stations: this.listStations() };
    }

    const placeholders = stationIds.map(() => '?').join(',');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`DELETE FROM stations WHERE id IN (${placeholders})`).run(...stationIds);
      db.prepare(`DELETE FROM station_checkpoints WHERE station_id IN (${placeholders})`).run(...stationIds);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    this.cachedStarterSuggestions = null;
    const remaining = this.listStations();
    const reordered = this.reorderStations(remaining.map((s) => s.id));
    return { deletedCount: stationIds.length, stations: reordered };
  }

  /**
   * Duplicates multiple stations in sequence.
   */
  public batchDuplicateStations(stationIds: string[]): StationWithStats[] {
    if (!stationIds || stationIds.length === 0) {
      return this.listStations();
    }
    for (const id of stationIds) {
      this.duplicateStation(id);
    }
    return this.listStations();
  }

  /**
   * Updates the play mode (track shuffle, album shuffle, straight) across multiple stations en masse.
   */
  public batchUpdatePlayMode(stationIds: string[], playMode: PlayMode): StationWithStats[] {
    if (!stationIds || stationIds.length === 0) {
      return this.listStations();
    }
    const nowMs = Date.now();
    for (const id of stationIds) {
      this.updateStation(id, { playMode }, nowMs);
    }
    return this.listStations();
  }

  /**
   * Enables or disables multiple stations en masse.
   */
  public batchToggleEnabled(stationIds: string[], enabled: boolean): StationWithStats[] {
    if (!stationIds || stationIds.length === 0) {
      return this.listStations();
    }
    for (const id of stationIds) {
      this.updateStation(id, { enabled });
    }
    return this.listStations();
  }

  /**
   * Reshuffles and regenerates schedules for multiple selected stations.
   */
  public batchRegenerateStations(stationIds: string[]): StationWithStats[] {
    if (!stationIds || stationIds.length === 0) {
      return this.listStations();
    }
    for (const id of stationIds) {
      this.regenerateStation(id);
    }
    return this.listStations();
  }

  /**
   * Moves multiple selected stations en masse ('top', 'bottom', 'up', 'down').
   */
  public batchMoveStations(
    selectedIds: string[],
    direction: 'top' | 'bottom' | 'up' | 'down'
  ): StationWithStats[] {
    const currentStations = this.listStations();
    const orderedIds = currentStations.map((s) => s.id);
    const newOrder = computeBatchMovedIds(orderedIds, selectedIds, direction);
    return this.reorderStations(newOrder);
  }

  /**
   * Instantly regenerates a station's schedule by creating a fresh random seed,
   * re-anchoring the timeline epoch to the current moment, and bumping revision.
   * Execution time is ~1ms because schedules are computed mathematically on-the-fly.
   */
  public regenerateStation(stationId: string): StationRecord | null {
    const existing = this.getStationById(stationId);
    if (!existing) return null;
    const nowMs = Date.now();
    const nextSeed = randomSeed32();
    const nextRevision = existing.revision + 1;

    db.prepare(`
      UPDATE stations
      SET seed = ?,
          epoch_ms = ?,
          revision = ?,
          updated_at = ?
      WHERE id = ?
    `).run(nextSeed, nowMs, nextRevision, nowMs, stationId);

    db.prepare(`DELETE FROM station_checkpoints WHERE station_id = ?`).run(stationId);
    this.cachedStarterSuggestions = null;
    return this.getStationById(stationId);
  }

  /**
   * Instantly regenerates schedules across all stations by giving each a fresh random seed
   * and resetting their timeline epochs to now.
   */
  public regenerateAllStations(): StationRecord[] {
    const stations = this.listStations();
    const nowMs = Date.now();
    for (const station of stations) {
      const nextSeed = randomSeed32();
      const nextRevision = station.revision + 1;
      db.prepare(`
        UPDATE stations
        SET seed = ?,
            epoch_ms = ?,
            revision = ?,
            updated_at = ?
        WHERE id = ?
      `).run(nextSeed, nowMs, nextRevision, nowMs, station.id);
    }
    db.exec(`DELETE FROM station_checkpoints;`);
    this.cachedStarterSuggestions = null;
    return this.listStations();
  }

  /**
   * Live preview of candidate rules: returns matching track count, total duration, sample tracks,
   * daypart energy breakdown, and distinct album artworks.
   */
  public previewRules(rules: StationRules): StationPreviewResponse {
    const matching = getMatchingTracksFromDb(rules || {});
    const matchingDurationMs = matching.reduce((acc, t) => acc + t.durationMs, 0);
    const { chillCount, balancedCount, upbeatCount } =
      partitionDaypartTrackPools(matching);

    const sampleTracks = matching.slice(0, 25).map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      album: t.album,
      year: t.originalYear ?? t.year ?? t.albumYear,
      originalYear: t.originalYear ?? null,
      genre: t.genre,
      energyLevel: t.energyLevel ?? 2,
      durationMs: t.durationMs,
    }));

    const seenAlbums = new Set<string>();
    const sampleArtworks: StationPreviewResponse['sampleArtworks'] = [];

    // Prioritize generic artist press photos (artist.jpg, band.jpg, fanart.jpg, Plex grandparentThumb)
    const artistCandidates = new Set<string>();
    if (rules.artists && rules.artists.length > 0) {
      for (const a of rules.artists) {
        if (a.trim()) artistCandidates.add(a.trim());
      }
    }
    for (const t of matching) {
      if (t.artist) artistCandidates.add(t.artist.trim());
      if (t.albumArtist) artistCandidates.add(t.albumArtist.trim());
      if (artistCandidates.size >= 15) break;
    }

    const seenArtists = new Set<string>();
    for (const artist of artistCandidates) {
      const norm = artist.toLowerCase();
      if (seenArtists.has(norm)) continue;
      seenArtists.add(norm);
      const row = db
        .prepare(`SELECT art_path FROM artists WHERE LOWER(name) = LOWER(?)`)
        .get(artist) as { art_path: string | null } | undefined;
      if (row && row.art_path) {
        sampleArtworks.push({
          albumId: `artist-${norm}`,
          album: `${artist} (Press Art)`,
          artist: artist,
          artUrl: `/api/art/artist/${encodeURIComponent(artist)}`,
          isArtistArt: true,
        });
      }
    }

    for (const t of matching) {
      if (!t.hasArt || seenAlbums.has(t.albumId)) continue;
      seenAlbums.add(t.albumId);
      sampleArtworks.push({
        albumId: t.albumId,
        album: t.album,
        artist: t.albumArtist || t.artist,
        artUrl: `/api/art/${encodeURIComponent(t.albumId)}`,
        isArtistArt: false,
      });
      if (sampleArtworks.length >= 24) break;
    }

    return {
      matchingTrackCount: matching.length,
      matchingDurationMs,
      chillTrackCount: chillCount,
      balancedTrackCount: balancedCount,
      upbeatTrackCount: upbeatCount,
      sampleTracks,
      sampleArtworks,
    };
  }

  /**
   * Returns available filter values from enabled libraries for the Station Editor UI.
   * Computed in a single fast pass over the in-memory track catalog and cached until libraries/tracks change.
   */
  public getCurationMetadataOptions(): CurationMetadataOptions {
    if (this.cachedCurationOptions) {
      return this.cachedCurationOptions;
    }

    const libraries = scannerService.getLibraries();
    const allTracks = getMatchingTracksFromDb({});

    const artistByLower = new Map<string, string>();
    const albumById = new Map<string, { id: string; title: string; artist: string }>();
    const genreByKey = new Map<string, string>();
    let yearMin: number | null = null;
    let yearMax: number | null = null;

    for (const t of allTracks) {
      const trimmedArtist = t.artist.trim();
      if (trimmedArtist) {
        const lowerA = trimmedArtist.toLowerCase();
        if (!artistByLower.has(lowerA)) {
          artistByLower.set(lowerA, trimmedArtist);
        }
      }

      if (!albumById.has(t.albumId)) {
        albumById.set(t.albumId, {
          id: t.albumId,
          title: t.album,
          artist: t.albumArtist || t.artist,
        });
      }

      if (t.genre) {
        const canonicalDisplays = extractCanonicalGenreDisplays(
          t.genre,
          Boolean(t.isReissueOrComp)
        );
        for (const disp of canonicalDisplays) {
          const lowerG = disp.toLowerCase();
          if (!genreByKey.has(lowerG)) {
            genreByKey.set(lowerG, disp);
          }
        }
      }

      const eraMeta = resolveTrackEraMetadata({
        year: t.year,
        originalYear: t.originalYear ?? null,
        albumYear: t.albumYear,
        title: t.title,
        album: t.album,
        artist: t.artist,
        albumArtist: t.albumArtist,
      });
      const effectiveYear =
        t.originalYear ?? eraMeta.originalYear ?? eraMeta.effectiveYear;
      if (
        effectiveYear !== null &&
        Number.isFinite(effectiveYear) &&
        !eraMeta.isUnverifiedModernReissue
      ) {
        if (yearMin === null || effectiveYear < yearMin) yearMin = effectiveYear;
        if (yearMax === null || effectiveYear > yearMax) yearMax = effectiveYear;
      }
    }

    const artists = [...artistByLower.values()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    const albums = [...albumById.values()].sort((a, b) => {
      const artistCmp = a.artist.localeCompare(b.artist, undefined, {
        sensitivity: 'base',
      });
      if (artistCmp !== 0) return artistCmp;
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    });

    const genres = [...genreByKey.values()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    this.cachedCurationOptions = {
      libraries,
      artists,
      albums,
      genres,
      yearMin,
      yearMax,
    };

    return this.cachedCurationOptions;
  }

  /**
   * Generates starter station suggestions from library tags in a single in-memory pass:
   * 1. Prolific Artist Album Channels (Chronological 'straight' mode — ordered by most media first)
   * 2. Shuffle & Era/Genre Station Suggestions (Genres as albums or singles + Eras/Decades)
   * Never creates stations automatically; filters out dismissed suggestions and already-existing identical stations.
   */
  public getStarterSuggestions(): StarterSuggestion[] {
    if (this.cachedStarterSuggestions) {
      return this.cachedStarterSuggestions;
    }

    const dismissedRows = db
      .prepare(`SELECT suggestion_key FROM dismissed_suggestions`)
      .all() as Array<{ suggestion_key: string }>;
    const dismissedSet = new Set(dismissedRows.map((r) => r.suggestion_key));

    const existingStations = this.listStations();
    const allTracks = getMatchingTracksFromDb({});
    if (allTracks.length === 0) {
      this.cachedStarterSuggestions = [];
      return [];
    }

    const libraries = scannerService.getLibraries().filter((l) => l.enabled);
    const albumsLibs = libraries.filter((l) => /\balbum/i.test(l.name));
    const singlesLibs = libraries.filter((l) => /\bsingle/i.test(l.name));
    const albumsLibIdSet = new Set(albumsLibs.map((l) => l.id));
    const singlesLibIdSet = new Set(singlesLibs.map((l) => l.id));

    // Single-pass aggregation across allTracks
    interface BucketStats {
      displayName: string;
      trackCount: number;
      durationMs: number;
      albumIds: Set<string>;
      albumsLibTrackCount: number;
      albumsLibDurationMs: number;
      albumsLibAlbumIds: Set<string>;
      singlesLibTrackCount: number;
      singlesLibDurationMs: number;
    }

    const genreStats = new Map<string, BucketStats>();
    const artistStats = new Map<
      string,
      { displayName: string; trackCount: number; durationMs: number; albumIds: Set<string> }
    >();
    const decadeStats = new Map<
      number,
      {
        trackCount: number;
        durationMs: number;
        albumIds: Set<string>;
        albumsLibTrackCount: number;
        albumsLibDurationMs: number;
      }
    >();

    for (const t of allTracks) {
      const inAlbumsLib = albumsLibIdSet.has(t.libraryId);
      const inSinglesLib = singlesLibIdSet.has(t.libraryId);

      // Artist aggregation
      const artistName = t.artist.trim();
      if (artistName && artistName.toLowerCase() !== 'unknown artist') {
        const lowerArtist = artistName.toLowerCase();
        let aStat = artistStats.get(lowerArtist);
        if (!aStat) {
          aStat = {
            displayName: artistName,
            trackCount: 0,
            durationMs: 0,
            albumIds: new Set<string>(),
          };
          artistStats.set(lowerArtist, aStat);
        }
        aStat.trackCount += 1;
        aStat.durationMs += t.durationMs;
        aStat.albumIds.add(t.albumId);
      }

      const eraMeta = resolveTrackEraMetadata({
        year: t.year,
        originalYear: t.originalYear ?? null,
        albumYear: t.albumYear,
        title: t.title,
        album: t.album,
        artist: t.artist,
        albumArtist: t.albumArtist,
      });

      // Genre aggregation (canonicalized & compilation bleed-guarded)
      if (t.genre) {
        const canonicalGenres = extractCanonicalGenreDisplays(
          t.genre,
          Boolean(t.isReissueOrComp ?? eraMeta.isReissueOrComp)
        );
        for (const gName of canonicalGenres) {
          const lowerG = gName.toLowerCase();
          let gStat = genreStats.get(lowerG);
          if (!gStat) {
            gStat = {
              displayName: gName,
              trackCount: 0,
              durationMs: 0,
              albumIds: new Set<string>(),
              albumsLibTrackCount: 0,
              albumsLibDurationMs: 0,
              albumsLibAlbumIds: new Set<string>(),
              singlesLibTrackCount: 0,
              singlesLibDurationMs: 0,
            };
            genreStats.set(lowerG, gStat);
          }
          gStat.trackCount += 1;
          gStat.durationMs += t.durationMs;
          gStat.albumIds.add(t.albumId);

          if (inAlbumsLib) {
            gStat.albumsLibTrackCount += 1;
            gStat.albumsLibDurationMs += t.durationMs;
            gStat.albumsLibAlbumIds.add(t.albumId);
          }
          if (inSinglesLib) {
            gStat.singlesLibTrackCount += 1;
            gStat.singlesLibDurationMs += t.durationMs;
          }
        }
      }

      // Decade / Era aggregation (using verified original release year, excluding remaster drift)
      const effectiveYear =
        t.originalYear ?? eraMeta.originalYear ?? eraMeta.effectiveYear;
      if (
        !eraMeta.isUnverifiedModernReissue &&
        effectiveYear !== null &&
        effectiveYear >= 1950 &&
        effectiveYear <= 2029
      ) {
        const decadeStart = Math.floor(effectiveYear / 10) * 10;
        let dStat = decadeStats.get(decadeStart);
        if (!dStat) {
          dStat = {
            trackCount: 0,
            durationMs: 0,
            albumIds: new Set<string>(),
            albumsLibTrackCount: 0,
            albumsLibDurationMs: 0,
          };
          decadeStats.set(decadeStart, dStat);
        }
        dStat.trackCount += 1;
        dStat.durationMs += t.durationMs;
        dStat.albumIds.add(t.albumId);
        if (inAlbumsLib) {
          dStat.albumsLibTrackCount += 1;
          dStat.albumsLibDurationMs += t.durationMs;
        }
      }
    }

    const artistSuggestions: StarterSuggestion[] = [];
    const shuffleSuggestions: StarterSuggestion[] = [];

    // 1. ARTIST ALBUM CHANNELS FIRST (Ordered by most media: track count & album count, always chronological 'straight' mode)
    const prolificArtists = [...artistStats.values()]
      .filter((a) => a.albumIds.size >= 2 || a.trackCount >= 5)
      .sort(
        (a, b) =>
          b.trackCount - a.trackCount ||
          b.albumIds.size - a.albumIds.size ||
          b.durationMs - a.durationMs ||
          a.displayName.localeCompare(b.displayName)
      );

    for (const artist of prolificArtists) {
      const lowerArtist = artist.displayName.toLowerCase();
      const key = `artist:${lowerArtist}`;
      if (dismissedSet.has(key)) continue;

      const alreadyHasArtistStation = existingStations.some(
        (s) =>
          s.rules.artists &&
          s.rules.artists.length === 1 &&
          s.rules.artists[0].toLowerCase() === lowerArtist
      );
      if (alreadyHasArtistStation) continue;

      artistSuggestions.push({
        key,
        category: 'artist',
        name: `${artist.displayName} Chronological`,
        description: `${artist.albumIds.size} album${artist.albumIds.size === 1 ? '' : 's'} (${artist.trackCount} tracks) by ${artist.displayName} played in chronological release order.`,
        playMode: 'straight',
        rules: {
          artists: [artist.displayName],
          crossfadeEnabled: false,
          crossfadeSeconds: 5,
        },
        crossfadeEnabled: false,
        crossfadeSeconds: 5,
        matchingTrackCount: artist.trackCount,
        matchingDurationMs: artist.durationMs,
      });
    }

    // 2. SHUFFLE STATION SUGGESTIONS (Based on Eras / Decades and Genres)
    const sortedGenres = [...genreStats.values()].sort(
      (a, b) => b.trackCount - a.trackCount || a.displayName.localeCompare(b.displayName)
    );

    const genreCandidates: StarterSuggestion[] = [];
    for (const g of sortedGenres) {
      const lowerG = g.displayName.toLowerCase();

      // 2a. Full genre shuffle channel
      const baseKey = `genre:${lowerG}`;
      const alreadyHasBaseGenre = existingStations.some(
        (s) =>
          s.rules.genres &&
          s.rules.genres.length === 1 &&
          s.rules.genres[0].toLowerCase() === lowerG &&
          (!s.rules.libraryIds || s.rules.libraryIds.length === 0)
      );
      if (!dismissedSet.has(baseKey) && !alreadyHasBaseGenre && g.trackCount >= 3) {
        genreCandidates.push({
          key: baseKey,
          category: 'genre',
          name: `${g.displayName} Radio`,
          description: `All ${g.trackCount} ${g.displayName} tracks across your libraries in shuffle mode.`,
          playMode: 'shuffle',
          rules: { genres: [g.displayName], crossfadeEnabled: true, crossfadeSeconds: 5 },
          crossfadeEnabled: true,
          crossfadeSeconds: 5,
          matchingTrackCount: g.trackCount,
          matchingDurationMs: g.durationMs,
        });
      }

      // 2b. Genre Singles channel (if user has dedicated Singles library/libraries with tracks in this genre)
      if (singlesLibs.length > 0 && g.singlesLibTrackCount >= 3) {
        const singlesGenreKey = `genre-singles:${lowerG}`;
        const targetLibIds = singlesLibs.map((l) => l.id);
        const alreadyHasSinglesGenre = existingStations.some(
          (s) =>
            s.rules.genres?.length === 1 &&
            s.rules.genres[0].toLowerCase() === lowerG &&
            s.rules.libraryIds?.some((id) => singlesLibIdSet.has(id))
        );
        if (!dismissedSet.has(singlesGenreKey) && !alreadyHasSinglesGenre) {
          genreCandidates.push({
            key: singlesGenreKey,
            category: 'genre',
            name: `${g.displayName} Singles`,
            description: `${g.singlesLibTrackCount} ${g.displayName} cuts from your Singles library in shuffle mode.`,
            playMode: 'shuffle',
            rules: {
              genres: [g.displayName],
              libraryIds: targetLibIds,
              crossfadeEnabled: true,
              crossfadeSeconds: 5,
            },
            crossfadeEnabled: true,
            crossfadeSeconds: 5,
            matchingTrackCount: g.singlesLibTrackCount,
            matchingDurationMs: g.singlesLibDurationMs,
          });
        }
      }

      // 2c. Genre Albums channel (if user has dedicated Albums library/libraries with tracks in this genre)
      if (albumsLibs.length > 0 && g.albumsLibTrackCount >= 5 && g.albumsLibAlbumIds.size >= 2) {
        const albumsGenreKey = `genre-albums:${lowerG}`;
        const targetLibIds = albumsLibs.map((l) => l.id);
        const alreadyHasAlbumsGenre = existingStations.some(
          (s) =>
            s.rules.genres?.length === 1 &&
            s.rules.genres[0].toLowerCase() === lowerG &&
            s.rules.libraryIds?.some((id) => albumsLibIdSet.has(id))
        );
        if (!dismissedSet.has(albumsGenreKey) && !alreadyHasAlbumsGenre) {
          genreCandidates.push({
            key: albumsGenreKey,
            category: 'genre',
            name: `${g.displayName} Albums`,
            description: `Full ${g.displayName} albums (${g.albumsLibAlbumIds.size} albums) from your Albums library played start-to-finish.`,
            playMode: 'album_shuffle',
            rules: {
              genres: [g.displayName],
              libraryIds: targetLibIds,
              crossfadeEnabled: false,
              crossfadeSeconds: 5,
            },
            crossfadeEnabled: false,
            crossfadeSeconds: 5,
            matchingTrackCount: g.albumsLibTrackCount,
            matchingDurationMs: g.albumsLibDurationMs,
          });
        }
      }
    }

    const decadeCandidates: StarterSuggestion[] = [];
    const sortedDecades = [...decadeStats.entries()].sort(
      (a, b) => b[1].trackCount - a[1].trackCount || a[0] - b[0]
    );
    for (const [decadeStart, dStat] of sortedDecades) {
      if (dStat.trackCount < 3) continue;
      const decadeEnd = decadeStart + 9;
      const key = `decade:${decadeStart}s`;

      const alreadyHasDecade = existingStations.some(
        (s) =>
          s.rules.yearMin === decadeStart &&
          s.rules.yearMax === decadeEnd &&
          (!s.rules.libraryIds || s.rules.libraryIds.length === 0)
      );

      if (!dismissedSet.has(key) && !alreadyHasDecade) {
        decadeCandidates.push({
          key,
          category: 'decade',
          name: `${decadeStart}s Era Radio`,
          description: `${dStat.trackCount} tracks released between ${decadeStart} and ${decadeEnd} in shuffle mode.`,
          playMode: 'shuffle',
          rules: {
            yearMin: decadeStart,
            yearMax: decadeEnd,
            crossfadeEnabled: true,
            crossfadeSeconds: 5,
          },
          crossfadeEnabled: true,
          crossfadeSeconds: 5,
          matchingTrackCount: dStat.trackCount,
          matchingDurationMs: dStat.durationMs,
        });
      }

      if (albumsLibs.length > 0 && dStat.albumsLibTrackCount >= 8) {
        const eraAlbumsKey = `decade-albums:${decadeStart}s`;
        const targetLibIds = albumsLibs.map((l) => l.id);
        const alreadyHasEraAlbums = existingStations.some(
          (s) =>
            s.rules.yearMin === decadeStart &&
            s.rules.yearMax === decadeEnd &&
            s.rules.libraryIds?.some((id) => albumsLibIdSet.has(id))
        );
        if (!dismissedSet.has(eraAlbumsKey) && !alreadyHasEraAlbums) {
          decadeCandidates.push({
            key: eraAlbumsKey,
            category: 'decade',
            name: `${decadeStart}s Albums`,
            description: `Albums from the ${decadeStart}s (${decadeStart}–${decadeEnd}) played start-to-finish.`,
            playMode: 'album_shuffle',
            rules: {
              yearMin: decadeStart,
              yearMax: decadeEnd,
              libraryIds: targetLibIds,
              crossfadeEnabled: false,
              crossfadeSeconds: 5,
            },
            crossfadeEnabled: false,
            crossfadeSeconds: 5,
            matchingTrackCount: dStat.albumsLibTrackCount,
            matchingDurationMs: dStat.albumsLibDurationMs,
          });
        }
      }
    }

    // Interleave Era and Genre shuffle suggestions so both eras and genres appear in the top 8 shuffle slots
    const maxShuffleLen = Math.max(genreCandidates.length, decadeCandidates.length);
    for (let i = 0; i < maxShuffleLen; i++) {
      if (i < genreCandidates.length) {
        shuffleSuggestions.push(genreCandidates[i]);
      }
      if (i < decadeCandidates.length) {
        shuffleSuggestions.push(decadeCandidates[i]);
      }
    }

    const suggestions = [...artistSuggestions, ...shuffleSuggestions];
    this.cachedStarterSuggestions = suggestions;
    return suggestions;
  }

  public dismissSuggestion(key: string): void {
    db.prepare(`
      INSERT INTO dismissed_suggestions (suggestion_key, dismissed_at)
      VALUES (?, ?)
      ON CONFLICT(suggestion_key) DO UPDATE SET dismissed_at = excluded.dismissed_at
    `).run(key, Date.now());
    this.cachedStarterSuggestions = null;
  }

  public tuneStation(
    stationId: string,
    rawOffsetMs = 0,
    serverTimeMs = Date.now()
  ): TuneInResponse | null {
    const station = this.getStationById(stationId);
    if (!station) return null;

    const clampedOffsetMs = Math.max(
      -MAX_TIMESHIFT_MS,
      Math.min(MAX_TIMESHIFT_MS, Math.round(rawOffsetMs))
    );
    const effectiveTimeMs = serverTimeMs + clampedOffsetMs;

    const matchingTracks = getMatchingTracksFromDb(station.rules);
    if (matchingTracks.length === 0) {
      return {
        station,
        serverTimeMs,
        effectiveTimeMs,
        offsetMs: clampedOffsetMs,
        revision: station.revision,
        empty: true,
        nowPlaying: null,
        upNext: null,
      };
    }

    const resolved = resolveStationAtTime(station, matchingTracks, effectiveTimeMs);
    if (!resolved) {
      return {
        station,
        serverTimeMs,
        effectiveTimeMs,
        offsetMs: clampedOffsetMs,
        revision: station.revision,
        empty: true,
        nowPlaying: null,
        upNext: null,
      };
    }

    const currentDirect = resolved.current.track.directPlay;
    const transcodeReady =
      currentDirect || Boolean(transcodeCache.getCachedPathIfReady(resolved.current.track.id));

    this.warmLookaheadTranscodes(station.id, effectiveTimeMs);

    return {
      station,
      serverTimeMs,
      effectiveTimeMs,
      offsetMs: clampedOffsetMs,
      revision: station.revision,
      empty: false,
      nowPlaying: {
        ...resolved.current,
        positionMs: resolved.positionMs,
        transcodeReady,
      },
      upNext: resolved.next,
    };
  }

  public navigateTrackOffset(
    stationId: string,
    currentOffsetMs: number,
    direction: 'prev' | 'next',
    serverTimeMs = Date.now(),
    currentTimeMs?: number
  ): { offsetMs: number; tune: TuneInResponse } | null {
    const station = this.getStationById(stationId);
    if (!station) return null;

    const clampedOffsetMs = Math.max(
      -MAX_TIMESHIFT_MS,
      Math.min(MAX_TIMESHIFT_MS, Math.round(currentOffsetMs))
    );
    const effectiveTimeMs =
      typeof currentTimeMs === 'number' && Number.isFinite(currentTimeMs)
        ? currentTimeMs
        : serverTimeMs + clampedOffsetMs;
    const matchingTracks = getMatchingTracksFromDb(station.rules);
    const resolved = resolveStationAtTime(station, matchingTracks, effectiveTimeMs);

    if (!resolved) {
      const tune = this.tuneStation(stationId, clampedOffsetMs, serverTimeMs)!;
      return { offsetMs: clampedOffsetMs, tune };
    }

    let targetTimeMs: number;
    if (direction === 'next') {
      targetTimeMs = resolved.next.startMs;
    } else {
      if (resolved.positionMs > 3000) {
        targetTimeMs = resolved.current.startMs;
      } else {
        targetTimeMs = resolved.previous.startMs;
      }
    }

    const newOffsetMs = Math.max(
      -MAX_TIMESHIFT_MS,
      Math.min(MAX_TIMESHIFT_MS, targetTimeMs - serverTimeMs)
    );
    const tune = this.tuneStation(stationId, newOffsetMs, serverTimeMs)!;
    return { offsetMs: newOffsetMs, tune };
  }

  public getEpgWindow(
    fromMs?: number,
    toMs?: number,
    serverTimeMs = Date.now()
  ): EpgResponse {
    const effectiveFrom =
      typeof fromMs === 'number' && Number.isFinite(fromMs)
        ? fromMs
        : serverTimeMs - 15 * 60 * 1000;
    const effectiveTo =
      typeof toMs === 'number' && Number.isFinite(toMs)
        ? toMs
        : serverTimeMs + 90 * 60 * 1000;

    const enabledStations = this.listStations().filter((s) => s.enabled);

    const stationSchedules: EpgStationSchedule[] = enabledStations.map((station) => {
      const matchingTracks = getMatchingTracksFromDb(station.rules);
      if (matchingTracks.length === 0) {
        return {
          station,
          empty: true,
          slots: [],
        };
      }

      const slots = resolveStationWindow(
        station,
        matchingTracks,
        effectiveFrom,
        effectiveTo
      );
      return {
        station,
        empty: slots.length === 0,
        slots,
      };
    });

    return {
      serverTimeMs,
      fromMs: effectiveFrom,
      toMs: effectiveTo,
      stations: stationSchedules,
    };
  }

  public warmLookaheadTranscodes(activeStationId?: string, referenceTimeMs = Date.now()): void {
    const enabled = this.listStations().filter((s) => s.enabled);
    if (enabled.length === 0) return;

    let targetStations = enabled;
    if (activeStationId) {
      const idx = enabled.findIndex((s) => s.id === activeStationId);
      if (idx !== -1 && enabled.length > 5) {
        const picked = new Set<StationWithStats>();
        for (const delta of [0, 1, -1, 2, -2]) {
          const neighborIdx = (idx + delta + enabled.length) % enabled.length;
          picked.add(enabled[neighborIdx]);
        }
        targetStations = [...picked];
      }
    }

    const lookaheadTracks: TrackRecord[] = [];
    for (const st of targetStations) {
      const matching = getMatchingTracksFromDb(st.rules);
      if (matching.length === 0) continue;

      const resolved = resolveStationAtTime(st, matching, referenceTimeMs);
      if (!resolved) continue;

      const trackMap = new Map(matching.map((t) => [t.id, t]));
      const curTrack = trackMap.get(resolved.current.track.id);
      const nextTrack = trackMap.get(resolved.next.track.id);

      if (curTrack && !isDirectPlayExtension(curTrack.ext)) {
        lookaheadTracks.push(curTrack);
      }
      if (nextTrack && !isDirectPlayExtension(nextTrack.ext)) {
        lookaheadTracks.push(nextTrack);
      }
    }

    if (lookaheadTracks.length > 0) {
      transcodeCache.enqueueLookahead(lookaheadTracks);
    }
  }
}

export const scheduleEngine = new ScheduleEngine();
