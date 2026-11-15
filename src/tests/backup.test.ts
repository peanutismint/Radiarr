import assert from 'node:assert/strict';
import test from 'node:test';
import { initDatabase } from '../server/db/index.ts';
import {
  computeIntervalMs,
  createBackupPayload,
  deleteStoredBackup,
  getAutoBackupConfig,
  listStoredBackups,
  saveAutoBackupConfig,
  saveBackupToFile,
} from '../server/services/BackupService.ts';

initDatabase();

test('BackupService: interval math and configuration', () => {
  assert.equal(computeIntervalMs(15, 'minutes'), 15 * 60 * 1000);
  assert.equal(computeIntervalMs(6, 'hours'), 6 * 60 * 60 * 1000);
  assert.equal(computeIntervalMs(2, 'days'), 2 * 24 * 60 * 60 * 1000);

  // Save auto backup configuration
  const saved = saveAutoBackupConfig({
    enabled: true,
    intervalValue: 12,
    intervalUnit: 'hours',
    maxBackupsToKeep: 7,
  });

  assert.equal(saved.enabled, true);
  assert.equal(saved.intervalValue, 12);
  assert.equal(saved.intervalUnit, 'hours');
  assert.equal(saved.maxBackupsToKeep, 7);
  assert.ok(typeof saved.nextBackupAt === 'number');

  const loaded = getAutoBackupConfig();
  assert.equal(loaded.enabled, true);
  assert.equal(loaded.intervalValue, 12);
  assert.equal(loaded.intervalUnit, 'hours');
  assert.equal(loaded.maxBackupsToKeep, 7);
});

test('BackupService: payload creation, file storage, listing, and deletion', () => {
  const payload = createBackupPayload();
  assert.equal(payload.app, 'radiarr');
  assert.equal(payload.backupVersion, 1);
  assert.ok(payload.counts);
  assert.ok(Array.isArray(payload.data.stations));

  // Save manual snapshot
  const item = saveBackupToFile(false);
  assert.ok(item.filename.startsWith('radiarr-backup-'));
  assert.ok(item.sizeBytes > 0);

  // List stored backups
  const list = listStoredBackups();
  assert.ok(list.length >= 1);
  const found = list.find((b) => b.filename === item.filename);
  assert.ok(found);
  assert.equal(found.isAuto, false);

  // Delete stored backup
  deleteStoredBackup(item.filename);
  const listAfter = listStoredBackups();
  assert.ok(!listAfter.some((b) => b.filename === item.filename));
});
