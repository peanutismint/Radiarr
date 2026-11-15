import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StationRecord, TrackRecord } from '../shared/types.ts';
import { generateCycleTracks } from '../server/engine/CycleGenerator.ts';
import { filterTracksByRules } from '../server/engine/RuleMatcher.ts';
import {
  resolveStationAtTime,
  resolveStationWindow,
} from '../server/engine/ScheduleResolver.ts';

const MOCK_TRACKS: TrackRecord[] = [
  // Artist A - Album 1 (1995) - 2 tracks
  {
    id: 'trk-a1-1',
    libraryId: 'albums',
    albumId: 'alb-a1',
    filePath: '/music/albums/Artist A/First Album/01.mp3',
    ext: '.mp3',
    fileSize: 1000,
    mtimeMs: 100,
    title: 'Opening Act',
    artist: 'Artist A',
    albumArtist: 'Artist A',
    album: 'First Album',
    albumYear: 1995,
    albumTrackCount: 2,
    hasArt: true,
    trackNumber: 1,
    discNumber: 1,
    year: 1995,
    genre: 'Rock',
    durationMs: 10_000,
  },
  {
    id: 'trk-a1-2',
    libraryId: 'albums',
    albumId: 'alb-a1',
    filePath: '/music/albums/Artist A/First Album/02.mp3',
    ext: '.mp3',
    fileSize: 1000,
    mtimeMs: 100,
    title: 'Second Wind',
    artist: 'Artist A',
    albumArtist: 'Artist A',
    album: 'First Album',
    albumYear: 1995,
    albumTrackCount: 2,
    hasArt: true,
    trackNumber: 2,
    discNumber: 1,
    year: 1995,
    genre: 'Rock',
    durationMs: 20_000,
  },
  // Artist A - Album 2 (1992) - 2 tracks (Earlier release year than Album 1)
  {
    id: 'trk-a2-1',
    libraryId: 'albums',
    albumId: 'alb-a2',
    filePath: '/music/albums/Artist A/Early Days/01.mp3',
    ext: '.mp3',
    fileSize: 1000,
    mtimeMs: 100,
    title: 'Genesis',
    artist: 'Artist A',
    albumArtist: 'Artist A',
    album: 'Early Days',
    albumYear: 1992,
    albumTrackCount: 2,
    hasArt: true,
    trackNumber: 1,
    discNumber: 1,
    year: 1992,
    genre: 'Rock',
    durationMs: 15_000,
  },
  {
    id: 'trk-a2-2',
    libraryId: 'albums',
    albumId: 'alb-a2',
    filePath: '/music/albums/Artist A/Early Days/02.mp3',
    ext: '.mp3',
    fileSize: 1000,
    mtimeMs: 100,
    title: 'Departure',
    artist: 'Artist A',
    albumArtist: 'Artist A',
    album: 'Early Days',
    albumYear: 1992,
    albumTrackCount: 2,
    hasArt: true,
    trackNumber: 2,
    discNumber: 1,
    year: 1992,
    genre: 'Rock',
    durationMs: 25_000,
  },
  // Artist A - Album 3 (1998) - 2 tracks
  {
    id: 'trk-a3-1',
    libraryId: 'albums',
    albumId: 'alb-a3',
    filePath: '/music/albums/Artist A/Late Finale/01.ogg',
    ext: '.ogg',
    fileSize: 1000,
    mtimeMs: 100,
    title: 'Horizon',
    artist: 'Artist A',
    albumArtist: 'Artist A',
    album: 'Late Finale',
    albumYear: 1998,
    albumTrackCount: 2,
    hasArt: false,
    trackNumber: 1,
    discNumber: 1,
    year: 1998,
    genre: 'Indie',
    durationMs: 30_000,
  },
  {
    id: 'trk-a3-2',
    libraryId: 'albums',
    albumId: 'alb-a3',
    filePath: '/music/albums/Artist A/Late Finale/02.ogg',
    ext: '.ogg',
    fileSize: 1000,
    mtimeMs: 100,
    title: 'Curtain Call',
    artist: 'Artist A',
    albumArtist: 'Artist A',
    album: 'Late Finale',
    albumYear: 1998,
    albumTrackCount: 2,
    hasArt: false,
    trackNumber: 2,
    discNumber: 1,
    year: 1998,
    genre: 'Indie',
    durationMs: 20_000,
  },
];

function makeBaseStation(overrides: Partial<StationRecord> = {}): StationRecord {
  return {
    id: 'st-test',
    name: 'Test Station',
    channelNumber: 1,
    enabled: true,
    smartUpdate: true,
    crossfadeEnabled: false,
    crossfadeSeconds: 5,
    playMode: 'straight',
    rules: { artists: ['Artist A'] },
    daypartsEnabled: false,
    dayparts: [],
    tileColor: '#4f46e5',
    customColor: false,
    thumbnailUrl: null,
    category: 'discography',
    seed: 123456,
    epochMs: 1_000_000_000,
    revision: 1,
    createdAt: 1_000_000_000,
    updatedAt: 1_000_000_000,
    ...overrides,
  };
}

describe('Radiarr Phase 2 Deterministic Schedule Engine', () => {
  it('1. Straight play mode sorts albums chronologically by release year and tracks in disc/track order', () => {
    const station = makeBaseStation({ playMode: 'straight' });
    const cycle0 = generateCycleTracks(
      station.seed,
      'base',
      0,
      station.playMode,
      station.rules,
      MOCK_TRACKS
    );

    assert.deepEqual(
      cycle0.map((t) => t.id),
      [
        'trk-a2-1', // 1992 Track 1
        'trk-a2-2', // 1992 Track 2
        'trk-a1-1', // 1995 Track 1
        'trk-a1-2', // 1995 Track 2
        'trk-a3-1', // 1998 Track 1
        'trk-a3-2', // 1998 Track 2
      ]
    );
  });

  it('2. Album shuffle mode randomizes album order deterministically while keeping tracks inside each album in order', () => {
    const station = makeBaseStation({ playMode: 'album_shuffle', seed: 99999 });
    const cycle0 = generateCycleTracks(
      station.seed,
      'base',
      0,
      station.playMode,
      station.rules,
      MOCK_TRACKS
    );

    assert.equal(cycle0.length, 6);

    for (let i = 0; i < 6; i += 2) {
      assert.equal(cycle0[i].albumId, cycle0[i + 1].albumId);
      assert.equal(cycle0[i].trackNumber, 1);
      assert.equal(cycle0[i + 1].trackNumber, 2);
    }

    const cycle0Repeat = generateCycleTracks(
      station.seed,
      'base',
      0,
      station.playMode,
      station.rules,
      MOCK_TRACKS
    );
    assert.deepEqual(
      cycle0.map((t) => t.id),
      cycle0Repeat.map((t) => t.id)
    );
  });

  it('3. Shuffle mode (shuffle bag) plays every eligible track once per cycle without repeats and reshuffles on loop', () => {
    const station = makeBaseStation({ playMode: 'shuffle', seed: 424242 });
    const cycle0 = generateCycleTracks(
      station.seed,
      'base',
      0,
      station.playMode,
      station.rules,
      MOCK_TRACKS
    );
    const cycle1 = generateCycleTracks(
      station.seed,
      'base',
      1,
      station.playMode,
      station.rules,
      MOCK_TRACKS
    );

    assert.equal(new Set(cycle0.map((t) => t.id)).size, 6);
    assert.equal(new Set(cycle1.map((t) => t.id)).size, 6);
    assert.notEqual(cycle0[cycle0.length - 1].id, cycle1[0].id);
  });

  it('4. Looping & point-in-time resolution accurately resolves across multiple cycles and supports negative time-shift offsets', () => {
    const station = makeBaseStation({ playMode: 'straight', epochMs: 1_000_000 });
    const totalCycleMs = 120_000;

    const stateCycle0 = resolveStationAtTime(station, MOCK_TRACKS, 1_000_000 + 18_000);
    assert.ok(stateCycle0);
    assert.equal(stateCycle0.current.track.id, 'trk-a2-2');
    assert.equal(stateCycle0.positionMs, 3_000);
    assert.equal(stateCycle0.current.cycleNumber, 0);
    assert.equal(stateCycle0.previous.track.id, 'trk-a2-1');
    assert.equal(stateCycle0.next.track.id, 'trk-a1-1');

    const stateCycle3 = resolveStationAtTime(
      station,
      MOCK_TRACKS,
      1_000_000 + 3 * totalCycleMs + 18_000
    );
    assert.ok(stateCycle3);
    assert.equal(stateCycle3.current.track.id, 'trk-a2-2');
    assert.equal(stateCycle3.positionMs, 3_000);
    assert.equal(stateCycle3.current.cycleNumber, 3);

    const stateBeforeEpoch = resolveStationAtTime(station, MOCK_TRACKS, 1_000_000 - 5_000);
    assert.ok(stateBeforeEpoch);
    assert.equal(stateBeforeEpoch.current.cycleNumber, -1);
    assert.equal(stateBeforeEpoch.current.track.id, 'trk-a3-2');
    assert.equal(stateBeforeEpoch.positionMs, 15_000);
  });

  it('5. Revision change when rules or play mode are edited regenerates schedule from new epoch and increments revision', () => {
    const initialStation = makeBaseStation({
      playMode: 'straight',
      rules: { artists: ['Artist A'] },
      epochMs: 1_000_000,
      revision: 1,
      seed: 111,
    });

    const editTimeMs = 5_000_000;
    const beforeEdit = resolveStationAtTime(initialStation, MOCK_TRACKS, editTimeMs);
    assert.ok(beforeEdit);

    const updatedRules = { genres: ['Indie'] };
    const updatedTracks = filterTracksByRules(MOCK_TRACKS, updatedRules);
    assert.equal(updatedTracks.length, 2);

    const editedStation: StationRecord = {
      ...initialStation,
      playMode: 'shuffle',
      rules: updatedRules,
      epochMs: editTimeMs,
      revision: initialStation.revision + 1,
      seed: 222,
      updatedAt: editTimeMs,
    };

    assert.equal(editedStation.revision, 2);
    assert.equal(editedStation.epochMs, editTimeMs);

    const afterEdit = resolveStationAtTime(editedStation, updatedTracks, editTimeMs + 4_000);
    assert.ok(afterEdit);
    assert.equal(afterEdit.current.cycleNumber, 0);
    assert.equal(afterEdit.current.indexInCycle, 0);
    assert.equal(afterEdit.positionMs, 4_000);
    assert.ok(['trk-a3-1', 'trk-a3-2'].includes(afterEdit.current.track.id));
  });

  it('6. EPG window resolution returns continuous non-overlapping slots covering [fromMs, toMs]', () => {
    const station = makeBaseStation({ playMode: 'straight', epochMs: 1_000_000 });
    const slots = resolveStationWindow(station, MOCK_TRACKS, 1_010_000, 1_150_000);

    assert.ok(slots.length >= 6);
    assert.ok(slots[0].startMs <= 1_010_000);
    assert.ok(slots[0].endMs > 1_010_000);
    assert.ok(slots[slots.length - 1].endMs >= 1_150_000);

    for (let i = 1; i < slots.length; i++) {
      assert.equal(slots[i].startMs, slots[i - 1].endMs);
    }
  });

  it('7. Crossfade station overlaps eligible track slot transitions by crossfadeSeconds while keeping EPG slots contiguous', () => {
    const station = makeBaseStation({
      playMode: 'straight',
      epochMs: 1_000_000,
      crossfadeEnabled: true,
      crossfadeSeconds: 5,
    });

    // First track in straight order is trk-a2-1 (15,000ms = 3x 5,000ms so not shortened),
    // second track is trk-a2-2 (25,000ms > 15,000ms so slot duration is 25,000 - 5,000 = 20,000ms)
    const state = resolveStationAtTime(station, MOCK_TRACKS, 1_000_000 + 16_000);
    assert.ok(state);
    assert.equal(state.current.track.id, 'trk-a2-2');
    assert.equal(state.current.track.durationMs, 25_000);
    assert.equal(state.current.endMs - state.current.startMs, 20_000);
    assert.equal(state.next.startMs, state.current.endMs);
  });

  it('8. Radio Dayparting (8 PM – 6 AM) prefers quieter/slower tracks overnight while keeping slots contiguous', () => {
    const daypartStation = makeBaseStation({
      id: 'st-daypart',
      playMode: 'shuffle',
      daypartsEnabled: true,
    });

    const mixedTracks: TrackRecord[] = Array.from({ length: 10 }, (_, idx) => ({
      ...MOCK_TRACKS[idx % MOCK_TRACKS.length],
      id: `dp-${idx}`,
      title:
        idx < 5
          ? `Track ${idx + 1} (Acoustic Nocturne)`
          : `Track ${idx + 1} (Club Mix)`,
      bpm: idx < 5 ? 78 : 134,
      energyLevel: (idx < 5 ? 1 : 3) as 1 | 3,
    }));

    // 10:30 PM local time (within 8 PM - 6 AM overnight chill window)
    const nightDate = new Date(2026, 4, 10, 22, 30, 0, 0);
    const nightState = resolveStationAtTime(
      daypartStation,
      mixedTracks,
      nightDate.getTime()
    );
    assert.ok(nightState);
    assert.equal(nightState.current.daypartId, 'night');
    assert.equal(nightState.current.track.energyLevel, 1);

    // 1:15 PM local time (within 6 AM - 8 PM daytime window)
    const dayDate = new Date(2026, 4, 10, 13, 15, 0, 0);
    const dayState = resolveStationAtTime(
      daypartStation,
      mixedTracks,
      dayDate.getTime()
    );
    assert.ok(dayState);
    assert.equal(dayState.current.daypartId, 'day');
    assert.equal(dayState.current.track.energyLevel, 3);
  });

  it('9. Era & Genre filter excludes modern remaster year drift and normalizes genre variants', () => {
    const remastered1970sTrack: TrackRecord = {
      ...MOCK_TRACKS[0],
      id: 'trk-remaster-1975',
      title: 'Bohemian Rhapsody (2019 Remaster)',
      album: 'Greatest Hits (Deluxe Remastered Edition)',
      year: 2019,
      originalYear: null,
      genre: 'Synth-Pop',
    };
    const verified1984ReissueTrack: TrackRecord = {
      ...MOCK_TRACKS[1],
      id: 'trk-verified-1984',
      title: 'Sunset Drive (2020 Anniversary Edition)',
      album: 'Neon Horizon (Deluxe Edition)',
      year: 2020,
      originalYear: 1984,
      genre: 'Synthpop',
    };

    // Unverified 2019 Remaster should NOT pollute a 2010s station
    const matches2010s = filterTracksByRules(
      [remastered1970sTrack, verified1984ReissueTrack],
      { yearMin: 2010, yearMax: 2019 }
    );
    assert.equal(matches2010s.length, 0);

    // Verified 1984 originalYear should match an 1980s station even if reissue year is 2020
    const matches1980s = filterTracksByRules(
      [remastered1970sTrack, verified1984ReissueTrack],
      { yearMin: 1980, yearMax: 1989 }
    );
    assert.equal(matches1980s.length, 1);
    assert.equal(matches1980s[0].id, 'trk-verified-1984');

    // Canonical genre matching unifies "Synth-Pop" and "Synthpop"
    const synthpopMatches = filterTracksByRules(
      [remastered1970sTrack, verified1984ReissueTrack],
      { genres: ['Synthpop'] }
    );
    assert.equal(synthpopMatches.length, 2);
  });
});

