export interface DiscoveredLibrary {
  id: string;
  name: string;
  sourceType: 'local' | 'plex';
  path: string;
}

export interface DiscoveredAudioCandidate {
  filePath: string;
  ext: string;
  fileSize: number;
  mtimeMs: number;
}

export interface LibraryWalkResult {
  candidates: DiscoveredAudioCandidate[];
  skippedByExt: Record<string, number>;
}

/**
 * Clean seam for music sources.
 * LocalFolderSource implements this today for bind-mounted /music/* directories.
 * A future PlexSource can implement this same interface without modifying the scheduler or UI.
 */
export interface MusicSource {
  readonly sourceType: 'local' | 'plex';
  discoverLibraries(): Promise<DiscoveredLibrary[]>;
  /**
   * `shouldAbort` is polled while walking so a long crawl (e.g. a NAS share)
   * can be stopped early. An aborted walk returns a partial result.
   */
  walkLibrary(
    libraryPath: string,
    shouldAbort?: () => boolean
  ): Promise<LibraryWalkResult>;
}
