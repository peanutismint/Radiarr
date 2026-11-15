import fs from 'node:fs/promises';
import path from 'node:path';
import { SUPPORTED_EXTENSIONS } from '../../shared/types.ts';
import {
  DiscoveredAudioCandidate,
  DiscoveredLibrary,
  LibraryWalkResult,
  MusicSource,
} from './MusicSource.ts';

const SUPPORTED_SET = new Set<string>(SUPPORTED_EXTENSIONS);

export class LocalFolderSource implements MusicSource {
  public readonly sourceType = 'local' as const;
  private readonly rootMusicDir: string;

  constructor(rootMusicDir: string) {
    this.rootMusicDir = rootMusicDir;
  }

  public async discoverLibraries(): Promise<DiscoveredLibrary[]> {
    const libraries: DiscoveredLibrary[] = [];
    try {
      const entries = await fs.readdir(this.rootMusicDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          libraries.push({
            id: entry.name,
            name: entry.name,
            sourceType: 'local',
            path: path.join(this.rootMusicDir, entry.name),
          });
        }
      }
      libraries.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      // If rootMusicDir does not exist yet or is empty, return empty list
    }
    return libraries;
  }

  public async walkLibrary(
    libraryPath: string,
    shouldAbort?: () => boolean
  ): Promise<LibraryWalkResult> {
    const candidates: DiscoveredAudioCandidate[] = [];
    const skippedByExt: Record<string, number> = {};
    const aborted = (): boolean => Boolean(shouldAbort?.());

    const walkDir = async (dirPath: string): Promise<void> => {
      if (aborted()) return;
      let entries;
      try {
        entries = await fs.readdir(dirPath, { withFileTypes: true });
      } catch {
        return;
      }

      const subdirs: string[] = [];
      const audioFiles: Array<{ fullPath: string; ext: string }> = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.')) {
          continue;
        }
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          subdirs.push(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_SET.has(ext)) {
            audioFiles.push({ fullPath, ext });
          } else {
            const key = ext || '(no extension)';
            skippedByExt[key] = (skippedByExt[key] || 0) + 1;
          }
        }
      }

      // Stat audio files concurrently in batches of 32 to avoid sequential SMB latency
      const STAT_CONCURRENCY = 32;
      for (let i = 0; i < audioFiles.length; i += STAT_CONCURRENCY) {
        if (aborted()) return;
        const batch = audioFiles.slice(i, i + STAT_CONCURRENCY);
        await Promise.all(
          batch.map(async ({ fullPath, ext }) => {
            try {
              const stat = await fs.stat(fullPath);
              candidates.push({
                filePath: fullPath,
                ext,
                fileSize: stat.size,
                mtimeMs: Math.floor(stat.mtimeMs),
              });
            } catch {
              // Handled during probe step if inaccessible
            }
          })
        );
      }

      // Walk subdirectories concurrently in batches of 8
      const DIR_CONCURRENCY = 8;
      for (let i = 0; i < subdirs.length; i += DIR_CONCURRENCY) {
        if (aborted()) return;
        const batch = subdirs.slice(i, i + DIR_CONCURRENCY);
        await Promise.all(batch.map((d) => walkDir(d)));
      }
    };

    await walkDir(libraryPath);
    candidates.sort((a, b) => a.filePath.localeCompare(b.filePath));
    return { candidates, skippedByExt };
  }
}
