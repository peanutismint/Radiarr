import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Simulate the packaged desktop app on a machine whose personal Music folder
// already has things in it (as iTunes / Apple Music create by default).
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'radiarr-desktop-libs-'));
const fakeHome = path.join(tmpRoot, 'home');
const personalMusic = path.join(fakeHome, 'Music');
fs.mkdirSync(path.join(personalMusic, 'iTunes'), { recursive: true });
fs.writeFileSync(path.join(personalMusic, 'iTunes', 'song.mp3'), 'not real audio');

process.env.CONFIG_DIR = path.join(tmpRoot, 'config');
fs.mkdirSync(process.env.CONFIG_DIR, { recursive: true });
delete process.env.MUSIC_DIR;
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
Object.defineProperty(process.versions, 'electron', {
  value: '99.0.0',
  configurable: true,
});

const config = await import('../server/config.ts');
const { initDatabase, db } = await import('../server/db/index.ts');
const { scannerService } = await import('../server/scanner/ScannerService.ts');
const { ensureDemoLibraryIfEmpty } = await import(
  '../server/scanner/SampleLibrarySeeder.ts'
);

initDatabase();

test.after(() => {
  try {
    db.close();
  } catch {
    // ignore
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('desktop app does not adopt the personal Music folder', () => {
  assert.equal(config.AUTO_DISCOVER_LIBRARIES, false);
  assert.ok(
    !path.resolve(config.MUSIC_DIR).startsWith(path.resolve(personalMusic)),
    'the music root is not inside the personal Music folder'
  );
});

test('desktop app starts with no local folders and writes nothing to Music', async () => {
  await ensureDemoLibraryIfEmpty();
  const libraries = await scannerService.syncDiscoveredLibraries();

  assert.deepEqual(libraries, []);
  assert.deepEqual(fs.readdirSync(personalMusic), ['iTunes']);
  assert.equal(fs.existsSync(config.MUSIC_DIR), false);
});

test('a folder auto-added by an older version can be removed and stays removed', async () => {
  // Older desktop builds registered each subfolder of Music under its own name.
  db.prepare(
    `INSERT INTO libraries (id, name, source_type, path, enabled) VALUES (?, ?, 'local', ?, 1)`
  ).run('iTunes', 'iTunes', path.join(personalMusic, 'iTunes'));

  const before = await scannerService.syncDiscoveredLibraries();
  const legacy = before.find((l) => l.id === 'iTunes');
  assert.ok(legacy, 'updating does not silently delete an existing library');
  assert.equal(legacy.removable, true);

  assert.equal(scannerService.removeLibrary('iTunes'), true);
  assert.deepEqual(await scannerService.syncDiscoveredLibraries(), []);
});

test('folders the user adds are kept and removable', async () => {
  const chosen = path.join(tmpRoot, 'nas-share');
  fs.mkdirSync(chosen, { recursive: true });

  const added = scannerService.addCustomLibrary('My Music', chosen);
  assert.equal(added.removable, true);

  const libraries = await scannerService.syncDiscoveredLibraries();
  assert.deepEqual(
    libraries.map((l) => l.path),
    [chosen]
  );
});
