import assert from 'node:assert/strict';
import test from 'node:test';
import { pickNextShuffleStation, type StationItem } from '../client/utils/stationShuffle.ts';

test('pickNextShuffleStation: handles empty or single station lists', () => {
  const empty = pickNextShuffleStation([], null, []);
  assert.equal(empty.nextStation, null);
  assert.equal(empty.nextStationId, null);

  const single = [{ id: 'stn-1', name: 'Rock' }];
  const result1 = pickNextShuffleStation(single, 'stn-1', []);
  assert.equal(result1.nextStationId, 'stn-1');
  assert.equal(result1.updatedQueue.length, 0);
});

test('pickNextShuffleStation: never chooses current station when multiple stations exist', () => {
  const stations = [
    { id: 'stn-1', name: 'Rock' },
    { id: 'stn-2', name: 'Jazz' },
    { id: 'stn-3', name: 'Pop' },
  ];

  for (let i = 0; i < 30; i++) {
    const { nextStationId } = pickNextShuffleStation(stations, 'stn-1', []);
    assert.notEqual(nextStationId, 'stn-1');
    assert.ok(nextStationId === 'stn-2' || nextStationId === 'stn-3');
  }
});

interface TestStation {
  id: string;
  name: string;
}

test('pickNextShuffleStation: cycles through all candidates before repeating', () => {
  const stations: TestStation[] = [
    { id: 'stn-1', name: 'Station 1' },
    { id: 'stn-2', name: 'Station 2' },
    { id: 'stn-3', name: 'Station 3' },
    { id: 'stn-4', name: 'Station 4' },
    { id: 'stn-5', name: 'Station 5' },
  ];

  let currentId: string | null = 'stn-1';
  let queue: string[] = [];
  const visited = new Set<string>();

  // Pick 4 times: since there are 4 other stations, all 4 must be visited uniquely
  for (let step = 0; step < 4; step++) {
    const res: { nextStation: TestStation | null; nextStationId: string | null; updatedQueue: string[] } =
      pickNextShuffleStation(stations, currentId, queue);
    assert.ok(res.nextStationId);
    assert.notEqual(res.nextStationId, 'stn-1');
    assert.equal(visited.has(res.nextStationId!), false, `Station ${res.nextStationId} repeated within cycle`);
    visited.add(res.nextStationId!);
    currentId = res.nextStationId;
    queue = res.updatedQueue;
  }

  assert.equal(visited.size, 4);
  assert.equal(queue.length, 0);
});

test('pickNextShuffleStation: prunes disabled stations from queue', () => {
  const stations = [
    { id: 'stn-1', name: 'Station 1' },
    { id: 'stn-2', name: 'Station 2' },
  ];
  // Queue contains an old station 'stn-999' that was deleted or disabled
  const res = pickNextShuffleStation(stations, 'stn-1', ['stn-999']);
  assert.equal(res.nextStationId, 'stn-2');
  assert.equal(res.updatedQueue.includes('stn-999'), false);
});
