import fs from 'node:fs';
import path from 'node:path';

const isDockerRootWritable = (dirPath: string): boolean => {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const resolveConfigDir = (): string => {
  if (process.env.CONFIG_DIR) {
    return process.env.CONFIG_DIR;
  }
  if (isDockerRootWritable('/config')) {
    return '/config';
  }

  // Native desktop app data directories
  if (process.platform === 'win32') {
    const base =
      process.env.APPDATA ||
      (process.env.USERPROFILE
        ? path.join(process.env.USERPROFILE, 'AppData', 'Roaming')
        : null);
    if (base) {
      const dir = path.join(base, 'Radiarr');
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
  } else if (process.platform === 'darwin') {
    const home = process.env.HOME;
    if (home) {
      const dir = path.join(home, 'Library', 'Application Support', 'Radiarr');
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
  } else if (process.platform === 'linux' && !fs.existsSync('/.dockerenv')) {
    const xdg = process.env.XDG_CONFIG_HOME;
    const home = process.env.HOME;
    const dir = xdg
      ? path.join(xdg, 'radiarr')
      : home
        ? path.join(home, '.config', 'radiarr')
        : null;
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
  }

  const fallback = path.resolve(process.cwd(), 'data', 'config');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
};

interface MusicRoot {
  dir: string;
  /**
   * True when Radiarr owns a dedicated music root (Docker's /music, an explicit
   * MUSIC_DIR, or ./data/music in development). Only then are its immediate
   * subfolders auto-registered as libraries and demo files seeded into it.
   */
  autoDiscover: boolean;
}

const resolveMusicRoot = (configDir: string): MusicRoot => {
  if (process.env.MUSIC_DIR) {
    return { dir: process.env.MUSIC_DIR, autoDiscover: true };
  }

  // Desktop app: never guess at a music folder (it used to pick the user's
  // personal Music folder and register everything inside it, e.g. "iTunes").
  // Libraries are only ever the folders the user adds themselves. The directory
  // below is an app-private placeholder and is not created or scanned.
  if (process.versions.electron) {
    return { dir: path.join(configDir, 'music'), autoDiscover: false };
  }

  try {
    if (fs.existsSync('/music')) {
      return { dir: '/music', autoDiscover: true };
    }
  } catch {
    // ignore
  }

  const fallback = path.resolve(process.cwd(), 'data', 'music');
  fs.mkdirSync(fallback, { recursive: true });
  return { dir: fallback, autoDiscover: true };
};

export const CONFIG_DIR = resolveConfigDir();
const musicRoot = resolveMusicRoot(CONFIG_DIR);
export const MUSIC_DIR = musicRoot.dir;
export const AUTO_DISCOVER_LIBRARIES = musicRoot.autoDiscover;
export const DB_PATH = path.join(CONFIG_DIR, 'radiarr.db');
export const ART_CACHE_DIR = path.join(CONFIG_DIR, 'art-cache');
export const TRANSCODE_CACHE_DIR = path.join(CONFIG_DIR, 'transcode-cache');
export const BACKUPS_DIR = path.join(CONFIG_DIR, 'backups');

export const SERVER_TZ = process.env.TZ || 'UTC';
export const TRANSCODE_BITRATE_KBPS = Number(process.env.TRANSCODE_BITRATE_KBPS) || 192;
export const TRANSCODE_CACHE_MAX_MB = Number(process.env.TRANSCODE_CACHE_MAX_MB) || 2048;
export const STREAM_BITRATE_KBPS = Number(process.env.STREAM_BITRATE_KBPS) || 192;

// Ensure required subdirectories exist inside /config
fs.mkdirSync(ART_CACHE_DIR, { recursive: true });
fs.mkdirSync(TRANSCODE_CACHE_DIR, { recursive: true });
fs.mkdirSync(BACKUPS_DIR, { recursive: true });
