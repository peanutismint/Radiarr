import assert from 'node:assert';
import { test } from 'node:test';
import { resolveInitialAutoplayStation } from '../shared/stationVisuals.ts';

const mockStations = [
  { id: 'st_1', name: 'Ambient Space', channelNumber: 1 },
  { id: 'st_2', name: 'Synthwave Radio', channelNumber: 2 },
  { id: 'st_3', name: 'Jazz Lounge', channelNumber: 3 },
];

test('Autoplay disabled: primes target station without playing', () => {
  const result = resolveInitialAutoplayStation({
    enabledStations: mockStations,
    autoplayEnabled: false,
    autoplayMode: 'last_station',
    defaultStationId: null,
    lastStationId: null,
  });

  assert.strictEqual(result.shouldAutoPlay, false);
  assert.strictEqual(result.targetStationId, 'st_1');
});

test('Autoplay disabled: respects default station if set', () => {
  const result = resolveInitialAutoplayStation({
    enabledStations: mockStations,
    autoplayEnabled: false,
    autoplayMode: 'last_station',
    defaultStationId: 'st_3',
    lastStationId: 'st_2',
  });

  assert.strictEqual(result.shouldAutoPlay, false);
  assert.strictEqual(result.targetStationId, 'st_3');
});

test('Autoplay enabled: default station mode tunes and auto-plays default station', () => {
  const result = resolveInitialAutoplayStation({
    enabledStations: mockStations,
    autoplayEnabled: true,
    autoplayMode: 'default_station',
    defaultStationId: 'st_2',
    lastStationId: 'st_1',
  });

  assert.strictEqual(result.shouldAutoPlay, true);
  assert.strictEqual(result.targetStationId, 'st_2');
});

test('Autoplay enabled: default station fallback if designated default is removed', () => {
  const result = resolveInitialAutoplayStation({
    enabledStations: mockStations,
    autoplayEnabled: true,
    autoplayMode: 'default_station',
    defaultStationId: 'st_deleted_99',
    lastStationId: 'st_1',
  });

  assert.strictEqual(result.shouldAutoPlay, true);
  assert.strictEqual(result.targetStationId, 'st_1');
});

test('Autoplay enabled: last station mode tunes and auto-plays previous session station', () => {
  const result = resolveInitialAutoplayStation({
    enabledStations: mockStations,
    autoplayEnabled: true,
    autoplayMode: 'last_station',
    defaultStationId: 'st_1',
    lastStationId: 'st_3',
  });

  assert.strictEqual(result.shouldAutoPlay, true);
  assert.strictEqual(result.targetStationId, 'st_3');
});

test('Autoplay enabled: last station fallback if last station is missing', () => {
  const result = resolveInitialAutoplayStation({
    enabledStations: mockStations,
    autoplayEnabled: true,
    autoplayMode: 'last_station',
    defaultStationId: 'st_1',
    lastStationId: null,
  });

  assert.strictEqual(result.shouldAutoPlay, true);
  assert.strictEqual(result.targetStationId, 'st_1');
});

test('Autoplay enabled: random station mode selects valid station and auto-plays', () => {
  const result1 = resolveInitialAutoplayStation({
    enabledStations: mockStations,
    autoplayEnabled: true,
    autoplayMode: 'random_station',
    defaultStationId: 'st_1',
    lastStationId: 'st_1',
    randomSeed: 0.05,
  });
  assert.strictEqual(result1.shouldAutoPlay, true);
  assert.strictEqual(result1.targetStationId, 'st_1');

  const result2 = resolveInitialAutoplayStation({
    enabledStations: mockStations,
    autoplayEnabled: true,
    autoplayMode: 'random_station',
    defaultStationId: 'st_1',
    lastStationId: 'st_1',
    randomSeed: 0.4,
  });
  assert.strictEqual(result2.shouldAutoPlay, true);
  assert.strictEqual(result2.targetStationId, 'st_2');

  const result3 = resolveInitialAutoplayStation({
    enabledStations: mockStations,
    autoplayEnabled: true,
    autoplayMode: 'random_station',
    defaultStationId: 'st_1',
    lastStationId: 'st_1',
    randomSeed: 0.85,
  });
  assert.strictEqual(result3.shouldAutoPlay, true);
  assert.strictEqual(result3.targetStationId, 'st_3');
});

test('Autoplay handles empty stations list gracefully', () => {
  const result = resolveInitialAutoplayStation({
    enabledStations: [],
    autoplayEnabled: true,
    autoplayMode: 'default_station',
    defaultStationId: 'st_1',
    lastStationId: 'st_1',
  });

  assert.strictEqual(result.shouldAutoPlay, false);
  assert.strictEqual(result.targetStationId, '');
});
