import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Point Radiarr at throwaway folders before any server module is loaded.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'radiarr-scan-cancel-'));
process.env.CONFIG_DIR = path.join(tmpRoot, 'config');
process.env.MUSIC_DIR = path.join(tmpRoot, 'music');
fs.mkdirSync(process.env.CONFIG_DIR, { recursive: true });

const TRACK_COUNT = 600;
const libraryDir = path.join(process.env.MUSIC_DIR, 'albums');

/** A tiny but valid 0.1s silent mono WAV, so the scanner imports it as a real track. */
function buildSilentWav(): Buffer {
  const sampleRate = 8000;
  const dataBytes = 800 * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

const wav = buildSilentWav();
for (let i = 0; i < TRACK_COUNT; i += 1) {
  const dir = path.join(libraryDir, `Artist ${i % 20}`, `Album ${i % 60}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `track-${String(i).padStart(4, '0')}.wav`), wav);
}

const { initDatabase, db } = await import('../server/db/index.ts');
const { scannerService } = await import('../server/scanner/ScannerService.ts');

initDatabase();

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

async function waitForScanToEnd(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (scannerService.getProgress().isScanning) {
    if (Date.now() > deadline) throw new Error('Scan did not finish in time');
    await tick();
  }
}

function countTracks(): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM tracks`).get() as { n: number };
  return Number(row.n);
}

test.after(() => {
  try {
    db.close();
  } catch {
    // ignore
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('cancelScan reports nothing to stop when idle', () => {
  const result = scannerService.cancelScan();
  assert.equal(result.cancelling, false);
});

test('stopping mid-import keeps what was imported, and the next scan resumes', async () => {
  const started = await scannerService.triggerScan();
  assert.equal(started.started, true);

  // Let the import get going, then stop it part-way through.
  while (
    scannerService.getProgress().isScanning &&
    scannerService.getProgress().filesProcessed === 0
  ) {
    await tick();
  }
  const cancel = scannerService.cancelScan();
  assert.equal(cancel.cancelling, true);
  assert.equal(scannerService.getProgress().isCancelling, true);

  await waitForScanToEnd();

  const progress = scannerService.getProgress();
  assert.equal(progress.isScanning, false);
  assert.equal(progress.isCancelling, false);

  const partial = countTracks();
  assert.ok(partial > 0, 'tracks imported before the stop are kept');
  assert.ok(partial < TRACK_COUNT, 'the scan really stopped early');

  const run = scannerService.getLatestScanRun();
  assert.equal(run?.status, 'cancelled');
  assert.equal(run?.tracksTotal, partial);
  assert.ok(run?.finishedAt, 'the stopped run is closed off');

  const lib = scannerService.getLibraries().find((l) => l.id === 'albums');
  assert.equal(lib?.lastScannedAt, null, 'a stopped library is not marked as scanned');

  // The next scan picks up the rest.
  await scannerService.triggerScan();
  await waitForScanToEnd();
  assert.equal(countTracks(), TRACK_COUNT);
  assert.equal(scannerService.getLatestScanRun()?.status, 'completed');
});

test('stopping a rescan never removes tracks that are already imported', async () => {
  assert.equal(countTracks(), TRACK_COUNT);

  // Stop immediately, while the scanner is still crawling folders. An
  // incomplete crawl must not be mistaken for "these files were deleted".
  await scannerService.triggerScan();
  scannerService.cancelScan();
  await waitForScanToEnd();

  assert.equal(scannerService.getLatestScanRun()?.status, 'cancelled');
  assert.equal(countTracks(), TRACK_COUNT);

  // A new scan can start straight away afterwards.
  const again = await scannerService.triggerScan();
  assert.equal(again.started, true);
  await waitForScanToEnd();
  assert.equal(scannerService.getLatestScanRun()?.status, 'completed');
  assert.equal(countTracks(), TRACK_COUNT);
});
