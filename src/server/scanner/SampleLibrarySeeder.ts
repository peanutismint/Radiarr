import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { AUTO_DISCOVER_LIBRARIES, MUSIC_DIR } from '../config.ts';

const execFileAsync = promisify(execFile);

interface SampleTrackSpec {
  relPath: string;
  freqHz: number;
  durationSec: number;
  codecArgs: string[];
  tags: Record<string, string>;
}

const SAMPLE_TRACKS: SampleTrackSpec[] = [
  // 1. /music/albums — Artist 1: The Midnight Echo (Synthwave, 2 albums, MP3 & FLAC)
  {
    relPath: 'albums/The Midnight Echo/Neon Horizon (1984)/01 - Sunset Drive.mp3',
    freqHz: 261.63,
    durationSec: 18,
    codecArgs: ['-c:a', 'libmp3lame', '-b:a', '128k'],
    tags: {
      title: 'Sunset Drive',
      artist: 'The Midnight Echo',
      album_artist: 'The Midnight Echo',
      album: 'Neon Horizon',
      track: '1',
      disc: '1',
      date: '1984',
      genre: 'Synthwave',
    },
  },
  {
    relPath: 'albums/The Midnight Echo/Neon Horizon (1984)/02 - Electric Rain.mp3',
    freqHz: 329.63,
    durationSec: 21,
    codecArgs: ['-c:a', 'libmp3lame', '-b:a', '128k'],
    tags: {
      title: 'Electric Rain',
      artist: 'The Midnight Echo',
      album_artist: 'The Midnight Echo',
      album: 'Neon Horizon',
      track: '2',
      disc: '1',
      date: '1984',
      genre: 'Synthwave',
    },
  },
  {
    relPath: 'albums/The Midnight Echo/Starlight Velocity (1987)/01 - Hyperion.flac',
    freqHz: 392.0,
    durationSec: 16,
    codecArgs: ['-c:a', 'flac'],
    tags: {
      title: 'Hyperion',
      artist: 'The Midnight Echo',
      album_artist: 'The Midnight Echo',
      album: 'Starlight Velocity',
      track: '1',
      disc: '1',
      date: '1987',
      genre: 'Synthwave',
    },
  },
  {
    relPath: 'albums/The Midnight Echo/Starlight Velocity (1987)/02 - Night Runner.flac',
    freqHz: 440.0,
    durationSec: 19,
    codecArgs: ['-c:a', 'flac'],
    tags: {
      title: 'Night Runner',
      artist: 'The Midnight Echo',
      album_artist: 'The Midnight Echo',
      album: 'Starlight Velocity',
      track: '2',
      disc: '1',
      date: '1987',
      genre: 'Synthwave',
    },
  },

  // 2. /music/albums — Artist 2: Hawthorne Pines (2000s Emo / Indie Rock, OGG & Opus & M4A)
  {
    relPath: 'albums/Hawthorne Pines/autumn letters (2004)/01 - Glass Harbor.ogg',
    freqHz: 293.66,
    durationSec: 17,
    codecArgs: ['-c:a', 'libvorbis', '-q:a', '4'],
    tags: {
      title: 'Glass Harbor',
      artist: 'Hawthorne Pines',
      album_artist: 'Hawthorne Pines',
      album: 'Autumn Letters',
      track: '1',
      disc: '1',
      date: '2004',
      genre: 'Emo',
    },
  },
  {
    relPath: 'albums/Hawthorne Pines/autumn letters (2004)/02 - Paper Satellites.opus',
    freqHz: 349.23,
    durationSec: 20,
    codecArgs: ['-c:a', 'libopus', '-b:a', '96k'],
    tags: {
      title: 'Paper Satellites',
      artist: 'Hawthorne Pines',
      album_artist: 'Hawthorne Pines',
      album: 'Autumn Letters',
      track: '2',
      disc: '1',
      date: '2004',
      genre: 'Emo',
    },
  },
  {
    relPath: 'albums/Hawthorne Pines/Static & Skylines (2006)/01 - Telegraphs.m4a',
    freqHz: 493.88,
    durationSec: 15,
    codecArgs: ['-c:a', 'aac', '-b:a', '128k'],
    tags: {
      title: 'Telegraphs',
      artist: 'Hawthorne Pines',
      album_artist: 'Hawthorne Pines',
      album: 'Static & Skylines',
      track: '1',
      disc: '1',
      date: '2006',
      genre: 'Emo',
    },
  },

  // 3. /music/singles — Assorted formats (WAV, AIFF, WMA) + 1 intentionally untagged MP3
  {
    relPath: 'singles/Solar Drift/Golden Hour.wav',
    freqHz: 523.25,
    durationSec: 14,
    codecArgs: ['-c:a', 'pcm_s16le'],
    tags: {
      title: 'Golden Hour',
      artist: 'Solar Drift',
      album: 'Golden Hour - Single',
      track: '1',
      date: '2016',
      genre: 'Chillwave',
    },
  },
  {
    relPath: 'singles/Solar Drift/Velvet Tide.aiff',
    freqHz: 587.33,
    durationSec: 16,
    codecArgs: ['-c:a', 'pcm_s16be'],
    tags: {
      title: 'Velvet Tide',
      artist: 'Solar Drift',
      album: 'Velvet Tide - Single',
      track: '1',
      date: '2018',
      genre: 'Chillwave',
    },
  },
  {
    relPath: 'singles/Northern Signal/Subzero.wma',
    freqHz: 220.0,
    durationSec: 15,
    codecArgs: ['-c:a', 'wmav2', '-b:a', '128k'],
    tags: {
      title: 'Subzero',
      artist: 'Northern Signal',
      album: 'Polar EP',
      track: '1',
      date: '2001',
      genre: 'Electronic',
    },
  },
  // Intentionally missing tags so the scanner demonstrates folder/filename fallback & "tags incomplete" reporting
  {
    relPath: 'singles/Mystery Cassette/Bootleg Demos/03 - Untitled basement tape.mp3',
    freqHz: 311.13,
    durationSec: 12,
    codecArgs: ['-c:a', 'libmp3lame', '-b:a', '128k'],
    tags: {},
  },
];

/**
 * Only runs if /music has no subdirectories yet (such as in the preview workspace).
 * Generates real playable audio files across formats (.mp3, .flac, .ogg, .opus, .m4a, .wav, .aiff, .wma),
 * folder artwork, non-audio skipped files (.txt, .nfo), and one corrupt file so every scanner feature can be verified immediately.
 */
export async function ensureDemoLibraryIfEmpty(): Promise<void> {
  // The desktop app has no managed music root, so there is nowhere to seed demo files.
  if (!AUTO_DISCOVER_LIBRARIES) {
    return;
  }

  try {
    const entries = await fs.readdir(MUSIC_DIR, { withFileTypes: true });
    const hasSubdirs = entries.some((e) => e.isDirectory() && !e.name.startsWith('.'));
    if (hasSubdirs) {
      return; // User already has libraries mounted
    }
  } catch {
    // Directory doesn't exist yet; proceed to attempt demo structure if writable
  }

  try {
    const albumsDir = path.join(MUSIC_DIR, 'albums');
    const singlesDir = path.join(MUSIC_DIR, 'singles');
    await fs.mkdir(albumsDir, { recursive: true });
    await fs.mkdir(singlesDir, { recursive: true });
  } catch {
    // /music is mounted read-only (:ro) or points to an unmounted host path in Docker;
    // skip demo seeding gracefully so the server starts up normally.
    return;
  }

  for (const spec of SAMPLE_TRACKS) {
    const targetPath = path.join(MUSIC_DIR, spec.relPath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    const metaArgs: string[] = [];
    for (const [k, v] of Object.entries(spec.tags)) {
      metaArgs.push('-metadata', `${k}=${v}`);
    }

    try {
      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-v',
          'quiet',
          '-f',
          'lavfi',
          '-i',
          `sine=frequency=${spec.freqHz}:sample_rate=44100:duration=${spec.durationSec}`,
          '-af',
          'volume=0.15',
          ...spec.codecArgs,
          ...metaArgs,
          targetPath,
        ],
        { timeout: 15000 }
      );
    } catch {
      // Ignore if a specific codec is missing on an unusual host build
    }
  }

  // Generate a folder cover.jpg inside Neon Horizon (1984) so cover art extraction is demonstrated
  try {
    const coverPath = path.join(
      MUSIC_DIR,
      'albums/The Midnight Echo/Neon Horizon (1984)/cover.jpg'
    );
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-v',
        'quiet',
        '-f',
        'lavfi',
        '-i',
        'color=c=0x6366f1:s=400x400',
        '-frames:v',
        '1',
        coverPath,
      ],
      { timeout: 10000 }
    );
  } catch {
    // ignore
  }

  // Add non-audio files so the "Skipped files grouped by extension" report is demonstrated
  await fs.writeFile(
    path.join(MUSIC_DIR, 'albums/The Midnight Echo/Neon Horizon (1984)/notes.txt'),
    'Liner notes for Neon Horizon.\n'
  );
  await fs.writeFile(
    path.join(MUSIC_DIR, 'albums/Hawthorne Pines/autumn letters (2004)/release.nfo'),
    'Catalog #HP-2004\n'
  );
  await fs.writeFile(
    path.join(MUSIC_DIR, 'singles/playlist.m3u8'),
    '#EXTM3U\n'
  );

  // Add 1 unreadable/corrupt audio file so the "Unreadable / Corrupt files" report is demonstrated
  const corruptDir = path.join(MUSIC_DIR, 'singles/Corrupt Test');
  await fs.mkdir(corruptDir, { recursive: true });
  await fs.writeFile(
    path.join(corruptDir, 'damaged_file.mp3'),
    Buffer.from('NOT_A_VALID_AUDIO_STREAM_HEADER_0000')
  );
}
