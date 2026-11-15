import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeBatchMovedIds, computeBatchMovedToTarget } from '../shared/stationVisuals.ts';

describe('Batch Station Management & Reordering', () => {
  const original = ['ch-1', 'ch-2', 'ch-3', 'ch-4', 'ch-5'];

  it('moves selected stations to the top preserving their relative order', () => {
    const moved = computeBatchMovedIds(original, ['ch-2', 'ch-4'], 'top');
    assert.deepEqual(moved, ['ch-2', 'ch-4', 'ch-1', 'ch-3', 'ch-5']);
  });

  it('moves selected stations to the bottom preserving their relative order', () => {
    const moved = computeBatchMovedIds(original, ['ch-2', 'ch-4'], 'bottom');
    assert.deepEqual(moved, ['ch-1', 'ch-3', 'ch-5', 'ch-2', 'ch-4']);
  });

  it('shifts selected stations up by one position', () => {
    const moved = computeBatchMovedIds(original, ['ch-3', 'ch-4'], 'up');
    assert.deepEqual(moved, ['ch-1', 'ch-3', 'ch-4', 'ch-2', 'ch-5']);
  });

  it('does not move past top boundary when shifting up', () => {
    const moved = computeBatchMovedIds(original, ['ch-1', 'ch-2'], 'up');
    assert.deepEqual(moved, ['ch-1', 'ch-2', 'ch-3', 'ch-4', 'ch-5']);
  });

  it('shifts selected stations down by one position', () => {
    const moved = computeBatchMovedIds(original, ['ch-2', 'ch-3'], 'down');
    assert.deepEqual(moved, ['ch-1', 'ch-4', 'ch-2', 'ch-3', 'ch-5']);
  });

  it('does not move past bottom boundary when shifting down', () => {
    const moved = computeBatchMovedIds(original, ['ch-4', 'ch-5'], 'down');
    assert.deepEqual(moved, ['ch-1', 'ch-2', 'ch-3', 'ch-4', 'ch-5']);
  });

  it('handles empty selection gracefully', () => {
    const moved = computeBatchMovedIds(original, [], 'up');
    assert.deepEqual(moved, original);
  });

  describe('Batch Drag-and-Drop to Target Position', () => {
    it('drops selected stations before an unselected station', () => {
      const moved = computeBatchMovedToTarget(original, ['ch-2', 'ch-4'], 'ch-1', 'before');
      assert.deepEqual(moved, ['ch-2', 'ch-4', 'ch-1', 'ch-3', 'ch-5']);
    });

    it('drops selected stations after an unselected station', () => {
      const moved = computeBatchMovedToTarget(original, ['ch-2', 'ch-4'], 'ch-5', 'after');
      assert.deepEqual(moved, ['ch-1', 'ch-3', 'ch-5', 'ch-2', 'ch-4']);
    });

    it('inserts selected group in the middle between unselected stations', () => {
      const moved = computeBatchMovedToTarget(original, ['ch-2', 'ch-4'], 'ch-3', 'after');
      assert.deepEqual(moved, ['ch-1', 'ch-3', 'ch-2', 'ch-4', 'ch-5']);
    });

    it('handles single station drag-and-drop identically to single move', () => {
      const moved = computeBatchMovedToTarget(original, ['ch-4'], 'ch-2', 'before');
      assert.deepEqual(moved, ['ch-1', 'ch-4', 'ch-2', 'ch-3', 'ch-5']);
    });

    it('handles drop when target is inside the selected group gracefully', () => {
      const moved = computeBatchMovedToTarget(original, ['ch-2', 'ch-4'], 'ch-2', 'before');
      assert.deepEqual(moved, ['ch-1', 'ch-2', 'ch-4', 'ch-3', 'ch-5']);
    });
  });
});
