import { Buffer } from 'buffer';
(globalThis as any).Buffer = Buffer;
(globalThis as any).process = {
  env: { TZ: Intl.DateTimeFormat().resolvedOptions().timeZone, CONFIG_DIR: '/demo/config', MUSIC_DIR: '/demo/music' },
  platform: 'browser',
  versions: {},
  pid: 1,
  cwd: () => '/',
  memoryUsage: () => ({ rss: 0, heapUsed: 0, heapTotal: 0 }),
  uptime: () => performance.now() / 1000,
  on() {},
  nextTick: (fn: () => void) => queueMicrotask(fn),
};
