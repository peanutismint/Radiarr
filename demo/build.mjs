// Builds the browser demo into dist-demo/:
//   1. the normal web UI, in demo mode, with relative paths so it works from any folder (e.g. GitHub Pages)
//   2. the service worker that stands in for the server
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-demo');
const shim = (f) => path.join(root, 'demo/shims', f);

execSync('npx vite build --mode demo --base ./ --outDir dist-demo --emptyOutDir', {
  cwd: root,
  stdio: 'inherit',
});

await build({
  entryPoints: [path.join(root, 'demo/sw.ts')],
  outfile: path.join(out, 'sw.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  minify: process.env.DEMO_DEBUG ? false : true,
  sourcemap: false,
  legalComments: 'none',
  alias: {
    express: shim('express.ts'),
    'node:sqlite': shim('sqlite.ts'),
    'node:fs': shim('fs.ts'),
    fs: shim('fs.ts'),
    'node:fs/promises': shim('fs-promises.ts'),
    'node:child_process': shim('child_process.ts'),
    'node:crypto': shim('crypto.ts'),
    crypto: shim('empty.ts'),
    'node:util': shim('util.ts'),
    'node:stream': shim('stream.ts'),
    'node:stream/web': shim('stream.ts'),
    'node:path': 'path-browserify',
    path: 'path-browserify',
    'music-metadata': shim('empty.ts'),
  },
  logLevel: 'warning',
});

mkdirSync(out, { recursive: true });
copyFileSync(path.join(root, 'node_modules/sql.js/dist/sql-wasm-browser.wasm'), path.join(out, 'sql-wasm.wasm'));
// GitHub Pages: serve files as-is and show the app for unknown paths.
writeFileSync(path.join(out, '.nojekyll'), '');
copyFileSync(path.join(out, 'index.html'), path.join(out, '404.html'));
console.log('Demo built in dist-demo/');
