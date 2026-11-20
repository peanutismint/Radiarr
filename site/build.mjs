// Builds the GitHub Pages site into dist-site/:
//   /        the Radiarr website (this folder)
//   /demo/   the browser-only online demo (built by demo/build.mjs into dist-demo/)
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-site');
const demo = path.join(root, 'dist-demo');

if (!existsSync(demo)) {
  console.error('dist-demo/ not found. Run "npm run demo:build" first.');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
cpSync(path.join(root, 'site'), out, {
  recursive: true,
  filter: (src) => path.basename(src) !== 'build.mjs',
});
cpSync(demo, path.join(out, 'demo'), { recursive: true });
// The site has its own 404 page; GitHub Pages only reads the one at the root anyway.
rmSync(path.join(out, 'demo', '404.html'), { force: true });
console.log('Site built in dist-site/ (demo in dist-site/demo/)');
