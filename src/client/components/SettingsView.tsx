import {
  Activity,
  AlertTriangle,
  ArchiveRestore,
  Cast,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Disc,
  Download,
  ExternalLink,
  FileWarning,
  FolderOpen,
  FolderPlus,
  HardDrive,
  LayoutGrid,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Server,
  Shield,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Square,
  Star,
  Sun,
  Trash2,
  Upload,
  Volume2,
  X,
  Database,
  Save,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AutoBackupConfig,
  AutoBackupUnit,
  PlexConfig,
  PlexRemoteSection,
  PlexServerDevice,
  RescanIntervalMinutes,
  ScanResultsOverview,
  ServerSettings,
  StationWithStats,
  StoredBackupItem,
} from '../../shared/types.ts';
import { useAppearance } from '../hooks/useAppearance.ts';
import { useTheme } from '../hooks/useTheme.ts';
import { useGoogleCast } from '../hooks/useGoogleCast.ts';
import { ChannelBadge } from './ChannelBadge.tsx';
import { UsersManagementTab } from './UsersManagementTab.tsx';
import { DiagnosticsTab } from './DiagnosticsTab.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { apiFetch } from '../utils/apiInterceptor.ts';

type SettingsSubTab = 'sources' | 'appearance' | 'integrations' | 'backup' | 'users' | 'diagnostics';

interface SettingsViewProps {
  overview: ScanResultsOverview | null;
  settings: ServerSettings | null;
  onUpdateSettings: (patch: Partial<ServerSettings>) => Promise<void>;
  onAddLibrary: (name: string, path: string) => Promise<void>;
  onRemoveLibrary: (libraryId: string) => Promise<void>;
  onTriggerScan: (libraryId?: string) => Promise<void>;
  onCancelScan: () => Promise<void>;
  onStationsChanged?: () => void;
  onBackupRestored?: () => Promise<void> | void;
  stations?: StationWithStats[];
}

function formatTimestamp(ms: number | null): string {
  if (!ms) return 'Never';
  return new Date(ms).toLocaleString();
}

export function SettingsView({
  overview,
  settings,
  onUpdateSettings,
  onAddLibrary,
  onRemoveLibrary,
  onTriggerScan,
  onCancelScan,
  onBackupRestored,
  stations,
}: SettingsViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<SettingsSubTab>('sources');
  const { appearance, updateAppearance, resetAppearance } = useAppearance();
  const { theme, setTheme } = useTheme();

  const defaultStation =
    stations?.find((s) => s.id === appearance.defaultStationId) || null;

  const progress = overview?.progress;
  const latestRun = overview?.latestRun;
  const libraries = overview?.libraries || [];
  const skippedEntries = latestRun ? Object.entries(latestRun.skippedByExt) : [];
  const totalSkipped = skippedEntries.reduce((acc, [, c]) => acc + c, 0);

  // Smart Home & Google Cast Integration states
  const googleCast = useGoogleCast();
  const [selectedIntegrationStationId, setSelectedIntegrationStationId] = useState<string>('');
  const [copiedYaml, setCopiedYaml] = useState<boolean>(false);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);
  const [isTestingAudio, setIsTestingAudio] = useState<boolean>(false);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);

  // Add Media Folder state & Music Libraries Tab state ('plex' | 'local')
  const [libraryTab, setLibraryTab] = useState<'plex' | 'local'>('plex');
  const [showAddMedia, setShowAddMedia] = useState(false);
  const [newLibName, setNewLibName] = useState('');
  const [newLibPath, setNewLibPath] = useState('');
  const [addMediaError, setAddMediaError] = useState<string | null>(null);
  const [isAddingMedia, setIsAddingMedia] = useState(false);

  // Desktop App detection and native folder picker
  const [isDesktopApp, setIsDesktopApp] = useState(false);
  const [desktopPlatform, setDesktopPlatform] = useState<string | null>(null);
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [showDesktopInfoModal, setShowDesktopInfoModal] = useState(false);

  // macOS desktop app: show Radiarr in the menu bar, the Dock, or both
  type DockMode = 'menubar' | 'dock' | 'both';
  const [dockMode, setDockModeState] = useState<DockMode | null>(null);
  const [isSavingDockMode, setIsSavingDockMode] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.radiarrDesktop?.isDesktop) {
      setIsDesktopApp(true);
      setDesktopPlatform(window.radiarrDesktop.platform || 'desktop');
      if (window.radiarrDesktop.getDockMode) {
        window.radiarrDesktop
          .getDockMode()
          .then((mode) => setDockModeState(mode))
          .catch(() => setDockModeState(null));
      }
    }
  }, []);

  const handleDockModeChange = async (mode: DockMode) => {
    if (!window.radiarrDesktop?.setDockMode || mode === dockMode) return;
    setIsSavingDockMode(true);
    try {
      const applied = await window.radiarrDesktop.setDockMode(mode);
      setDockModeState(applied);
    } finally {
      setIsSavingDockMode(false);
    }
  };

  const handleBrowseNativeFolder = async () => {
    if (window.radiarrDesktop?.pickFolder) {
      setIsPickingFolder(true);
      setAddMediaError(null);
      try {
        const selected = await window.radiarrDesktop.pickFolder();
        if (selected) {
          setNewLibPath(selected);
          if (!newLibName.trim()) {
            const folderName = selected.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
            if (folderName) setNewLibName(folderName);
          }
        }
      } catch (e) {
        console.warn('Native folder selection failed:', e);
      } finally {
        setIsPickingFolder(false);
      }
    } else {
      setShowDesktopInfoModal(true);
    }
  };


  // Plex Integration state
  const [plexConnected, setPlexConnected] = useState(false);
  const [plexConfig, setPlexConfig] = useState<PlexConfig | null>(null);
  const [plexServers, setPlexServers] = useState<PlexServerDevice[]>([]);
  const [plexSections, setPlexSections] = useState<PlexRemoteSection[]>([]);
  const [plexServerError, setPlexServerError] = useState<string | null>(null);
  const [plexLoading, setPlexLoading] = useState(false);
  const [plexAuthPending, setPlexAuthPending] = useState(false);
  const [plexAuthUrl, setPlexAuthUrl] = useState<string | null>(null);
  const [customPlexUri, setCustomPlexUri] = useState('');
  const plexPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const localLibraries = libraries.filter((l) => l.sourceType === 'local');
  const plexLibraries = libraries.filter((l) => l.sourceType === 'plex');

  const loadPlexStatus = useCallback(async () => {
    setPlexLoading(true);
    try {
      const res = await apiFetch('/api/plex/status');
      if (!res.ok) return;
      const data = (await res.json()) as {
        connected: boolean;
        plexConfig: PlexConfig | null;
        servers: PlexServerDevice[];
        sections: PlexRemoteSection[];
        serverError?: string | null;
      };
      setPlexConnected(data.connected);
      setPlexConfig(data.plexConfig);
      setPlexServers(data.servers || []);
      setPlexSections(data.sections || []);
      setPlexServerError(data.serverError || null);
      if (data.plexConfig?.serverUri) {
        setCustomPlexUri(data.plexConfig.serverUri);
      }
    } catch {
      // ignore
    } finally {
      setPlexLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlexStatus();
  }, [loadPlexStatus]);

  useEffect(() => {
    return () => {
      if (plexPollTimerRef.current) {
        clearInterval(plexPollTimerRef.current);
      }
    };
  }, []);

  // Listen for OAUTH_AUTH_SUCCESS postMessage from Plex popup callback
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        void loadPlexStatus();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [loadPlexStatus]);

  const handleConnectPlex = async () => {
    setPlexServerError(null);
    setPlexAuthPending(true);
    try {
      const forwardUrl = `${window.location.origin}/api/plex/auth/callback`;
      const res = await apiFetch('/api/plex/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forwardUrl }),
      });
      if (!res.ok) {
        throw new Error('Failed to create Plex authentication link');
      }
      const { pinId, code, authUrl } = (await res.json()) as {
        pinId: number;
        code: string;
        authUrl: string;
      };
      setPlexAuthUrl(authUrl);

      // Open Plex's official web auth URL directly (no 4-digit PIN entry required)
      window.open(authUrl, 'plex_oauth_popup', 'width=640,height=720');

      if (plexPollTimerRef.current) {
        clearInterval(plexPollTimerRef.current);
      }

      let attempts = 0;
      plexPollTimerRef.current = setInterval(async () => {
        attempts += 1;
        if (attempts > 120) {
          if (plexPollTimerRef.current) clearInterval(plexPollTimerRef.current);
          setPlexAuthPending(false);
          return;
        }
        try {
          const checkRes = await apiFetch(
            `/api/plex/auth/pin/${encodeURIComponent(String(pinId))}?code=${encodeURIComponent(code)}`
          );
          if (!checkRes.ok) return;
          const checkData = (await checkRes.json()) as {
            authenticated: boolean;
          };
          if (checkData.authenticated) {
            if (plexPollTimerRef.current) {
              clearInterval(plexPollTimerRef.current);
            }
            setPlexAuthPending(false);
            setPlexAuthUrl(null);
            await loadPlexStatus();
          }
        } catch {
          // ignore transient poll error
        }
      }, 1500);
    } catch (err) {
      setPlexAuthPending(false);
      setPlexServerError(
        err instanceof Error ? err.message : 'Failed to connect to Plex'
      );
    }
  };

  const handleSelectPlexServer = async (
    clientIdentifier?: string,
    overrideUri?: string
  ) => {
    setPlexLoading(true);
    setPlexServerError(null);
    try {
      const res = await apiFetch('/api/plex/server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientIdentifier,
          customUri: overrideUri,
        }),
      });
      const data = (await res.json()) as {
        plexConfig?: PlexConfig;
        sections?: PlexRemoteSection[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to connect to Plex server');
      }
      if (data.plexConfig) {
        setPlexConfig(data.plexConfig);
        setCustomPlexUri(data.plexConfig.serverUri || '');
      }
      setPlexSections(data.sections || []);
    } catch (err) {
      setPlexServerError(
        err instanceof Error ? err.message : 'Could not reach Plex server'
      );
    } finally {
      setPlexLoading(false);
    }
  };

  const handleTogglePlexSection = async (section: PlexRemoteSection) => {
    if (section.connectedLibraryId) {
      await onRemoveLibrary(section.connectedLibraryId);
      await loadPlexStatus();
    } else {
      const res = await apiFetch('/api/plex/libraries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionKey: section.key,
          title: section.title,
        }),
      });
      if (res.ok) {
        await loadPlexStatus();
        if (onBackupRestored) {
          await onBackupRestored();
        }
      }
    }
  };

  const handleDisconnectPlex = async () => {
    await apiFetch('/api/plex/disconnect', { method: 'POST' });
    setPlexConnected(false);
    setPlexConfig(null);
    setPlexServers([]);
    setPlexSections([]);
  };

  // Backup & Restore state
  const [isDraggingBackup, setIsDraggingBackup] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [backupMessage, setBackupMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const backupFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleCreateMediaLibrary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLibPath.trim()) {
      setAddMediaError('Please enter a folder path.');
      return;
    }
    setIsAddingMedia(true);
    setAddMediaError(null);
    try {
      await onAddLibrary(newLibName.trim(), newLibPath.trim());
      setNewLibName('');
      setNewLibPath('');
      setShowAddMedia(false);
    } catch (err) {
      setAddMediaError(
        err instanceof Error ? err.message : 'Failed to add media folder'
      );
    } finally {
      setIsAddingMedia(false);
    }
  };

  const handleRestoreFile = async (file: File | undefined | null) => {
    if (!file) return;
    setIsRestoring(true);
    setBackupMessage(null);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      const res = await apiFetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });

      const data = (await res.json()) as {
        restored?: boolean;
        error?: string;
        counts?: {
          libraries: number;
          albums: number;
          tracks: number;
          stations: number;
        };
      };

      if (!res.ok || !data.restored) {
        throw new Error(data.error || 'Failed to restore backup');
      }

      setBackupMessage({
        ok: true,
        text: `Restored ${data.counts?.stations ?? 0} stations, ${data.counts?.tracks ?? 0} tracks, and ${data.counts?.albums ?? 0} albums from "${file.name}".`,
      });

      if (onBackupRestored) {
        await onBackupRestored();
      }
    } catch (err) {
      setBackupMessage({
        ok: false,
        text:
          err instanceof Error
            ? `Restore failed: ${err.message}`
            : 'Restore failed: Invalid backup file',
      });
    } finally {
      setIsRestoring(false);
      if (backupFileInputRef.current) {
        backupFileInputRef.current.value = '';
      }
    }
  };

  // Auto Backup & Stored Backups state
  const [autoBackupConfig, setAutoBackupConfig] = useState<AutoBackupConfig | null>(null);
  const [storedBackups, setStoredBackups] = useState<StoredBackupItem[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [isSavingAutoConfig, setIsSavingAutoConfig] = useState(false);
  const [isCreatingBackupNow, setIsCreatingBackupNow] = useState(false);
  const [autoConfigMessage, setAutoConfigMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmRestoreItem, setConfirmRestoreItem] = useState<StoredBackupItem | null>(null);
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<StoredBackupItem | null>(null);

  // Form draft for auto backup settings
  const [draftAutoEnabled, setDraftAutoEnabled] = useState(false);
  const [draftIntervalValue, setDraftIntervalValue] = useState(6);
  const [draftIntervalUnit, setDraftIntervalUnit] = useState<AutoBackupUnit>('hours');
  const [draftMaxBackups, setDraftMaxBackups] = useState(5);

  const fetchBackupData = useCallback(async () => {
    setIsLoadingBackups(true);
    try {
      const [cfgRes, listRes] = await Promise.all([
        apiFetch('/api/backup/auto-config'),
        apiFetch('/api/backup/stored'),
      ]);
      if (cfgRes.ok) {
        const cfgData = await cfgRes.json();
        if (cfgData.config) {
          setAutoBackupConfig(cfgData.config);
          setDraftAutoEnabled(cfgData.config.enabled);
          setDraftIntervalValue(cfgData.config.intervalValue);
          setDraftIntervalUnit(cfgData.config.intervalUnit);
          setDraftMaxBackups(cfgData.config.maxBackupsToKeep);
        }
      }
      if (listRes.ok) {
        const listData = await listRes.json();
        if (Array.isArray(listData.backups)) {
          setStoredBackups(listData.backups);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch backup info:', e);
    } finally {
      setIsLoadingBackups(false);
    }
  }, []);

  useEffect(() => {
    if (activeSubTab === 'backup') {
      void fetchBackupData();
    }
  }, [activeSubTab, fetchBackupData]);

  const handleSaveAutoBackupConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSavingAutoConfig(true);
    setAutoConfigMessage(null);
    try {
      const res = await apiFetch('/api/backup/auto-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: draftAutoEnabled,
          intervalValue: draftIntervalValue,
          intervalUnit: draftIntervalUnit,
          maxBackupsToKeep: draftMaxBackups,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.config) {
        throw new Error(data.error || 'Failed to update auto-backup schedule');
      }
      setAutoBackupConfig(data.config);
      setAutoConfigMessage({
        ok: true,
        text: draftAutoEnabled
          ? `Auto-backup enabled: saving every ${draftIntervalValue} ${draftIntervalUnit} (keeping up to ${draftMaxBackups} backups).`
          : 'Auto-backup disabled.',
      });
    } catch (err) {
      setAutoConfigMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to save auto-backup settings',
      });
    } finally {
      setIsSavingAutoConfig(false);
    }
  };

  const handleCreateBackupNow = async () => {
    setIsCreatingBackupNow(true);
    setBackupMessage(null);
    try {
      const res = await apiFetch('/api/backup/create-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || !data.backup) {
        throw new Error(data.error || 'Failed to create backup');
      }
      setBackupMessage({
        ok: true,
        text: `Created server backup "${data.backup.filename}".`,
      });
      await fetchBackupData();
    } catch (err) {
      setBackupMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to create snapshot backup',
      });
    } finally {
      setIsCreatingBackupNow(false);
    }
  };

  const handleRestoreStoredFile = async (item: StoredBackupItem) => {
    setIsRestoring(true);
    setBackupMessage(null);
    setConfirmRestoreItem(null);
    try {
      const res = await apiFetch(
        `/api/backup/restore-stored/${encodeURIComponent(item.filename)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );
      const data = await res.json();
      if (!res.ok || !data.restored) {
        throw new Error(data.error || 'Failed to restore stored backup');
      }
      setBackupMessage({
        ok: true,
        text: `Restored backup "${item.filename}" (${data.counts?.stations ?? 0} stations, ${data.counts?.tracks ?? 0} tracks).`,
      });
      if (onBackupRestored) {
        await onBackupRestored();
      }
      await fetchBackupData();
    } catch (err) {
      setBackupMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to restore stored backup',
      });
    } finally {
      setIsRestoring(false);
    }
  };

  const handleDeleteStoredFile = async (item: StoredBackupItem) => {
    setConfirmDeleteItem(null);
    try {
      const res = await apiFetch(
        `/api/backup/stored/${encodeURIComponent(item.filename)}`,
        {
          method: 'DELETE',
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete stored backup');
      }
      setBackupMessage({
        ok: true,
        text: `Deleted backup "${item.filename}".`,
      });
      await fetchBackupData();
    } catch (err) {
      setBackupMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to delete backup',
      });
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Settings Header & Horizontal Sub-Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Settings
          </h1>
        </div>

        <div
          role="tablist"
          aria-label="Settings sections"
          className="inline-flex items-center gap-1 p-1 rounded-xl bg-zinc-200/70 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 self-start sm:self-auto"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'sources'}
            onClick={() => setActiveSubTab('sources')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap ${
              activeSubTab === 'sources'
                ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Sources ({libraries.length})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'appearance'}
            onClick={() => setActiveSubTab('appearance')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap ${
              activeSubTab === 'appearance'
                ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Palette className="w-3.5 h-3.5" />
            <span>Appearance</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'integrations'}
            onClick={() => setActiveSubTab('integrations')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap ${
              activeSubTab === 'integrations'
                ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Cast className="w-3.5 h-3.5" />
            <span>Smart Home &amp; Cast</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'backup'}
            onClick={() => setActiveSubTab('backup')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap ${
              activeSubTab === 'backup'
                ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <ArchiveRestore className="w-3.5 h-3.5" />
            <span>Backup &amp; Restore</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'users'}
            onClick={() => setActiveSubTab('users')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap ${
              activeSubTab === 'users'
                ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Users &amp; Security</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'diagnostics'}
            onClick={() => setActiveSubTab('diagnostics')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap ${
              activeSubTab === 'diagnostics'
                ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Diagnostics &amp; Logs</span>
          </button>
        </div>
      </div>

      {/* SUB-TAB 2: Appearance (Theme, Clock Format, EPG Guide Density, Now Playing Stage, Channel Badges) */}
      {activeSubTab === 'appearance' && (
        <div className="space-y-4">
          {/* macOS desktop app only: menu bar / Dock placement */}
          {dockMode && (
            <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm space-y-4">
              <div>
                <div className="flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-indigo-500" />
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Show Radiarr In
                  </h2>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Choose where Radiarr appears on your Mac. You can also change this from the Radiarr menu bar icon.
                </p>
              </div>
              <div
                role="radiogroup"
                aria-label="Show Radiarr in"
                className="inline-flex flex-wrap items-center gap-1 bg-zinc-100 dark:bg-zinc-800/80 p-1 rounded-xl"
              >
                {(
                  [
                    { value: 'menubar', label: 'Menu Bar' },
                    { value: 'dock', label: 'Dock' },
                    { value: 'both', label: 'Both' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={dockMode === opt.value}
                    disabled={isSavingDockMode}
                    onClick={() => void handleDockModeChange(opt.value)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap disabled:opacity-60 ${
                      dockMode === opt.value
                        ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {dockMode === 'dock' && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Closing the window keeps Radiarr playing. Click its Dock icon to reopen it, or right-click the Dock icon and choose Quit to stop it.
                </p>
              )}
            </section>
          )}

          {/* Section 1: Theme & Broadcast Clock Format */}
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-500" />
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Theme &amp; Broadcast Clock Format
                  </h2>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Configure interface color mode and how wall-clock times appear on the EPG ruler and player.
                </p>
              </div>
              <button
                type="button"
                onClick={resetAppearance}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-800 bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-800/70 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition cursor-pointer"
                title="Reset all appearance settings to defaults"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Defaults</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
              {/* Theme Mode */}
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Color Theme
                </span>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800">
                  {(
                    [
                      { id: 'light', label: 'Light', icon: Sun },
                      { id: 'dark', label: 'Dark', icon: Moon },
                      { id: 'system', label: 'System', icon: Monitor },
                    ] as const
                  ).map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTheme(id)}
                      className={`inline-flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                        theme === id
                          ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                          : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 12-Hour vs 24-Hour Time Format */}
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Broadcast Clock Format
                </span>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => updateAppearance({ timeFormat: '12h' })}
                    className={`py-2 px-3 rounded-lg text-xs font-medium font-mono tabular-nums transition cursor-pointer ${
                      appearance.timeFormat === '12h'
                        ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    12-Hour (8:00 PM)
                  </button>
                  <button
                    type="button"
                    onClick={() => updateAppearance({ timeFormat: '24h' })}
                    className={`py-2 px-3 rounded-lg text-xs font-medium font-mono tabular-nums transition cursor-pointer ${
                      appearance.timeFormat === '24h'
                        ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    24-Hour (20:00)
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Section 2: Live Guide (EPG) Layout & Density */}
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm space-y-4">
            <div>
              <div className="flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-indigo-500" />
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Live Guide (EPG) Density &amp; Timeline Zoom
                </h2>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Adjust how many channels fit vertically and how many minutes of broadcast schedule fit horizontally.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
              {/* Row Density */}
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Channel Row Height
                </span>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800">
                  {(
                    [
                      { id: 'compact', label: 'Compact' },
                      { id: 'standard', label: 'Standard' },
                      { id: 'comfortable', label: 'Spacious' },
                    ] as const
                  ).map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => updateAppearance({ guideDensity: id })}
                      className={`py-2 px-2.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                        appearance.guideDensity === id
                          ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                          : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Timeline Zoom Span */}
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Visible Timeline Window
                </span>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800">
                  {(
                    [
                      { mins: 15, label: '15m (Zoomed)' },
                      { mins: 25, label: '25m (Default)' },
                      { mins: 45, label: '45m (Wide)' },
                    ] as const
                  ).map(({ mins, label }) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() =>
                        updateAppearance({ guideVisibleMinutes: mins })
                      }
                      className={`py-2 px-2 rounded-lg text-xs font-medium font-mono tabular-nums transition cursor-pointer ${
                        appearance.guideVisibleMinutes === mins
                          ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                          : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <label className="flex items-center justify-between gap-3 pt-2 border-t border-zinc-100 dark:border-zinc-800/80 cursor-pointer">
              <div>
                <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                  Show Category &amp; Rule Summary in Channel Column
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Displays station category badge and active dayparting indicator under each station name in the Guide.
                </div>
              </div>
              <input
                type="checkbox"
                checked={appearance.guideShowRuleSummary}
                onChange={(e) =>
                  updateAppearance({ guideShowRuleSummary: e.target.checked })
                }
                className="w-4 h-4 rounded accent-indigo-600 cursor-pointer"
              />
            </label>
          </section>

          {/* Section 3: Now Playing Stage */}
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm space-y-4">
            <div>
              <div className="flex items-center gap-2">
                <Disc className="w-4 h-4 text-indigo-500" />
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Now Playing Stage
                </h2>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Customize the full-screen Now Playing backdrop, album sleeve corners, and station preview cards.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
              {/* Backdrop Style */}
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Stage Backdrop Ambiance
                </span>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800">
                  {(
                    [
                      { id: 'artwork_blur', label: 'Art Blur' },
                      { id: 'color_glow', label: 'Color Glow' },
                      { id: 'solid_dark', label: 'Studio Dark' },
                    ] as const
                  ).map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() =>
                        updateAppearance({ nowPlayingBackdrop: id })
                      }
                      className={`py-2 px-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                        appearance.nowPlayingBackdrop === id
                          ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                          : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sleeve Corner Style */}
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Album Sleeve Corners
                </span>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() =>
                      updateAppearance({ nowPlayingSleeveShape: 'rounded' })
                    }
                    className={`py-2 px-3 rounded-lg text-xs font-medium transition cursor-pointer ${
                      appearance.nowPlayingSleeveShape === 'rounded'
                        ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    Rounded Sleeve
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateAppearance({ nowPlayingSleeveShape: 'square' })
                    }
                    className={`py-2 px-3 rounded-lg text-xs font-medium transition cursor-pointer ${
                      appearance.nowPlayingSleeveShape === 'square'
                        ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    Crisp LP Square
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <div>
                  <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                    Show Adjacent Station Cards (Prev / Next Channel)
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Displays quick-tune preview cards for the previous and next radio channels alongside the current track.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={appearance.showAdjacentStations}
                  onChange={(e) =>
                    updateAppearance({ showAdjacentStations: e.target.checked })
                  }
                  className="w-4 h-4 rounded accent-indigo-600 cursor-pointer"
                />
              </label>
            </div>
          </section>

          {/* Section 4: Channel Badges */}
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-500" />
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Channel Badges
                  </h2>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Customize the shape and category icon watermark on auto-generated station badges.
                </p>
              </div>

              {/* Live Badge Preview */}
              <div className="flex items-center gap-2">
                <ChannelBadge
                  channelNumber={1}
                  tileColor="#8b5cf6"
                  category="discography"
                  size="md"
                />
                <ChannelBadge
                  channelNumber={2}
                  tileColor="#f59e0b"
                  category="era"
                  size="md"
                />
                <ChannelBadge
                  channelNumber={3}
                  tileColor="#10b981"
                  category="genre"
                  size="md"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-zinc-100 dark:border-zinc-800/80 items-center">
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Badge Corner Style
                </span>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => updateAppearance({ badgeShape: 'rounded' })}
                    className={`py-2 px-3 rounded-lg text-xs font-medium transition cursor-pointer ${
                      appearance.badgeShape === 'rounded'
                        ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    Rounded Square
                  </button>
                  <button
                    type="button"
                    onClick={() => updateAppearance({ badgeShape: 'circle' })}
                    className={`py-2 px-3 rounded-lg text-xs font-medium transition cursor-pointer ${
                      appearance.badgeShape === 'circle'
                        ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    Circular
                  </button>
                </div>
              </div>

              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <div>
                  <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                    Show Category Icon Watermark
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Renders subtle category icons inside auto-generated channel tiles (`CH 1`, `CH 2`).
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={appearance.badgeShowCategoryIcon}
                  onChange={(e) =>
                    updateAppearance({
                      badgeShowCategoryIcon: e.target.checked,
                    })
                  }
                  className="w-4 h-4 rounded accent-indigo-600 cursor-pointer"
                />
              </label>
            </div>
          </section>

          {/* Card 5: Playback */}
          <section className="md:col-span-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <Play className="w-4 h-4 text-indigo-500 fill-indigo-500/20" />
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Playback
              </h2>
            </div>

            {/* Autoplay on Page Load Subsection */}
            <div className="p-4 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <Play className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Autoplay on Page Load</span>
                    {appearance.autoplayEnabled && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-mono font-semibold">
                        ON
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
                    Automatically starts station audio streaming when Radiarr loads in your browser or desktop app.
                  </p>
                </div>

                <label className="relative inline-flex items-center cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={appearance.autoplayEnabled}
                    onChange={(e) =>
                      updateAppearance({
                        autoplayEnabled: e.target.checked,
                      })
                    }
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5.5 bg-zinc-300 dark:bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:bg-indigo-600" />
                </label>
              </div>

              {appearance.autoplayEnabled && (
                <div className="pt-2 border-t border-zinc-200/70 dark:border-zinc-800/70 space-y-3 animate-in fade-in duration-150">
                  <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                    Station Autoplay Mode:
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {[
                      {
                        id: 'random_station',
                        title: 'Random Station',
                        desc: 'Chooses an enabled station at random each time Radiarr loads.',
                      },
                      {
                        id: 'last_station',
                        title: 'Last Station',
                        desc: 'Resumes whichever station was tuned during your previous session.',
                      },
                      {
                        id: 'default_station',
                        title: 'Default Station',
                        desc: 'Always starts on your designated default station marked with a star (★) on the guide.',
                      },
                    ].map((opt) => {
                      const isSelected =
                        (appearance.autoplayMode || 'last_station') === opt.id;
                      return (
                        <label
                          key={opt.id}
                          className={`flex items-start gap-2.5 p-3 rounded-xl border transition cursor-pointer ${
                            isSelected
                              ? 'border-indigo-600 dark:border-indigo-500 bg-white dark:bg-zinc-900 shadow-xs ring-1 ring-indigo-500/20'
                              : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-white/50 dark:bg-zinc-900/50'
                          }`}
                        >
                          <input
                            type="radio"
                            name="autoplayMode"
                            value={opt.id}
                            checked={isSelected}
                            onChange={() =>
                              updateAppearance({
                                autoplayMode: opt.id as any,
                              })
                            }
                            className="mt-0.5 w-4 h-4 accent-indigo-600 shrink-0 cursor-pointer"
                          />
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                              <span>{opt.title}</span>
                              {opt.id === 'default_station' && (
                                <Star className="w-3 h-3 text-zinc-700 dark:text-zinc-200 fill-zinc-700 dark:fill-zinc-200 shrink-0" />
                              )}
                            </div>
                            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-snug">
                              {opt.desc}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  {appearance.autoplayMode === 'default_station' && (
                    <div className="p-3 rounded-xl bg-zinc-100/80 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/80 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-6 h-6 rounded-lg bg-zinc-200/90 dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 flex items-center justify-center shrink-0">
                          <Star className="w-3.5 h-3.5 fill-zinc-700 dark:fill-zinc-200" />
                        </div>
                        <div className="min-w-0">
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {defaultStation
                              ? `Default: CH ${defaultStation.channelNumber} — ${defaultStation.name}`
                              : 'No default station designated yet'}
                          </span>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            {defaultStation
                              ? 'Click the star icon (★) next to any channel on the Guide to change your default.'
                              : 'Click the star icon (★) next to any channel on the Guide to set it as default.'}
                          </p>
                        </div>
                      </div>

                      {/* Dropdown to also set or clear it here directly */}
                      <div className="flex items-center gap-2">
                        {stations && stations.length > 0 && (
                          <select
                            value={appearance.defaultStationId || ''}
                            onChange={(e) =>
                              updateAppearance({
                                defaultStationId: e.target.value || null,
                              })
                            }
                            className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="">Select default channel...</option>
                            {stations.map((s) => (
                              <option key={s.id} value={s.id}>
                                CH {s.channelNumber} &ndash; {s.name}
                              </option>
                            ))}
                          </select>
                        )}
                        {defaultStation && (
                          <button
                            type="button"
                            onClick={() => updateAppearance({ defaultStationId: null })}
                            className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:underline shrink-0 cursor-pointer"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Steering Wheel & Car Media Remote Behavior */}
            <div className="p-4 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 space-y-3">
              <div>
                <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <span>Car Steering Wheel &amp; Remote Track Buttons (⏮ / ⏭)</span>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
                  Choose how your car steering wheel, Bluetooth audio system, and phone lock screen handle Track Next and Previous buttons.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[
                  {
                    id: 'station_switch_hold_track',
                    title: 'Tap: Switch Station | Double-Tap / Hold: Skip Track',
                    desc: 'Single-tap switches stations. Quick double-tapping or holding down skips tracks on the current station.',
                    badge: 'Default',
                  },
                  {
                    id: 'track_skip_hold_station',
                    title: 'Tap: Skip Track | Double-Tap / Hold: Switch Station',
                    desc: 'Single-tap skips tracks. Quick double-tapping or holding down browses through radio stations.',
                    badge: 'Car Recommended',
                  },
                  {
                    id: 'always_track_skip',
                    title: 'Always Skip Tracks',
                    desc: 'Steering wheel buttons always navigate tracks on the tuned station. Use on-screen controls to switch stations.',
                    badge: null,
                  },
                  {
                    id: 'always_station_switch',
                    title: 'Always Switch Stations',
                    desc: 'Steering wheel buttons always browse radio channels. Use on-screen controls to skip tracks.',
                    badge: null,
                  },
                ].map((opt) => {
                  const isSelected =
                    (appearance.remoteTrackButtonBehavior ||
                      'station_switch_hold_track') === opt.id;
                  return (
                    <label
                      key={opt.id}
                      className={`flex items-start gap-3 p-3 rounded-xl border transition cursor-pointer ${
                        isSelected
                          ? 'border-indigo-600 dark:border-indigo-500 bg-white dark:bg-zinc-900 shadow-xs'
                          : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-white/50 dark:bg-zinc-900/50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="remoteTrackButtonBehavior"
                        value={opt.id}
                        checked={isSelected}
                        onChange={() =>
                          updateAppearance({
                            remoteTrackButtonBehavior: opt.id as any,
                          })
                        }
                        className="mt-0.5 w-4 h-4 accent-indigo-600 shrink-0 cursor-pointer"
                      />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                            {opt.title}
                          </span>
                          {opt.badge && (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                              {opt.badge}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-snug">
                          {opt.desc}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>

              {/* Hold Threshold Fine-Tuning & Explanation (active when a hold-enabled mode is selected) */}
              {(appearance.remoteTrackButtonBehavior === 'station_switch_hold_track' ||
                appearance.remoteTrackButtonBehavior === 'track_skip_hold_station' ||
                !appearance.remoteTrackButtonBehavior) && (
                <div className="pt-3 border-t border-zinc-200/70 dark:border-zinc-800/70 space-y-4 animate-in fade-in duration-150">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                        <span>Button Timing (Double-Tap &amp; Hold Threshold)</span>
                      </div>
                      <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                        {appearance.remoteHoldThresholdMs || 800} ms
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                      How quickly a second tap must arrive (double-tap) or how long the button must be held down to trigger the secondary action (
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">
                        {appearance.remoteTrackButtonBehavior === 'track_skip_hold_station'
                          ? 'Switch Station'
                          : 'Skip Track'}
                      </span>
                      ) instead of a single tap.
                    </p>

                    <div className="flex items-center gap-3 pt-1">
                      <span className="text-[10px] text-zinc-400 font-mono">300ms</span>
                      <input
                        type="range"
                        min={300}
                        max={2500}
                        step={50}
                        value={appearance.remoteHoldThresholdMs || 800}
                        onChange={(e) =>
                          updateAppearance({
                            remoteHoldThresholdMs: Number(e.target.value),
                          })
                        }
                        className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      />
                      <span className="text-[10px] text-zinc-400 font-mono">2500ms</span>
                    </div>

                    {/* Quick Preset Buttons */}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {[
                        { ms: 400, label: '400ms (Fast Double-Tap)' },
                        { ms: 600, label: '600ms (Snappy)' },
                        { ms: 800, label: '800ms (Balanced - Recommended)' },
                        { ms: 1200, label: '1.2s (Deliberate)' },
                        { ms: 1800, label: '1.8s (Long Hold)' },
                      ].map((preset) => {
                        const active =
                          (appearance.remoteHoldThresholdMs || 800) === preset.ms;
                        return (
                          <button
                            key={preset.ms}
                            type="button"
                            onClick={() =>
                              updateAppearance({ remoteHoldThresholdMs: preset.ms })
                            }
                            className={`text-[10px] font-medium px-2 py-1 rounded-md border transition cursor-pointer ${
                              active
                                ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                                : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-700'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Interactive Double-Tap & Hold Tester */}
                  <div className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-2.5">
                    <div className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 flex items-center justify-between">
                      <span>Interactive Double-Tap &amp; Hold Tester</span>
                      <span className="text-[10px] text-zinc-400 font-normal">
                        Try double-clicking quickly OR pressing and holding below
                      </span>
                    </div>

                    <HoldTimingTester
                      thresholdMs={appearance.remoteHoldThresholdMs || 800}
                      isHoldToTrack={
                        (appearance.remoteTrackButtonBehavior ||
                          'station_switch_hold_track') === 'station_switch_hold_track'
                      }
                    />
                  </div>

                  {/* Car Technical Explanation Guide */}
                  <div className="p-3.5 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200/60 dark:border-indigo-900/40 text-[11px] text-zinc-600 dark:text-zinc-300 space-y-2.5">
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                      <span>How Steering Wheel Controls &amp; Bluetooth Audio Work in Your Car</span>
                    </div>
                    <ul className="space-y-2 text-[10px] leading-relaxed list-disc list-inside text-zinc-600 dark:text-zinc-400">
                      <li>
                        <strong className="text-zinc-700 dark:text-zinc-200">Double-Tapping vs. Holding:</strong> Many steering wheel controls (like in your vehicle) do not send hardware hold signals, but quick double-tapping sends two signals in rapid succession within your threshold window ({appearance.remoteHoldThresholdMs || 800}ms). Radiarr recognizes this immediately and triggers track navigation! If holding feels inconsistent, double-tapping is the most reliable way to skip tracks.
                      </li>
                      <li>
                        <strong className="text-zinc-700 dark:text-zinc-200">Phone Calls, Siri &amp; Background App Conflicts (e.g. Plexamp / Spotify on iOS):</strong> When a phone call comes in or Siri speaks, iOS pauses Safari audio. Because native apps like Plexamp run deep in the iOS background audio stack, iOS will often hand the Bluetooth "Now Playing" crown back to Plexamp if it is suspended in the background.
                      </li>
                      <li>
                        <strong className="text-zinc-700 dark:text-zinc-200">How to keep Radiarr as your primary car player:</strong>
                        <ol className="list-decimal list-inside pl-3 pt-1 space-y-1 text-zinc-600 dark:text-zinc-400">
                          <li>
                            <strong>Enable Auto-Resume below:</strong> Radiarr automatically detects when phone calls or Siri dismiss and re-asserts audio playback immediately.
                          </li>
                          <li>
                            <strong>Swipe away Plexamp:</strong> Close Plexamp from the iOS App Switcher before driving so iOS has no competing background media player to fall back on.
                          </li>
                          <li>
                            <strong>Add to Home Screen (PWA):</strong> Tap <em>Share &gt; Add to Home Screen</em> in Safari. Running Radiarr as an installed web app grants it standalone media status, greatly improving background audio retention in the car!
                          </li>
                        </ol>
                      </li>
                    </ul>
                  </div>
                </div>
              )}
            </div>



            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <label className="flex items-start justify-between gap-3 p-3.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 cursor-pointer">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    <span>Realtime Lock (Authentic Live Radio Mode)</span>
                    {appearance.realtimeLock && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-mono">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Disables all track skipping, scrubbing, and EPG time-shifting so every station plays strictly in real time. Unpausing or selecting any program block in the Guide immediately tunes to the live broadcast.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={appearance.realtimeLock}
                  onChange={(e) =>
                    updateAppearance({
                      realtimeLock: e.target.checked,
                    })
                  }
                  className="mt-0.5 w-4 h-4 rounded accent-indigo-600 cursor-pointer shrink-0"
                />
              </label>

              <label className="flex items-start justify-between gap-3 p-3.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 cursor-pointer">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    Reverse Track Prev / Next Station Direction
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Inverts hardware and lock-screen Track Next (⏭) and Track Prev (⏮) so pressing <strong>Next</strong> steps to the previous station (CH&minus;) and <strong>Prev</strong> steps to the next station (CH+).
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={appearance.reverseStationDirection}
                  onChange={(e) =>
                    updateAppearance({
                      reverseStationDirection: e.target.checked,
                    })
                  }
                  className="mt-0.5 w-4 h-4 rounded accent-indigo-600 cursor-pointer shrink-0"
                />
              </label>

              <label className="flex items-start justify-between gap-3 p-3.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 cursor-pointer sm:col-span-2">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    <RotateCcw className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span>Auto-Resume Playback After Phone Calls &amp; Siri Interruptions</span>
                    {appearance.autoResumeAfterInterruption && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-mono">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Automatically re-asserts audio playback and reclaims Bluetooth audio session priority when an incoming phone call ends, Siri or your voice assistant finishes, or car navigation voice prompts complete.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={appearance.autoResumeAfterInterruption}
                  onChange={(e) =>
                    updateAppearance({
                      autoResumeAfterInterruption: e.target.checked,
                    })
                  }
                  className="mt-0.5 w-4 h-4 rounded accent-indigo-600 cursor-pointer shrink-0"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <label className="flex items-start justify-between gap-3 p-3.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 cursor-pointer">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    <Shuffle className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span>Master Station Shuffle</span>
                    {appearance.stationShuffleEnabled && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] font-mono">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    When enabled, channel switching (CH &minus; / CH +, arrow keys, and car steering wheel controls) jumps to random stations in your lineup using a non-repeating shuffle bag instead of adjacent linear channels.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={appearance.stationShuffleEnabled}
                  onChange={(e) =>
                    updateAppearance({
                      stationShuffleEnabled: e.target.checked,
                    })
                  }
                  className="mt-0.5 w-4 h-4 rounded accent-indigo-600 cursor-pointer shrink-0"
                />
              </label>

              <label className="flex items-start justify-between gap-3 p-3.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 cursor-pointer">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    <X className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span>Clear Curation Search Filters on Close</span>
                    {appearance.clearCurationSearchOnClose && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-mono">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Automatically clears search keywords typed into the Artist, Album, and Genre filter boxes whenever you close or switch between stations in the curation editor.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={appearance.clearCurationSearchOnClose}
                  onChange={(e) =>
                    updateAppearance({
                      clearCurationSearchOnClose: e.target.checked,
                    })
                  }
                  className="mt-0.5 w-4 h-4 rounded accent-indigo-600 cursor-pointer shrink-0"
                />
              </label>
            </div>

            <div className="px-3.5 py-2.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-900/50 text-[11px] text-indigo-900 dark:text-indigo-200 flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>Car Stereo Tip:</strong> Quick double-tapping <strong>⏮ / ⏭</strong> is now fully supported on all vehicles! If your car steering wheel only sends tap commands without long-press support, select <em>&ldquo;Tap: Skip Track | Double-Tap / Hold: Switch Station&rdquo;</em> above so single taps skip songs directly!
              </span>
            </div>
          </section>
        </div>
      )}

      {/* SUB-TAB: Smart Home & Cast (Google Home, Home Assistant Voice Routines & Cast Sender) */}
      {activeSubTab === 'integrations' && (
        <div className="space-y-5">
          {/* Header & Overview Card */}
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Cast className="w-4 h-4 text-indigo-500" />
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Google Home &amp; Audio Casting
                  </h2>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Stream Radiarr live stations to your Google Home / Nest speakers directly using built-in Google Cast, voice controls, or direct stream links — completely standalone with no external software or Home Assistant required.
                </p>
              </div>

              {googleCast.isCasting && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-medium">
                  <Cast className="w-3.5 h-3.5" />
                  <span>Casting to {googleCast.castDeviceName || 'Google Home'}</span>
                  <button
                    type="button"
                    onClick={() => googleCast.stopCasting()}
                    className="ml-1 text-[11px] text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>

            {/* Google Cast In-Browser Sender Section */}
            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    <Cast className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span>Built-in Google Cast Sender (Zero Setup)</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Cast any live station directly to your Google Home, Nest Audio, Chromecast Audio, or smart displays over your local Wi-Fi with one click.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {googleCast.isCasting ? (
                    <button
                      type="button"
                      onClick={() => googleCast.stopCasting()}
                      className="px-3.5 py-1.5 rounded-lg border border-rose-300 dark:border-rose-800 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                    >
                      Stop Casting
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        const targetStation =
                          stations?.find((s) => s.id === (selectedIntegrationStationId || defaultStation?.id || stations[0]?.id)) ||
                          stations?.[0];
                        if (targetStation) {
                          googleCast.startCastingStation({
                            id: targetStation.id,
                            name: targetStation.name,
                            channelNumber: targetStation.channelNumber,
                            thumbnailUrl: targetStation.thumbnailUrl,
                          });
                        } else {
                          googleCast.openCastPrompt();
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white shadow-xs transition cursor-pointer"
                    >
                      <Cast className="w-3.5 h-3.5" />
                      <span>Cast to Speaker</span>
                    </button>
                  )}
                </div>
              </div>

              {!googleCast.isCastAvailable && (
                <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-[11px] text-amber-800 dark:text-amber-200">
                  Google Cast is supported natively in Chrome, Edge, and Android Chrome. If testing in an embedded preview, open Radiarr in a dedicated browser tab to discover speakers.
                </div>
              )}
            </div>

            {/* Standalone Voice Controls & Bluetooth Guide */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 space-y-1.5">
                <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>Voice Controls While Casting</span>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  Once Radiarr is streaming to your Google Home speaker via the Cast button above or on the bottom player bar, you can speak directly to your speaker:
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] font-mono text-zinc-700 dark:text-zinc-300">&ldquo;Hey Google, pause&rdquo;</span>
                  <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] font-mono text-zinc-700 dark:text-zinc-300">&ldquo;Hey Google, resume&rdquo;</span>
                  <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] font-mono text-zinc-700 dark:text-zinc-300">&ldquo;Hey Google, volume 50%&rdquo;</span>
                  <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] font-mono text-zinc-700 dark:text-zinc-300">&ldquo;Hey Google, stop&rdquo;</span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 space-y-1.5">
                <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>Bluetooth Audio Pairing Mode</span>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  Every Google Home &amp; Nest speaker has a built-in Bluetooth receiver. You can say:
                </p>
                <div className="pt-0.5">
                  <span className="px-2 py-1 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-[11px] font-mono">
                    &ldquo;Hey Google, pair Bluetooth&rdquo;
                  </span>
                </div>
                <p className="text-[10px] text-zinc-400 leading-normal pt-1">
                  Connect your phone, tablet, or PC in Bluetooth settings. Radiarr will route all audio directly through the speaker.
                </p>
              </div>
            </div>
          </section>

          {/* Direct Live Stream URLs Card */}
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Radio className="w-4 h-4 text-indigo-500" />
                <span>Station Stream URLs</span>
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Direct live MP3 audio stream links for external players (VLC, Sonos, WiiM, smart speakers, or media apps).
              </p>
            </div>

            {/* Station Selector Bar */}
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                <div className="sm:col-span-5">
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Select Station
                  </label>
                  <select
                    value={selectedIntegrationStationId || defaultStation?.id || stations?.[0]?.id || ''}
                    onChange={(e) => {
                      setSelectedIntegrationStationId(e.target.value);
                      setIsTestingAudio(false);
                      if (testAudioRef.current) {
                        testAudioRef.current.pause();
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-100"
                  >
                    {(stations || []).map((st) => (
                      <option key={st.id} value={st.id}>
                        CH {st.channelNumber} &middot; {st.name}
                      </option>
                    ))}
                  </select>
                </div>

                {(() => {
                  const activeSt =
                    stations?.find(
                      (s) =>
                        s.id ===
                        (selectedIntegrationStationId ||
                          defaultStation?.id ||
                          stations?.[0]?.id)
                    ) || stations?.[0];
                  const currentOrigin =
                    typeof window !== 'undefined'
                      ? window.location.origin
                      : 'http://localhost:8484';
                  const streamUrl = activeSt
                    ? `${currentOrigin}/api/stations/${encodeURIComponent(activeSt.id)}/stream.mp3`
                    : '';

                  return (
                    <div className="sm:col-span-7 space-y-1">
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        Direct Live MP3 Stream URL
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          readOnly
                          value={streamUrl}
                          className="flex-1 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-xs font-mono text-zinc-700 dark:text-zinc-300 select-all"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (streamUrl) {
                              void navigator.clipboard.writeText(streamUrl);
                              setCopiedUrl(true);
                              setTimeout(() => setCopiedUrl(false), 2000);
                            }
                          }}
                          className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition cursor-pointer"
                          title="Copy Stream URL"
                        >
                          {copiedUrl ? (
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!testAudioRef.current) {
                              testAudioRef.current = new Audio(streamUrl);
                              testAudioRef.current.onended = () => setIsTestingAudio(false);
                            }
                            if (isTestingAudio) {
                              testAudioRef.current.pause();
                              setIsTestingAudio(false);
                            } else {
                              testAudioRef.current.src = streamUrl;
                              void testAudioRef.current.play();
                              setIsTestingAudio(true);
                            }
                          }}
                          className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition cursor-pointer ${
                            isTestingAudio
                              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                          }`}
                          title="Test audio stream in browser"
                        >
                          {isTestingAudio ? 'Playing Live...' : 'Test Play'}
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Optional Advanced Home Assistant Integration (Collapsible) */}
              <details className="group rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 p-3.5 space-y-3">
                <summary className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 cursor-pointer flex items-center justify-between select-none">
                  <span className="flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-zinc-500" />
                    <span>Optional Advanced Bridge: Home Assistant Voice Routines</span>
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-400 transition group-open:rotate-180" />
                </summary>

                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed pt-1">
                  If you ever set up Home Assistant in the future, you can use this pre-configured YAML script to map custom voice commands like &ldquo;Hey Google, play Car Share on Radiarr&rdquo; directly to your speakers.
                </p>

                {(() => {
                  const activeSt =
                    stations?.find(
                      (s) =>
                        s.id ===
                        (selectedIntegrationStationId ||
                          defaultStation?.id ||
                          stations?.[0]?.id)
                    ) || stations?.[0];
                  const currentOrigin =
                    typeof window !== 'undefined'
                      ? window.location.origin
                      : 'http://localhost:8484';
                  const streamUrl = activeSt
                    ? `${currentOrigin}/api/stations/${encodeURIComponent(activeSt.id)}/stream.mp3`
                    : '';
                  const scriptSlug = activeSt
                    ? activeSt.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
                    : 'station';

                  const haYaml = `# Home Assistant Script for "${activeSt?.name || 'Station'}"
radiarr_play_${scriptSlug}:
  alias: "Play ${activeSt?.name || 'Station'} on Google Home"
  sequence:
    - action: media_player.play_media
      target:
        entity_id: media_player.google_home
      data:
        media_content_id: "${streamUrl}"
        media_content_type: "music"
  mode: single`;

                  return (
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
                          Script YAML:
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(haYaml);
                            setCopiedYaml(true);
                            setTimeout(() => setCopiedYaml(false), 2000);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-[10px] text-zinc-700 dark:text-zinc-300"
                        >
                          {copiedYaml ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedYaml ? 'Copied' : 'Copy YAML'}</span>
                        </button>
                      </div>
                      <pre className="p-3 rounded-lg bg-zinc-950 text-zinc-200 text-[10px] font-mono leading-relaxed overflow-x-auto border border-zinc-800">
                        {haYaml}
                      </pre>
                    </div>
                  );
                })()}
              </details>
            </div>
          </section>
        </div>
      )}

      {/* SUB-TAB 1: Sources (Music Libraries - Local Folders & Plex Server) */}
      {activeSubTab === 'sources' && (
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
          <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-indigo-500" />
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Music Libraries
                  </h2>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Use local folders and Plex Media Server libraries simultaneously, and rescan each library whenever you choose.
                </p>
              </div>


              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 text-xs">
                  <label
                    htmlFor="rescan-interval"
                    className="text-zinc-600 dark:text-zinc-400 font-medium"
                  >
                    Scheduled rescan:
                  </label>
                  <select
                    id="rescan-interval"
                    value={settings?.rescanIntervalMinutes ?? 0}
                    onChange={(e) =>
                      void onUpdateSettings({
                        rescanIntervalMinutes: Number(
                          e.target.value
                        ) as RescanIntervalMinutes,
                      })
                    }
                    className="px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-xs"
                  >
                    <option value={0}>Off (Manual only)</option>
                    <option value={60}>Every 1 hour</option>
                    <option value={360}>Every 6 hours</option>
                    <option value={720}>Every 12 hours</option>
                    <option value={1440}>Every 24 hours</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => void onTriggerScan()}
                  disabled={progress?.isScanning}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition cursor-pointer whitespace-nowrap"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${progress?.isScanning ? 'animate-spin' : ''}`}
                  />
                  <span>{progress?.isScanning ? 'Scanning...' : 'Scan All'}</span>
                </button>
              </div>
            </div>

            {/* Sub-Tabs within Music Libraries: Plex Server vs Local Folders */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="inline-flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800/80 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setLibraryTab('plex')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap ${
                    libraryTab === 'plex'
                      ? 'bg-white dark:bg-zinc-900 text-amber-600 dark:text-amber-400 shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <Server className="w-3.5 h-3.5" />
                  <span>Plex Server ({plexLibraries.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setLibraryTab('local')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap ${
                    libraryTab === 'local'
                      ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>Local Folders ({localLibraries.length})</span>
                </button>
              </div>

              {libraryTab === 'local' && (
                <button
                  type="button"
                  onClick={() => {
                    setShowAddMedia((prev) => !prev);
                    setAddMediaError(null);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-medium transition cursor-pointer whitespace-nowrap"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Add Media</span>
                </button>
              )}
            </div>
          </div>

          {/* Live Scan Progress Bar if scanning */}
          {progress?.isScanning && (
            <div className="px-5 py-3 bg-indigo-50 dark:bg-indigo-950/40 border-b border-indigo-200 dark:border-indigo-900/60 space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-indigo-800 dark:text-indigo-200">
                  {progress.isCancelling
                    ? 'Stopping scan, finishing the files in progress...'
                    : `Scanning ${progress.currentLibrary || 'libraries'}...`}
                </span>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono tabular-nums text-indigo-700 dark:text-indigo-300">
                    {progress.filesTotal > 0
                      ? `${progress.filesProcessed} / ${progress.filesTotal}`
                      : 'Finding files...'}
                  </span>
                  <button
                    type="button"
                    onClick={() => void onCancelScan()}
                    disabled={progress.isCancelling}
                    title="Stop the scan. Tracks imported so far are kept, and the next scan picks up where this one left off."
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-rose-300 dark:border-rose-800 bg-white dark:bg-zinc-900 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50 text-rose-700 dark:text-rose-300 text-xs font-medium transition cursor-pointer whitespace-nowrap"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    <span>{progress.isCancelling ? 'Stopping...' : 'Stop scan'}</span>
                  </button>
                </div>
              </div>
              <div className="w-full h-1.5 rounded-full bg-indigo-200 dark:bg-indigo-900 overflow-hidden">
                <div
                  className="h-full bg-indigo-600 dark:bg-indigo-400 transition-all duration-200"
                  style={{
                    width:
                      progress.filesTotal > 0
                        ? `${Math.min(100, Math.round((progress.filesProcessed / progress.filesTotal) * 100))}%`
                        : '15%',
                  }}
                />
              </div>
            </div>
          )}

          {/* TAB 1: Local Folders */}
          {libraryTab === 'local' && (
            <>
              {isDesktopApp ? (
                <div className="px-5 py-3 bg-indigo-50/70 dark:bg-indigo-950/30 border-b border-indigo-100 dark:border-indigo-900/40 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span className="text-zinc-700 dark:text-zinc-300">
                      <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
                        Radiarr Desktop (
                        {desktopPlatform === 'win32'
                          ? 'Windows'
                          : desktopPlatform === 'darwin'
                            ? 'macOS'
                            : 'Linux'}
                        )
                      </strong>{' '}
                      — Native folder picker and system tray playback active.
                    </span>
                  </div>
                  <span className="text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                    Native Desktop
                  </span>
                </div>
              ) : (
                <div className="px-5 py-2.5 bg-zinc-50 dark:bg-zinc-900/60 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Monitor className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span className="text-zinc-600 dark:text-zinc-400">
                      <strong className="text-zinc-800 dark:text-zinc-200 font-medium">Docker / Web Mode Active:</strong> Container volume mounts &amp; Docker Compose fully supported.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDesktopInfoModal(true)}
                    className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                  >
                    Desktop Clients (Win / Mac / Linux) →
                  </button>
                </div>
              )}

              {showAddMedia && (
                <form
                  onSubmit={(e) => void handleCreateMediaLibrary(e)}
                  className="p-4 bg-zinc-50/90 dark:bg-zinc-950/60 border-b border-zinc-200 dark:border-zinc-800 space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        Library Name (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Soundtracks or Vinyl Rips"
                        value={newLibName}
                        onChange={(e) => setNewLibName(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <div className="flex items-center justify-between mb-1">
                        <label className="block font-medium text-zinc-700 dark:text-zinc-300">
                          {isDesktopApp ? 'Local Folder Path' : 'Folder Path on Server / Container'}
                        </label>
                        {isDesktopApp && (
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                            Click Browse to select folder
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder={
                            isDesktopApp
                              ? desktopPlatform === 'win32'
                                ? 'e.g. D:\\Music\\Albums or C:\\Users\\Username\\Music'
                                : '/Users/username/Music/Albums'
                              : 'e.g. /music/soundtracks or C:/Users/Username/Music'
                          }
                          value={newLibPath}
                          onChange={(e) => setNewLibPath(e.target.value)}
                          className="flex-1 px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-mono text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => void handleBrowseNativeFolder()}
                          disabled={isPickingFolder}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 border border-zinc-300 dark:border-zinc-700 text-xs font-medium transition cursor-pointer shrink-0 whitespace-nowrap shadow-xs"
                          title={
                            isDesktopApp
                              ? 'Browse folders using native OS file dialog'
                              : 'Information on native desktop folder picker'
                          }
                        >
                          <FolderOpen className="w-3.5 h-3.5 text-indigo-500" />
                          <span>{isPickingFolder ? 'Browsing...' : 'Browse...'}</span>
                        </button>
                        <button
                          type="submit"
                          disabled={isAddingMedia}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition cursor-pointer shrink-0 whitespace-nowrap shadow-xs"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{isAddingMedia ? 'Adding...' : 'Add Folder'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {addMediaError && (
                    <div className="text-xs text-rose-600 dark:text-rose-400">
                      {addMediaError}
                    </div>
                  )}
                </form>
              )}


              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {localLibraries.length === 0 ? (
                  <div className="p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
                    No local folders configured. Click &ldquo;Add Media&rdquo; above to add a folder path.
                  </div>
                ) : (
                  localLibraries.map((lib) => {
                    const isScanningThisLib =
                      progress?.isScanning && progress.currentLibrary === lib.name;
                    // Folders auto-discovered inside Docker's /music would just be
                    // re-added, so only those have no remove button.
                    const isRemovableLib =
                      lib.removable ?? lib.id.startsWith('custom-');

                    return (
                      <div
                        key={lib.id}
                        className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                              {lib.name}
                            </span>
                            <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                              {lib.path}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
                            <span>{lib.trackCount} tracks</span>
                            <span aria-hidden="true">&middot;</span>
                            <span>{lib.albumCount} albums</span>
                            <span aria-hidden="true">&middot;</span>
                            <span>{lib.artistCount} artists</span>
                            <span aria-hidden="true">&middot;</span>
                            <span>
                              Last scanned: {formatTimestamp(lib.lastScannedAt)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void onTriggerScan(lib.id)}
                            disabled={progress?.isScanning}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 text-zinc-800 dark:text-zinc-200 text-xs font-medium transition cursor-pointer whitespace-nowrap"
                            title={`Scan only ${lib.name}`}
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 text-indigo-500 ${
                                isScanningThisLib ? 'animate-spin' : ''
                              }`}
                            />
                            <span>
                              {isScanningThisLib ? 'Scanning...' : 'Rescan'}
                            </span>
                          </button>

                          {isRemovableLib && (
                            <button
                              type="button"
                              onClick={() => void onRemoveLibrary(lib.id)}
                              disabled={progress?.isScanning}
                              className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-50 transition cursor-pointer"
                              title={`Remove ${lib.name}`}
                              aria-label={`Remove ${lib.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          {/* TAB 2: Plex Media Server */}
          {libraryTab === 'plex' && (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {/* Step 1: Connect to Plex Account */}
              <div className="p-5 space-y-4">
                {!plexConnected ? (
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        Connect your Plex Media Server
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xl">
                        Sign in with Plex directly in your browser (no 4-digit PIN entry required). Choose which Plex music libraries (e.g. Albums, Singles) to connect alongside your local folders.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleConnectPlex()}
                        disabled={plexAuthPending}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs shadow-xs transition cursor-pointer disabled:opacity-60 whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>
                          {plexAuthPending
                            ? 'Waiting for Plex Sign-In...'
                            : 'Connect to Plex'}
                        </span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-xs">
                          PLEX
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                            <span>
                              Connected as {plexConfig?.username || 'Plex User'}
                            </span>
                            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                              &middot; Authenticated
                            </span>
                          </div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400">
                            {plexConfig?.serverName
                              ? `Active Server: ${plexConfig.serverName} (${plexConfig.serverUri || ''})`
                              : 'Select a Plex server below'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void loadPlexStatus()}
                          disabled={plexLoading}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-medium transition cursor-pointer whitespace-nowrap"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${plexLoading ? 'animate-spin' : ''}`}
                          />
                          <span>Refresh</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleDisconnectPlex()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs font-medium transition cursor-pointer whitespace-nowrap"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Disconnect</span>
                        </button>
                      </div>
                    </div>

                    {/* Server Selector & Optional Direct Server URL */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-xs">
                      <div>
                        <label className="block font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                          Plex Media Server
                        </label>
                        <select
                          value={plexConfig?.serverMachineId || ''}
                          onChange={(e) =>
                            void handleSelectPlexServer(e.target.value, undefined)
                          }
                          className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                        >
                          {plexServers.length === 0 ? (
                            <option value="">
                              {plexLoading ? 'Discovering servers...' : 'Custom / Manual Server URI'}
                            </option>
                          ) : (
                            plexServers.map((srv) => (
                              <option
                                key={srv.clientIdentifier}
                                value={srv.clientIdentifier}
                              >
                                {srv.name}
                              </option>
                            ))
                          )}
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                          Server Connection URL (Auto-detected or LAN override)
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={customPlexUri}
                            onChange={(e) => setCustomPlexUri(e.target.value)}
                            placeholder="e.g. http://192.168.1.50:32400"
                            className="flex-1 px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              void handleSelectPlexServer(
                                plexConfig?.serverMachineId,
                                customPlexUri
                              )
                            }
                            disabled={plexLoading || !customPlexUri.trim()}
                            className="px-3 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium text-xs transition cursor-pointer shrink-0 disabled:opacity-50 whitespace-nowrap"
                          >
                            Use URL
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {plexAuthPending && plexAuthUrl && (
                  <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
                    <span>
                      Complete sign-in in the Plex window. If your browser blocked the popup, click the link on the right:
                    </span>
                    <a
                      href={plexAuthUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold underline"
                    >
                      <span>Open Plex Sign-In</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}

                {plexServerError && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300">
                    {plexServerError}
                  </div>
                )}
              </div>

              {/* Step 2: Choose Which Plex Music Libraries to Connect */}
              {plexConnected && (
                <div className="p-5 bg-zinc-50/50 dark:bg-zinc-950/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        Available Music Libraries on {plexConfig?.serverName || 'Plex'}
                      </h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Choose which Plex music libraries (e.g. Albums, Singles) to connect to Radiarr.
                      </p>
                    </div>
                  </div>

                  {plexSections.length === 0 ? (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {plexLoading
                        ? 'Loading music libraries from Plex...'
                        : 'No music libraries found at this server URL. If your Plex server is on your local LAN, enter its LAN address (e.g. http://192.168.1.50:32400) above and click "Use URL".'}
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {plexSections.map((sec) => {
                        const isConnected = Boolean(sec.connectedLibraryId);
                        return (
                          <div
                            key={sec.key}
                            className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                              isConnected
                                ? 'border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/25'
                                : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
                            }`}
                          >
                            <div>
                              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                                {sec.title}
                              </div>
                              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                Plex Music Section #{sec.key}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => void handleTogglePlexSection(sec)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap ${
                                isConnected
                                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                  : 'border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200'
                              }`}
                            >
                              {isConnected ? (
                                <>
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Connected</span>
                                </>
                              ) : (
                                <>
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>Connect</span>
                                </>
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: Connected Plex Libraries with Individual Rescan Buttons */}
              {plexLibraries.length > 0 && (
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {plexLibraries.map((lib) => {
                    const isScanningThisLib =
                      progress?.isScanning && progress.currentLibrary === lib.name;
                    return (
                      <div
                        key={lib.id}
                        className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                              {lib.name}
                            </span>
                            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                              &middot; Plex
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
                            <span>{lib.trackCount} tracks</span>
                            <span aria-hidden="true">&middot;</span>
                            <span>{lib.albumCount} albums</span>
                            <span aria-hidden="true">&middot;</span>
                            <span>{lib.artistCount} artists</span>
                            <span aria-hidden="true">&middot;</span>
                            <span>
                              Last scanned: {formatTimestamp(lib.lastScannedAt)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void onTriggerScan(lib.id)}
                            disabled={progress?.isScanning}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 text-zinc-800 dark:text-zinc-200 text-xs font-medium transition cursor-pointer whitespace-nowrap"
                            title={`Import/Rescan ${lib.name} from Plex`}
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 text-amber-500 ${
                                isScanningThisLib ? 'animate-spin' : ''
                              }`}
                            />
                            <span>
                              {isScanningThisLib ? 'Scanning...' : 'Rescan'}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={async () => {
                              await onRemoveLibrary(lib.id);
                              await loadPlexStatus();
                            }}
                            disabled={progress?.isScanning}
                            className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-50 transition cursor-pointer"
                            title={`Remove ${lib.name}`}
                            aria-label={`Remove ${lib.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Last Scan Summary */}
          {latestRun && (
            <div className="p-5 bg-zinc-50/70 dark:bg-zinc-950/40 border-t border-zinc-200 dark:border-zinc-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Last Scan Summary ({formatTimestamp(latestRun.finishedAt || latestRun.startedAt)})
                  {latestRun.status === 'cancelled' && (
                    <span
                      className="ml-2 font-medium text-amber-600 dark:text-amber-400"
                      title="Tracks imported before the stop were kept. Scan again to pick up where it left off."
                    >
                      Stopped early
                    </span>
                  )}
                </span>
                <span className="text-xs text-zinc-600 dark:text-zinc-300 tabular-nums">
                  <strong>{overview?.totals.tracks ?? 0}</strong> tracks &middot;{' '}
                  <strong>{overview?.totals.albums ?? 0}</strong> albums &middot;{' '}
                  <strong>{overview?.totals.artists ?? 0}</strong> artists
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                {/* Skipped extensions */}
                <div className="p-3 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-1.5">
                  <div className="font-medium text-zinc-800 dark:text-zinc-200 tabular-nums">
                    Skipped Non-Audio Files ({totalSkipped})
                  </div>
                  {skippedEntries.length === 0 ? (
                    <p className="text-zinc-500">None</p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-zinc-600 dark:text-zinc-400 tabular-nums">
                      {skippedEntries.map(([ext, count], idx) => (
                        <span key={ext}>
                          {ext}: {count}
                          {idx < skippedEntries.length - 1 ? ' ·' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Incomplete Tags */}
                <div className="p-3 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-1.5">
                  <div className="font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5 tabular-nums">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    <span>Incomplete Tags ({overview?.totals.tagsIncomplete ?? 0})</span>
                  </div>
                  <p className="text-zinc-500 dark:text-zinc-400">
                    {overview?.totals.tagsIncomplete
                      ? `${overview.totals.tagsIncomplete} track(s) used folder/filename fallbacks.`
                      : 'All tracks have complete core tags.'}
                  </p>
                </div>

                {/* Unreadable Files */}
                <div className="p-3 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-1.5">
                  <div className="font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5 tabular-nums">
                    {latestRun.unreadableFiles.length > 0 ? (
                      <FileWarning className="w-3.5 h-3.5 text-rose-500" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    )}
                    <span>Unreadable Files ({latestRun.unreadableFiles.length})</span>
                  </div>
                  {latestRun.unreadableFiles.length === 0 ? (
                    <p className="text-zinc-500 dark:text-zinc-400">None</p>
                  ) : (
                    <ul className="space-y-1 max-h-20 overflow-y-auto text-rose-600 dark:text-rose-400 font-mono text-[11px]">
                      {latestRun.unreadableFiles.map((f, i) => (
                        <li key={i} className="truncate" title={f.path}>
                          {f.path.split('/').pop()}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* SUB-TAB 3: Backup & Restore */}
      {activeSubTab === 'backup' && (
        <div className="space-y-6">
          {/* Section 1: Automated Backups */}
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Clock className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Automatic Backups
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Schedule automated snapshots of your stations, rules, and music catalog. Choose how often backups run and how many historical versions to retain.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isCreatingBackupNow}
                  onClick={() => void handleCreateBackupNow()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-medium transition cursor-pointer disabled:opacity-50"
                  title="Create an immediate backup snapshot on the server"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isCreatingBackupNow ? 'Creating...' : 'Backup Now'}</span>
                </button>
              </div>
            </div>

            {/* Toggle switch for auto backups */}
            <div className="flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
              <div>
                <label
                  htmlFor="auto-backup-toggle"
                  className="text-xs font-medium text-zinc-800 dark:text-zinc-200 cursor-pointer"
                >
                  Enable Automated Backups
                </label>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  When enabled, Radiarr automatically generates full database snapshots in the background.
                </p>
              </div>
              <input
                id="auto-backup-toggle"
                type="checkbox"
                checked={draftAutoEnabled}
                onChange={(e) => setDraftAutoEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-zinc-300 dark:border-zinc-700 cursor-pointer"
              />
            </div>

            {/* Interval & Retention Settings */}
            <form
              onSubmit={(e) => void handleSaveAutoBackupConfig(e)}
              className={`space-y-4 pt-1 transition-opacity ${
                draftAutoEnabled ? 'opacity-100' : 'opacity-60 pointer-events-none'
              }`}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Frequency selector: Every X minutes / hours / days */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1">
                    <span>Backup Frequency</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">Every</span>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={draftIntervalValue}
                      onChange={(e) =>
                        setDraftIntervalValue(Math.max(1, parseInt(e.target.value) || 1))
                      }
                      className="w-20 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <select
                      value={draftIntervalUnit}
                      onChange={(e) => setDraftIntervalUnit(e.target.value as AutoBackupUnit)}
                      className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                    >
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                    </select>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    How frequently Radiarr creates automatic snapshots.
                  </p>
                </div>

                {/* Retention limit: Max backups to keep */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1">
                    <span>Backups to Keep</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">Keep</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={draftMaxBackups}
                      onChange={(e) =>
                        setDraftMaxBackups(Math.max(1, parseInt(e.target.value) || 1))
                      }
                      className="w-20 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">most recent backups</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Older automated snapshots are automatically pruned when this count is exceeded.
                  </p>
                </div>
              </div>

              {/* Status info & Save button */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800/80">
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-3">
                  {autoBackupConfig?.lastBackupAt ? (
                    <span>
                      Last backup: {new Date(autoBackupConfig.lastBackupAt).toLocaleString()}
                    </span>
                  ) : (
                    <span>Last backup: None yet</span>
                  )}
                  {autoBackupConfig?.enabled && autoBackupConfig.nextBackupAt && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        Next run: {new Date(autoBackupConfig.nextBackupAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSavingAutoConfig}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingAutoConfig ? 'Saving...' : 'Save Schedule'}</span>
                </button>
              </div>
            </form>

            {autoConfigMessage && (
              <div
                className={`px-3 py-2 rounded-xl text-xs border ${
                  autoConfigMessage.ok
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
                    : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-900'
                }`}
              >
                {autoConfigMessage.text}
              </div>
            )}
          </section>

          {/* Section 2: Stored Backups on Server */}
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Database className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <span>Stored Server Backups</span>
                    <span className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                      ({storedBackups.length})
                    </span>
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Saved backup snapshots located in your storage directory. You can restore, download, or delete them anytime.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void fetchBackupData()}
                disabled={isLoadingBackups}
                className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition cursor-pointer"
                title="Refresh backup list"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBackups ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {storedBackups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
                No server backups found. Create one using &quot;Backup Now&quot; above or enable automated backups.
              </div>
            ) : (
              <div className="overflow-x-auto -mx-1 sm:mx-0">
                <table className="w-full text-left text-xs text-zinc-600 dark:text-zinc-300">
                  <thead className="text-[11px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                    <tr>
                      <th className="pb-2 font-medium">Backup File</th>
                      <th className="pb-2 font-medium hidden sm:table-cell">Type</th>
                      <th className="pb-2 font-medium hidden md:table-cell">Contents</th>
                      <th className="pb-2 font-medium">Size</th>
                      <th className="pb-2 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                    {storedBackups.map((item) => (
                      <tr key={item.filename} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                        <td className="py-2.5 pr-2 min-w-[140px]">
                          <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-[220px] sm:max-w-xs" title={item.filename}>
                            {item.filename}
                          </div>
                          <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                            {new Date(item.createdAt).toLocaleString()}
                          </div>
                        </td>
                        <td className="py-2.5 pr-2 hidden sm:table-cell whitespace-nowrap">
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                            item.isAuto
                              ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400'
                              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                          }`}>
                            {item.isAuto ? 'Auto Snapshot' : 'Manual'}
                          </span>
                        </td>
                        <td className="py-2.5 pr-2 hidden md:table-cell text-[11px] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                          {item.counts ? (
                            <span>
                              {item.counts.stations} ch · {item.counts.tracks} tracks
                            </span>
                          ) : (
                            <span>Full backup</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-2 text-[11px] whitespace-nowrap font-mono">
                          {(item.sizeBytes / 1024).toFixed(1)} KB
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setConfirmRestoreItem(item)}
                              disabled={isRestoring}
                              className="px-2 py-1 rounded-md text-[11px] font-medium bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 transition cursor-pointer"
                              title="Restore this backup into the database"
                            >
                              Restore
                            </button>
                            <a
                              href={`/api/backup/download/${encodeURIComponent(item.filename)}`}
                              download
                              className="p-1 rounded-md text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                              title="Download backup file"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteItem(item)}
                              className="p-1 rounded-md text-rose-500 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                              title="Delete this backup"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Section 3: Manual Export & File Upload / Dropzone */}
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start gap-2.5">
                <ArchiveRestore className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Export to File &amp; Restore from Upload
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Download an offline JSON file to your device, or drag and drop an existing Radiarr backup file to restore it.
                  </p>
                </div>
              </div>

              <a
                href="/api/backup/export"
                download
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-white text-white dark:text-zinc-900 text-xs font-medium transition cursor-pointer shadow-xs whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export JSON to Device</span>
              </a>
            </div>

            <input
              ref={backupFileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => void handleRestoreFile(e.target.files?.[0])}
              className="hidden"
            />

            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!isDraggingBackup) setIsDraggingBackup(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDraggingBackup(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDraggingBackup(false);
                const droppedFile = e.dataTransfer.files?.[0];
                void handleRestoreFile(droppedFile);
              }}
              onClick={() => backupFileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  backupFileInputRef.current?.click();
                }
              }}
              className={`rounded-xl border-2 border-dashed p-6 text-center transition cursor-pointer select-none ${
                isDraggingBackup
                  ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40'
                  : 'border-zinc-300 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40'
              }`}
            >
              <div className="flex flex-col items-center justify-center gap-2">
                <div className="w-9 h-9 rounded-full bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <Upload className="w-4 h-4" />
                </div>
                <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                  {isRestoring
                    ? 'Restoring backup into database...'
                    : 'Drag and drop a radiarr-backup.json file here, or click to browse'}
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Instantly restores all channels, schedules, and scanned metadata from any saved file.
                </p>
              </div>
            </div>

            {backupMessage && (
              <div
                className={`px-3.5 py-2.5 rounded-xl text-xs border ${
                  backupMessage.ok
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
                    : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-900'
                }`}
              >
                {backupMessage.text}
              </div>
            )}
          </section>

          {/* Confirm Restore Modal */}
          {confirmRestoreItem && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-xl">
                <div className="flex items-center gap-2.5 text-amber-500">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Confirm Database Restore
                  </h3>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  Are you sure you want to restore the backup{' '}
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    &quot;{confirmRestoreItem.filename}&quot;
                  </span>
                  ? This will replace your current channels, schedules, and library index with the snapshot data.
                </p>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setConfirmRestoreItem(null)}
                    className="px-3.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRestoreStoredFile(confirmRestoreItem)}
                    className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition cursor-pointer shadow-xs"
                  >
                    Confirm &amp; Restore
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Confirm Delete Modal */}
          {confirmDeleteItem && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-xl">
                <div className="flex items-center gap-2.5 text-rose-500">
                  <Trash2 className="w-5 h-5 shrink-0" />
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Delete Stored Backup
                  </h3>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  Are you sure you want to permanently delete{' '}
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    &quot;{confirmDeleteItem.filename}&quot;
                  </span>
                  ? This action cannot be undone.
                </p>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteItem(null)}
                    className="px-3.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteStoredFile(confirmDeleteItem)}
                    className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium transition cursor-pointer shadow-xs"
                  >
                    Delete File
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 4: Users & Security */}
      {activeSubTab === 'users' && (
        <UsersManagementTab />
      )}

      {/* SUB-TAB 5: Playback Diagnostics & System Logs */}
      {activeSubTab === 'diagnostics' && (
        <ErrorBoundary fallbackTitle="Diagnostics & Logs Error">
          <DiagnosticsTab
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            stations={stations}
          />
        </ErrorBoundary>
      )}

      {/* Standalone Desktop Application Information Modal */}
      {showDesktopInfoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-lg w-full p-5 sm:p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm shrink-0">
                  <Monitor className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                    Radiarr Desktop App
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Available for Windows, macOS, and Linux
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDesktopInfoModal(false)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-lg leading-none p-1 cursor-pointer"
              >
                &times;
              </button>
            </div>

            <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              Radiarr is fully supported both as a <strong>Docker Compose / Docker Desktop container</strong> (ideal for home servers, unRAID, TrueNAS, and Synology) and as <strong>standalone native desktop applications</strong> for Windows, macOS, and Linux. Choose whichever platform fits your workflow best.
            </p>

            <div className="space-y-2.5 text-xs text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/60 p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800">
              <div className="flex items-start gap-2.5">
                <FolderOpen className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-semibold text-zinc-900 dark:text-zinc-100">Native OS Folder Chooser:</strong>
                  <span className="text-zinc-500 dark:text-zinc-400 ml-1">
                    Pick your music libraries with standard Windows File Explorer or macOS Finder dialogs.
                  </span>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Disc className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-semibold text-zinc-900 dark:text-zinc-100">System Tray Background Playback:</strong>
                  <span className="text-zinc-500 dark:text-zinc-400 ml-1">
                    Closing the window minimizes to your system tray / menu bar so live radio continues playing uninterrupted.
                  </span>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Server className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-semibold text-zinc-900 dark:text-zinc-100">Multi-Device LAN Streaming:</strong>
                  <span className="text-zinc-500 dark:text-zinc-400 ml-1">
                    Your desktop app also broadcasts to your mobile phone, car, and IPTV players on your home WiFi.
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Formats: <code className="font-mono text-zinc-700 dark:text-zinc-300">.exe</code>, <code className="font-mono text-zinc-700 dark:text-zinc-300">.dmg</code>, <code className="font-mono text-zinc-700 dark:text-zinc-300">.AppImage</code>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowDesktopInfoModal(false)}
                  className="px-3.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                >
                  Close
                </button>
                <a
                  href="https://github.com/peanutismint/radiarr/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition cursor-pointer shadow-xs"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>GitHub Releases</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HoldTimingTester({
  thresholdMs,
  isHoldToTrack,
}: {
  thresholdMs: number;
  isHoldToTrack: boolean;
}) {
  const [isPressing, setIsPressing] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<'single_tap' | 'double_tap' | 'hold' | null>(null);
  const pressStartRef = useRef<number | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const singleTapTimeoutRef = useRef<number | null>(null);
  const lastReleaseTimeRef = useRef<number>(0);

  const startPress = () => {
    const now = Date.now();
    pressStartRef.current = now;
    setIsPressing(true);
    setElapsedMs(0);

    // If a pending single-tap is waiting and a second press arrives within threshold: detected double-tap!
    if (singleTapTimeoutRef.current !== null && now - lastReleaseTimeRef.current <= thresholdMs) {
      window.clearTimeout(singleTapTimeoutRef.current);
      singleTapTimeoutRef.current = null;
      setResult('double_tap');
    } else {
      setResult(null);
    }

    const update = () => {
      if (pressStartRef.current !== null) {
        const cur = Date.now() - pressStartRef.current;
        setElapsedMs(cur);
        if (cur >= thresholdMs) {
          setResult('hold');
        }
        animFrameRef.current = requestAnimationFrame(update);
      }
    };
    animFrameRef.current = requestAnimationFrame(update);
  };

  const endPress = () => {
    const now = Date.now();
    if (pressStartRef.current !== null) {
      const finalDuration = now - pressStartRef.current;
      pressStartRef.current = null;
      lastReleaseTimeRef.current = now;
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      setIsPressing(false);
      setElapsedMs(finalDuration);

      if (finalDuration >= thresholdMs) {
        setResult('hold');
        if (singleTapTimeoutRef.current !== null) {
          window.clearTimeout(singleTapTimeoutRef.current);
          singleTapTimeoutRef.current = null;
        }
      } else if (result !== 'double_tap') {
        // Wait to see if a second click arrives within thresholdMs
        if (singleTapTimeoutRef.current !== null) {
          window.clearTimeout(singleTapTimeoutRef.current);
        }
        singleTapTimeoutRef.current = window.setTimeout(() => {
          singleTapTimeoutRef.current = null;
          setResult('single_tap');
        }, thresholdMs);
      }
    }
  };

  useEffect(() => {
    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (singleTapTimeoutRef.current !== null) {
        window.clearTimeout(singleTapTimeoutRef.current);
      }
    };
  }, []);

  const progressPct = Math.min(100, Math.round((elapsedMs / thresholdMs) * 100));

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        <button
          type="button"
          onMouseDown={startPress}
          onMouseUp={endPress}
          onMouseLeave={() => {
            if (isPressing) endPress();
          }}
          onTouchStart={startPress}
          onTouchEnd={endPress}
          className={`px-4 py-2.5 rounded-xl text-xs font-semibold select-none transition cursor-pointer flex items-center justify-center gap-2 ${
            isPressing
              ? 'bg-indigo-600 text-white scale-[0.98] shadow-inner'
              : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700'
          }`}
        >
          <span>
            {isPressing
              ? elapsedMs >= thresholdMs
                ? 'Hold Threshold Met!'
                : 'Holding...'
              : 'Double-Click Quickly OR Press & Hold'}
          </span>
          <span className="font-mono text-[10px] opacity-80">{elapsedMs}ms</span>
        </button>

        <div className="flex-1 min-w-0">
          <div className="h-2 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden border border-zinc-200 dark:border-zinc-700">
            <div
              className={`h-full transition-all ${
                elapsedMs >= thresholdMs || result === 'double_tap'
                  ? 'bg-emerald-500'
                  : 'bg-indigo-600 dark:bg-indigo-500'
              }`}
              style={{ width: `${result === 'double_tap' ? 100 : progressPct}%` }}
            />
          </div>
        </div>

        <div className="min-w-[170px] text-right">
          {result === 'single_tap' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400">
              TAP → {isHoldToTrack ? 'Switch Station' : 'Skip Track'}
            </span>
          )}
          {result === 'double_tap' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-semibold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 animate-in zoom-in-95 duration-100">
              ⚡ DOUBLE-TAP → {isHoldToTrack ? 'Skip Track' : 'Switch Station'}
            </span>
          )}
          {result === 'hold' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-semibold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
              HOLD → {isHoldToTrack ? 'Skip Track' : 'Switch Station'}
            </span>
          )}
          {result === null && !isPressing && (
            <span className="text-[10px] text-zinc-400 font-mono">
              Window: {thresholdMs}ms
            </span>
          )}
          {isPressing && (
            <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 font-semibold">
              {elapsedMs >= thresholdMs ? 'Hold Triggered!' : `${thresholdMs - elapsedMs}ms to hold`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}


