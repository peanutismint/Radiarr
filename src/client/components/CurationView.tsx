import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  Edit3,
  GripVertical,
  Image as ImageIcon,
  MinusSquare,
  Moon,
  Palette,
  Plus,
  Power,
  Search,
  Shuffle,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildStationRuleSummaryPills,
  computeBatchMovedIds,
  computeBatchMovedToTarget,
  CUSTOM_SWATCH_PALETTE,
  getCategoryVisuals,
  inferStationCategory,
  resolveStationTileColor,
  STATION_CATEGORY_FORMULA,
} from '../../shared/stationVisuals.ts';
import {
  CROSSFADE_DURATION_OPTIONS,
  type CrossfadeDurationSeconds,
  type CurationMetadataOptions,
  type PlayMode,
  type ServerSettings,
  type StarterSuggestion,
  type StationPreviewResponse,
  type StationRules,
  type StationWithStats,
} from '../../shared/types.ts';
import { ChannelBadge, StationCategoryPill } from './ChannelBadge.tsx';
import { apiFetch } from '../utils/apiInterceptor.ts';
import { useAppearance } from '../hooks/useAppearance.ts';

interface CurationViewProps {
  settings: ServerSettings | null;
  initialEditStationId?: string | null;
  onClearInitialEditStationId?: () => void;
  onStationsChanged: () => void;
}

function inferDefaultCrossfade(playMode: PlayMode, rules: StationRules): boolean {
  if (playMode !== 'shuffle') return false;
  if (rules.albums && rules.albums.length > 0) return false;
  return true;
}

function formatDurationHoursAndMins(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Resizes and center-crops an uploaded image file to a crisp 256x256 JPEG data URL
 * so custom channel thumbnails remain lightweight in SQLite and load instantaneously.
 */
async function compressImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file'));
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        const minSide = Math.min(img.width, img.height);
        const sx = Math.max(0, (img.width - minSide) / 2);
        const sy = Math.max(0, (img.height - minSide) / 2);
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function CurationView({
  settings,
  initialEditStationId,
  onClearInitialEditStationId,
  onStationsChanged,
}: CurationViewProps) {
  const [stations, setStations] = useState<StationWithStats[]>([]);
  const [options, setOptions] = useState<CurationMetadataOptions | null>(null);
  const [suggestions, setSuggestions] = useState<StarterSuggestion[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Drag & drop reorder state
  const [draggedStationId, setDraggedStationId] = useState<string | null>(null);
  const [dragOverStationId, setDragOverStationId] = useState<string | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<'before' | 'after' | null>(
    null
  );

  // Controlled auto-scrolling while dragging near top or bottom edge of viewport
  const dragScrollSpeedRef = useRef<number>(0);
  const dragScrollAnimRef = useRef<number | null>(null);

  useEffect(() => {
    if (!draggedStationId) {
      dragScrollSpeedRef.current = 0;
      if (dragScrollAnimRef.current !== null) {
        cancelAnimationFrame(dragScrollAnimRef.current);
        dragScrollAnimRef.current = null;
      }
      return;
    }

    const SCROLL_ZONE_PX = 90; // Activation distance from edge of viewport
    const MAX_SCROLL_SPEED = 6; // Max px per frame (~360px/s) - gentle and controlled

    const handleWindowDragOver = (e: DragEvent) => {
      e.preventDefault();
      const clientY = e.clientY;
      const viewportHeight = window.innerHeight;

      if (clientY < SCROLL_ZONE_PX) {
        // Dragging near top
        const intensity = Math.max(0, Math.min(1, (SCROLL_ZONE_PX - clientY) / SCROLL_ZONE_PX));
        dragScrollSpeedRef.current = -Math.round(2 + intensity * (MAX_SCROLL_SPEED - 2));
      } else if (clientY > viewportHeight - SCROLL_ZONE_PX) {
        // Dragging near bottom
        const intensity = Math.max(0, Math.min(1, (clientY - (viewportHeight - SCROLL_ZONE_PX)) / SCROLL_ZONE_PX));
        dragScrollSpeedRef.current = Math.round(2 + intensity * (MAX_SCROLL_SPEED - 2));
      } else {
        dragScrollSpeedRef.current = 0;
      }
    };

    const stopDragScroll = () => {
      dragScrollSpeedRef.current = 0;
      if (dragScrollAnimRef.current !== null) {
        cancelAnimationFrame(dragScrollAnimRef.current);
        dragScrollAnimRef.current = null;
      }
    };

    const scrollLoop = () => {
      if (dragScrollSpeedRef.current !== 0) {
        window.scrollBy({ top: dragScrollSpeedRef.current, behavior: 'instant' });
        if (document.scrollingElement) {
          document.scrollingElement.scrollBy({ top: dragScrollSpeedRef.current, behavior: 'instant' });
        }
      }
      dragScrollAnimRef.current = requestAnimationFrame(scrollLoop);
    };

    dragScrollAnimRef.current = requestAnimationFrame(scrollLoop);
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('dragend', stopDragScroll);
    window.addEventListener('drop', stopDragScroll);

    return () => {
      stopDragScroll();
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('dragend', stopDragScroll);
      window.removeEventListener('drop', stopDragScroll);
    };
  }, [draggedStationId]);

  // Station Editor State (null = closed, 'new' = creating new station, or stationId = editing existing)
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [editorName, setEditorName] = useState<string>('');
  const [editorPlayMode, setEditorPlayMode] = useState<PlayMode>('shuffle');
  const [editorRules, setEditorRules] = useState<StationRules>({});
  const [editorEnabled, setEditorEnabled] = useState<boolean>(true);
  const [editorSmartUpdate, setEditorSmartUpdate] = useState<boolean>(true);
  const [editorCrossfadeEnabled, setEditorCrossfadeEnabled] = useState<boolean>(true);
  const [editorCrossfadeSeconds, setEditorCrossfadeSeconds] =
    useState<CrossfadeDurationSeconds>(5);
  const [crossfadeTouched, setCrossfadeTouched] = useState<boolean>(false);
  const [editorDaypartsEnabled, setEditorDaypartsEnabled] = useState<boolean>(false);

  // Custom Thumbnail & Color Formula State
  const [editorThumbnailUrl, setEditorThumbnailUrl] = useState<string>('');
  const [editorCustomColor, setEditorCustomColor] = useState<boolean>(false);
  const [editorTileColor, setEditorTileColor] = useState<string>('#4f46e5');
  const thumbFileInputRef = useRef<HTMLInputElement | null>(null);

  const [advancedOpen, setAdvancedOpen] = useState<boolean>(true);
  const [preview, setPreview] = useState<StationPreviewResponse | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [artistSearch, setArtistSearch] = useState<string>('');
  const [albumSearch, setAlbumSearch] = useState<string>('');
  const [genreSearch, setGenreSearch] = useState<string>('');
  const { appearance } = useAppearance();

  const clearSearchFilters = useCallback(() => {
    setArtistSearch('');
    setAlbumSearch('');
    setGenreSearch('');
  }, []);

  const closeEditorModal = useCallback(() => {
    if (appearance.clearCurationSearchOnClose) {
      clearSearchFilters();
    }
    setEditingId(null);
  }, [appearance.clearCurationSearchOnClose, clearSearchFilters]);

  // When editor closes or changes from any source, ensure search filters clear if preference is enabled
  const prevEditingIdRef = useRef<string | 'new' | null>(null);
  const thumbnailTouchedRef = useRef<boolean>(false);
  useEffect(() => {
    if (prevEditingIdRef.current && !editingId && appearance.clearCurationSearchOnClose) {
      clearSearchFilters();
    }
    prevEditingIdRef.current = editingId;
  }, [editingId, appearance.clearCurationSearchOnClose, clearSearchFilters]);

  const [suggestionFilter, setSuggestionFilter] = useState<
    'all' | 'genre' | 'decade' | 'artist'
  >('all');
  const [isRegeneratingAll, setIsRegeneratingAll] = useState<boolean>(false);
  const [regeneratingStationId, setRegeneratingStationId] = useState<string | null>(null);
  const [regenerateToast, setRegenerateToast] = useState<string | null>(null);

  // Bulk selection & batch operations state
  const [selectedStationIds, setSelectedStationIds] = useState<Set<string>>(new Set());
  const [batchActionLoading, setBatchActionLoading] = useState<boolean>(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState<boolean>(false);
  const [showPlayModeMenu, setShowPlayModeMenu] = useState<boolean>(false);
  const [showMoveMenu, setShowMoveMenu] = useState<boolean>(false);

  const selectedArtistsSet = useMemo(
    () => new Set(editorRules.artists || []),
    [editorRules.artists]
  );
  const selectedAlbumsSet = useMemo(
    () => new Set(editorRules.albums || []),
    [editorRules.albums]
  );
  const selectedGenresSet = useMemo(
    () => new Set(editorRules.genres || []),
    [editorRules.genres]
  );

  // Live category & badge color computed for the station currently being edited
  const editorCategory = useMemo(
    () => inferStationCategory(editorPlayMode, editorRules, editorSmartUpdate),
    [editorPlayMode, editorRules, editorSmartUpdate]
  );

  const editorCategoryVisuals = useMemo(
    () => getCategoryVisuals(editorPlayMode, editorRules, editorSmartUpdate),
    [editorPlayMode, editorRules, editorSmartUpdate]
  );

  const effectiveEditorTileColor = useMemo(
    () =>
      resolveStationTileColor(
        editorPlayMode,
        { ...editorRules, smartUpdate: editorSmartUpdate },
        editorTileColor,
        editorCustomColor
      ),
    [editorPlayMode, editorRules, editorSmartUpdate, editorTileColor, editorCustomColor]
  );

  const editorChannelNumber = useMemo(() => {
    if (editingId === 'new') return stations.length + 1;
    const found = stations.find((s) => s.id === editingId);
    return found ? found.channelNumber : 1;
  }, [editingId, stations]);

  const visibleArtists = useMemo(() => {
    const all = options?.artists || [];
    const q = artistSearch.trim().toLowerCase();
    const filtered = q ? all.filter((a) => a.toLowerCase().includes(q)) : all;
    const selected = filtered.filter((a) => selectedArtistsSet.has(a));
    const unselected = filtered.filter((a) => !selectedArtistsSet.has(a));
    return {
      items: [...selected, ...unselected.slice(0, Math.max(0, 120 - selected.length))],
      totalMatches: filtered.length,
    };
  }, [options?.artists, artistSearch, selectedArtistsSet]);

  const visibleAlbums = useMemo(() => {
    const all = options?.albums || [];
    const q = albumSearch.trim().toLowerCase();
    const filtered = q
      ? all.filter(
          (alb) =>
            alb.title.toLowerCase().includes(q) ||
            alb.artist.toLowerCase().includes(q)
        )
      : all;
    const selected = filtered.filter((alb) => selectedAlbumsSet.has(alb.title));
    const unselected = filtered.filter((alb) => !selectedAlbumsSet.has(alb.title));
    return {
      items: [...selected, ...unselected.slice(0, Math.max(0, 100 - selected.length))],
      totalMatches: filtered.length,
    };
  }, [options?.albums, albumSearch, selectedAlbumsSet]);

  const visibleGenres = useMemo(() => {
    const all = options?.genres || [];
    const q = genreSearch.trim().toLowerCase();
    const filtered = q ? all.filter((g) => g.toLowerCase().includes(q)) : all;
    const selected = filtered.filter((g) => selectedGenresSet.has(g));
    const unselected = filtered.filter((g) => !selectedGenresSet.has(g));
    return {
      items: [...selected, ...unselected.slice(0, Math.max(0, 100 - selected.length))],
      totalMatches: filtered.length,
    };
  }, [options?.genres, genreSearch, selectedGenresSet]);

  const filteredSuggestions = useMemo(() => {
    const artists = suggestions.filter((s) => s.category === 'artist');
    const shuffles = suggestions.filter(
      (s) => s.category === 'genre' || s.category === 'decade'
    );

    if (suggestionFilter === 'all') {
      return [...artists.slice(0, 8), ...shuffles.slice(0, 8)];
    }
    if (suggestionFilter === 'artist') {
      return artists.slice(0, 8);
    }
    return suggestions
      .filter((s) => s.category === suggestionFilter)
      .slice(0, 8);
  }, [suggestions, suggestionFilter]);

  const loadCurationData = useCallback(async () => {
    try {
      const [stRes, optRes, sugRes] = await Promise.all([
        apiFetch('/api/stations'),
        apiFetch('/api/curation/options'),
        apiFetch('/api/suggestions'),
      ]);
      if (stRes.ok) {
        const stData: { stations: StationWithStats[] } = await stRes.json();
        setStations(stData.stations);
      }
      if (optRes.ok) {
        const optData: CurationMetadataOptions = await optRes.json();
        setOptions(optData);
      }
      if (sugRes.ok) {
        const sugData: { suggestions: StarterSuggestion[] } = await sugRes.json();
        setSuggestions(sugData.suggestions);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCurationData();
  }, [loadCurationData]);

  // Live preview whenever the editor is open and rules change
  useEffect(() => {
    if (!editingId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const fetchPreview = async () => {
      try {
        const res = await apiFetch('/api/stations/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rules: editorRules }),
        });
        if (!res.ok || cancelled) return;
        const data: StationPreviewResponse = await res.json();
        if (!cancelled) {
          setPreview(data);
          if (
            editingId === 'new' &&
            !thumbnailTouchedRef.current &&
            (!editorThumbnailUrl || !editorThumbnailUrl.trim())
          ) {
            if (data.sampleArtworks && data.sampleArtworks.length > 0) {
              setEditorThumbnailUrl(data.sampleArtworks[0].artUrl);
            }
          }
        }
      } catch {
        // ignore
      }
    };
    void fetchPreview();
    return () => {
      cancelled = true;
    };
  }, [editingId, editorRules, editorThumbnailUrl]);

  const openNewStationEditor = () => {
    thumbnailTouchedRef.current = false;
    if (appearance.clearCurationSearchOnClose) {
      clearSearchFilters();
    }
    const defaultMode: PlayMode = settings?.defaultPlayMode || 'shuffle';
    const initialRules: StationRules = {
      libraryIds:
        settings?.defaultLibraryIds && settings.defaultLibraryIds.length > 0
          ? [...settings.defaultLibraryIds]
          : [],
      artists: [],
      albums: [],
      genres: [],
      yearMin: null,
      yearMax: null,
    };
    const defaultSmart = settings?.defaultSmartUpdate !== false;
    const autoColor = getCategoryVisuals(defaultMode, initialRules, defaultSmart).color;

    setEditingId('new');
    setEditorName('');
    setEditorPlayMode(defaultMode);
    setEditorRules(initialRules);
    setEditorEnabled(true);
    setEditorSmartUpdate(defaultSmart);
    setEditorCrossfadeEnabled(inferDefaultCrossfade(defaultMode, initialRules));
    setEditorCrossfadeSeconds(5);
    setCrossfadeTouched(false);
    setEditorDaypartsEnabled(false);
    setEditorThumbnailUrl('');
    setEditorCustomColor(false);
    setEditorTileColor(autoColor);
    setAdvancedOpen(true);
  };

  const openEditStationEditor = useCallback(
    (station: StationWithStats) => {
      if (appearance.clearCurationSearchOnClose) {
        clearSearchFilters();
      }
      setEditingId(station.id);
      setEditorName(station.name);
      setEditorPlayMode(station.playMode);
      setEditorRules({
        libraryIds: station.rules.libraryIds || [],
        artists: station.rules.artists || [],
        albums: station.rules.albums || [],
        genres: station.rules.genres || [],
        yearMin: station.rules.yearMin ?? null,
        yearMax: station.rules.yearMax ?? null,
      });
      setEditorEnabled(station.enabled);
      setEditorSmartUpdate(station.smartUpdate);
      setEditorCrossfadeEnabled(station.crossfadeEnabled);
      setEditorCrossfadeSeconds(
        (CROSSFADE_DURATION_OPTIONS.includes(
          station.crossfadeSeconds as CrossfadeDurationSeconds
        )
          ? station.crossfadeSeconds
          : 5) as CrossfadeDurationSeconds
      );
      setCrossfadeTouched(true);
      setEditorDaypartsEnabled(Boolean(station.daypartsEnabled));
      thumbnailTouchedRef.current = true;
      setEditorThumbnailUrl(station.thumbnailUrl || '');
      setEditorCustomColor(Boolean(station.customColor));
      setEditorTileColor(station.tileColor || '#4f46e5');
      setAdvancedOpen(true);
    },
    [appearance.clearCurationSearchOnClose, clearSearchFilters]
  );

  // Automatically open station editor when navigated via the EPG 'Edit' button shortcut
  useEffect(() => {
    if (!initialEditStationId || stations.length === 0) return;
    const target = stations.find((s) => s.id === initialEditStationId);
    if (target) {
      openEditStationEditor(target);
      onClearInitialEditStationId?.();
    }
  }, [
    initialEditStationId,
    stations,
    openEditStationEditor,
    onClearInitialEditStationId,
  ]);

  // Lock background scroll & support Escape key when Station Editor modal is open
  useEffect(() => {
    if (!editingId) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeEditorModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [editingId, closeEditorModal]);

  const handleUploadThumbnailFile = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setEditorThumbnailUrl(dataUrl);
    } catch {
      // ignore invalid image
    } finally {
      if (thumbFileInputRef.current) {
        thumbFileInputRef.current.value = '';
      }
    }
  };

  const handleSaveStation = async () => {
    if (!editorName.trim()) return;
    setSaving(true);
    try {
      const trimmedThumb = editorThumbnailUrl.trim() || null;
      const cleanedRules: StationRules = {
        crossfadeEnabled: editorCrossfadeEnabled,
        crossfadeSeconds: editorCrossfadeSeconds,
        customColor: editorCustomColor,
        thumbnailUrl: trimmedThumb,
      };
      if (editorRules.libraryIds && editorRules.libraryIds.length > 0) {
        cleanedRules.libraryIds = editorRules.libraryIds;
      }
      if (editorRules.artists && editorRules.artists.length > 0) {
        cleanedRules.artists = editorRules.artists;
      }
      if (editorRules.albums && editorRules.albums.length > 0) {
        cleanedRules.albums = editorRules.albums;
      }
      if (editorRules.genres && editorRules.genres.length > 0) {
        cleanedRules.genres = editorRules.genres;
      }
      if (
        typeof editorRules.yearMin === 'number' &&
        Number.isFinite(editorRules.yearMin)
      ) {
        cleanedRules.yearMin = editorRules.yearMin;
      }
      if (
        typeof editorRules.yearMax === 'number' &&
        Number.isFinite(editorRules.yearMax)
      ) {
        cleanedRules.yearMax = editorRules.yearMax;
      }

      const payload = {
        name: editorName.trim(),
        playMode: editorPlayMode,
        rules: cleanedRules,
        enabled: editorEnabled,
        smartUpdate: editorSmartUpdate,
        crossfadeEnabled: editorCrossfadeEnabled,
        crossfadeSeconds: editorCrossfadeSeconds,
        daypartsEnabled: editorDaypartsEnabled,
        tileColor: effectiveEditorTileColor,
        customColor: editorCustomColor,
        thumbnailUrl: trimmedThumb,
      };

      if (editingId === 'new') {
        await apiFetch('/api/stations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else if (editingId) {
        await apiFetch(`/api/stations/${encodeURIComponent(editingId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (appearance.clearCurationSearchOnClose) {
        clearSearchFilters();
      }
      setEditingId(null);
      await loadCurationData();
      onStationsChanged();
    } finally {
      setSaving(false);
    }
  };

  const persistReorderedStations = async (reordered: StationWithStats[]) => {
    const withUpdatedNumbers = reordered.map((s, idx) => ({
      ...s,
      channelNumber: idx + 1,
    }));
    setStations(withUpdatedNumbers);

    const orderedIds = withUpdatedNumbers.map((s) => s.id);
    await apiFetch('/api/stations/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    });
    await loadCurationData();
    onStationsChanged();
  };

  const handleMoveChannel = async (index: number, direction: -1 | 1) => {
    const currentStation = stations[index];
    if (!currentStation) return;

    const isBatch = selectedStationIds.has(currentStation.id) && selectedStationIds.size > 1;

    if (isBatch) {
      const orderedIds = stations.map((s) => s.id);
      const dirName = direction === -1 ? 'up' : 'down';
      const newIds = computeBatchMovedIds(
        orderedIds,
        Array.from(selectedStationIds),
        dirName
      );
      const unchanged = newIds.every((id, idx) => id === orderedIds[idx]);
      if (unchanged) return;

      const stationMap = new Map(stations.map((s) => [s.id, s]));
      const reordered = newIds.map((id) => stationMap.get(id)!);
      await persistReorderedStations(reordered);
      setRegenerateToast(
        `Shifted ${selectedStationIds.size} stations ${dirName}.`
      );
      setTimeout(() => setRegenerateToast(null), 3000);
    } else {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= stations.length) return;
      const reordered = [...stations];
      const tmp = reordered[index];
      reordered[index] = reordered[targetIndex];
      reordered[targetIndex] = tmp;

      await persistReorderedStations(reordered);
    }
  };

  const handleDragStart = (e: React.DragEvent, stationId: string) => {
    setDraggedStationId(stationId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', stationId);

    const isBatch = selectedStationIds.has(stationId) && selectedStationIds.size > 1;
    if (isBatch) {
      e.dataTransfer.setData('application/x-radiarr-batch-count', String(selectedStationIds.size));

      try {
        const badge = document.createElement('div');
        badge.style.position = 'fixed';
        badge.style.top = '-9999px';
        badge.style.left = '-9999px';
        badge.style.padding = '6px 12px';
        badge.style.borderRadius = '8px';
        badge.style.backgroundColor = '#4f46e5';
        badge.style.color = '#ffffff';
        badge.style.fontSize = '12px';
        badge.style.fontWeight = '600';
        badge.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.3)';
        badge.style.display = 'flex';
        badge.style.alignItems = 'center';
        badge.style.gap = '6px';
        badge.style.pointerEvents = 'none';
        badge.style.zIndex = '9999';
        badge.textContent = `Moving ${selectedStationIds.size} stations`;
        document.body.appendChild(badge);
        e.dataTransfer.setDragImage(badge, 20, 16);
        setTimeout(() => {
          if (badge.parentNode) badge.parentNode.removeChild(badge);
        }, 0);
      } catch {
        // Fallback gracefully if setDragImage fails
      }
    }
  };

  const handleDragOver = (e: React.DragEvent, targetStationId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!draggedStationId) return;

    const isBatch = selectedStationIds.has(draggedStationId) && selectedStationIds.size > 1;
    if (!isBatch && draggedStationId === targetStationId) {
      if (dragOverStationId !== null) {
        setDragOverStationId(null);
        setDragOverPosition(null);
      }
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const nextPos: 'before' | 'after' = e.clientY < midpoint ? 'before' : 'after';

    if (dragOverStationId !== targetStationId || dragOverPosition !== nextPos) {
      setDragOverStationId(targetStationId);
      setDragOverPosition(nextPos);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetStationId: string) => {
    e.preventDefault();
    dragScrollSpeedRef.current = 0;
    const sourceId = draggedStationId || e.dataTransfer.getData('text/plain');
    const dropPos = dragOverPosition || 'after';

    setDraggedStationId(null);
    setDragOverStationId(null);
    setDragOverPosition(null);

    if (!sourceId) return;

    const isBatch = selectedStationIds.has(sourceId) && selectedStationIds.size > 1;
    const orderedIds = stations.map((s) => s.id);

    let newIds: string[];
    if (isBatch) {
      newIds = computeBatchMovedToTarget(
        orderedIds,
        Array.from(selectedStationIds),
        targetStationId,
        dropPos
      );
    } else {
      if (sourceId === targetStationId) return;
      const fromIndex = stations.findIndex((s) => s.id === sourceId);
      if (fromIndex === -1) return;

      const reordered = [...stations];
      const [moved] = reordered.splice(fromIndex, 1);
      let insertIndex = reordered.findIndex((s) => s.id === targetStationId);
      if (insertIndex === -1) return;
      if (dropPos === 'after') {
        insertIndex += 1;
      }
      reordered.splice(insertIndex, 0, moved);
      newIds = reordered.map((s) => s.id);
    }

    const unchanged = newIds.every((id, idx) => id === orderedIds[idx]);
    if (unchanged) return;

    const stationMap = new Map(stations.map((s) => [s.id, s]));
    const reorderedStations = newIds.map((id) => stationMap.get(id)!);

    await persistReorderedStations(reorderedStations);

    if (isBatch) {
      setRegenerateToast(
        `Moved ${selectedStationIds.size} stations together.`
      );
      setTimeout(() => setRegenerateToast(null), 3000);
    }
  };

  const handleDragEnd = () => {
    dragScrollSpeedRef.current = 0;
    setDraggedStationId(null);
    setDragOverStationId(null);
    setDragOverPosition(null);
  };

  const handleToggleStationEnabled = async (station: StationWithStats) => {
    await apiFetch(`/api/stations/${encodeURIComponent(station.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !station.enabled }),
    });
    await loadCurationData();
    onStationsChanged();
  };

  const handleDuplicateStation = async (stationId: string) => {
    await apiFetch(`/api/stations/${encodeURIComponent(stationId)}/duplicate`, {
      method: 'POST',
    });
    await loadCurationData();
    onStationsChanged();
  };

  const handleDeleteStation = async (stationId: string) => {
    await apiFetch(`/api/stations/${encodeURIComponent(stationId)}`, {
      method: 'DELETE',
    });
    if (editingId === stationId) {
      setEditingId(null);
    }
    await loadCurationData();
    onStationsChanged();
  };

  const handleRegenerateAll = async () => {
    setIsRegeneratingAll(true);
    try {
      const res = await apiFetch('/api/stations/regenerate', { method: 'POST' });
      if (res.ok) {
        setRegenerateToast('All station schedules have been regenerated with fresh random seeds!');
        await loadCurationData();
        onStationsChanged();
        setTimeout(() => setRegenerateToast(null), 4000);
      }
    } catch (e) {
      console.warn('Failed to regenerate stations:', e);
    } finally {
      setIsRegeneratingAll(false);
    }
  };

  const handleRegenerateStation = async (station: StationWithStats) => {
    setRegeneratingStationId(station.id);
    try {
      const res = await apiFetch(`/api/stations/${encodeURIComponent(station.id)}/regenerate`, {
        method: 'POST',
      });
      if (res.ok) {
        setRegenerateToast(`Schedule for "${station.name}" regenerated with a fresh random seed!`);
        await loadCurationData();
        onStationsChanged();
        setTimeout(() => setRegenerateToast(null), 4000);
      }
    } catch (e) {
      console.warn('Failed to regenerate station:', e);
    } finally {
      setRegeneratingStationId(null);
    }
  };

  // Sync selected IDs when stations change
  useEffect(() => {
    setSelectedStationIds((prev) => {
      if (prev.size === 0) return prev;
      const currentIds = new Set(stations.map((s) => s.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (currentIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [stations]);

  // Close menus on outside click or escape
  useEffect(() => {
    if (!showPlayModeMenu && !showMoveMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.batch-menu-trigger') && !target?.closest('.batch-menu-popover')) {
        setShowPlayModeMenu(false);
        setShowMoveMenu(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowPlayModeMenu(false);
        setShowMoveMenu(false);
      }
    };
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [showPlayModeMenu, showMoveMenu]);

  const isAllSelected = stations.length > 0 && selectedStationIds.size === stations.length;
  const isSomeSelected = selectedStationIds.size > 0 && selectedStationIds.size < stations.length;

  const canBatchMoveUp = useMemo(() => {
    if (selectedStationIds.size <= 1) return false;
    return Array.from(selectedStationIds).some((id) => {
      const i = stations.findIndex((s) => s.id === id);
      return i > 0 && !selectedStationIds.has(stations[i - 1]?.id);
    });
  }, [selectedStationIds, stations]);

  const canBatchMoveDown = useMemo(() => {
    if (selectedStationIds.size <= 1) return false;
    return Array.from(selectedStationIds).some((id) => {
      const i = stations.findIndex((s) => s.id === id);
      return i < stations.length - 1 && !selectedStationIds.has(stations[i + 1]?.id);
    });
  }, [selectedStationIds, stations]);

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedStationIds(new Set());
    } else {
      setSelectedStationIds(new Set(stations.map((s) => s.id)));
    }
  };

  const handleToggleSelectStation = (stationId: string, e?: React.MouseEvent | React.ChangeEvent) => {
    e?.stopPropagation();
    setSelectedStationIds((prev) => {
      const next = new Set(prev);
      if (next.has(stationId)) {
        next.delete(stationId);
      } else {
        next.add(stationId);
      }
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedStationIds(new Set());
  };

  const handleBatchMove = async (direction: 'top' | 'bottom' | 'up' | 'down') => {
    if (selectedStationIds.size === 0) return;
    setBatchActionLoading(true);
    try {
      const res = await apiFetch('/api/stations/batch/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selectedStationIds),
          direction,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.stations) {
          setStations(data.stations);
        }
        await loadCurationData();
        onStationsChanged();
        setShowMoveMenu(false);
        setRegenerateToast(
          `Moved ${selectedStationIds.size} station${selectedStationIds.size > 1 ? 's' : ''} ${direction}.`
        );
        setTimeout(() => setRegenerateToast(null), 3500);
      }
    } catch (e) {
      console.warn('Failed batch move:', e);
    } finally {
      setBatchActionLoading(false);
    }
  };

  const handleBatchDuplicate = async () => {
    if (selectedStationIds.size === 0) return;
    setBatchActionLoading(true);
    try {
      const res = await apiFetch('/api/stations/batch/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selectedStationIds),
        }),
      });
      if (res.ok) {
        await loadCurationData();
        onStationsChanged();
        setRegenerateToast(
          `Duplicated ${selectedStationIds.size} station${selectedStationIds.size > 1 ? 's' : ''}!`
        );
        setTimeout(() => setRegenerateToast(null), 3500);
      }
    } catch (e) {
      console.warn('Failed batch duplicate:', e);
    } finally {
      setBatchActionLoading(false);
    }
  };

  const handleBatchPlayMode = async (playMode: PlayMode) => {
    if (selectedStationIds.size === 0) return;
    setBatchActionLoading(true);
    try {
      const res = await apiFetch('/api/stations/batch/play-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selectedStationIds),
          playMode,
        }),
      });
      if (res.ok) {
        await loadCurationData();
        onStationsChanged();
        setShowPlayModeMenu(false);
        const modeLabel =
          playMode === 'shuffle'
            ? 'Track Shuffle'
            : playMode === 'album_shuffle'
              ? 'Album Shuffle'
              : 'Sequential';
        setRegenerateToast(
          `Updated ${selectedStationIds.size} station${selectedStationIds.size > 1 ? 's' : ''} to ${modeLabel}!`
        );
        setTimeout(() => setRegenerateToast(null), 3500);
      }
    } catch (e) {
      console.warn('Failed batch play mode update:', e);
    } finally {
      setBatchActionLoading(false);
    }
  };

  const handleBatchToggleEnabled = async (enabled: boolean) => {
    if (selectedStationIds.size === 0) return;
    setBatchActionLoading(true);
    try {
      const res = await apiFetch('/api/stations/batch/toggle-enabled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selectedStationIds),
          enabled,
        }),
      });
      if (res.ok) {
        await loadCurationData();
        onStationsChanged();
        setRegenerateToast(
          `${enabled ? 'Enabled' : 'Disabled'} ${selectedStationIds.size} station${selectedStationIds.size > 1 ? 's' : ''}!`
        );
        setTimeout(() => setRegenerateToast(null), 3500);
      }
    } catch (e) {
      console.warn('Failed batch toggle enabled:', e);
    } finally {
      setBatchActionLoading(false);
    }
  };

  const handleBatchRegenerate = async () => {
    if (selectedStationIds.size === 0) return;
    setBatchActionLoading(true);
    try {
      const res = await apiFetch('/api/stations/batch/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selectedStationIds),
        }),
      });
      if (res.ok) {
        await loadCurationData();
        onStationsChanged();
        setRegenerateToast(
          `Regenerated schedules for ${selectedStationIds.size} selected station${selectedStationIds.size > 1 ? 's' : ''}!`
        );
        setTimeout(() => setRegenerateToast(null), 3500);
      }
    } catch (e) {
      console.warn('Failed batch regenerate:', e);
    } finally {
      setBatchActionLoading(false);
    }
  };

  const handleConfirmBatchDelete = async () => {
    if (selectedStationIds.size === 0) return;
    setBatchActionLoading(true);
    try {
      const count = selectedStationIds.size;
      const res = await apiFetch('/api/stations/batch/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selectedStationIds),
        }),
      });
      if (res.ok) {
        setSelectedStationIds(new Set());
        setShowBatchDeleteConfirm(false);
        if (editingId && selectedStationIds.has(editingId)) {
          setEditingId(null);
        }
        await loadCurationData();
        onStationsChanged();
        setRegenerateToast(`Deleted ${count} station${count > 1 ? 's' : ''}.`);
        setTimeout(() => setRegenerateToast(null), 3500);
      }
    } catch (e) {
      console.warn('Failed batch delete:', e);
    } finally {
      setBatchActionLoading(false);
    }
  };

  const handleAcceptSuggestion = async (sug: StarterSuggestion) => {
    await apiFetch('/api/stations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: sug.name,
        playMode: sug.playMode,
        rules: sug.rules,
        enabled: true,
        crossfadeEnabled: sug.crossfadeEnabled,
        crossfadeSeconds: sug.crossfadeSeconds,
      }),
    });
    await loadCurationData();
    onStationsChanged();
  };

  const handleDismissSuggestion = async (key: string) => {
    await apiFetch('/api/suggestions/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    await loadCurationData();
  };

  const toggleRuleArrayItem = (
    field: 'libraryIds' | 'artists' | 'albums' | 'genres',
    value: string
  ) => {
    setEditorRules((prev) => {
      const current = new Set(prev[field] || []);
      if (current.has(value)) {
        current.delete(value);
      } else {
        current.add(value);
      }
      const nextRules = {
        ...prev,
        [field]: [...current],
      };
      if (!crossfadeTouched) {
        setEditorCrossfadeEnabled(inferDefaultCrossfade(editorPlayMode, nextRules));
      }
      return nextRules;
    });
  };

  if (loading && stations.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
        Loading station curation...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Station Lineup */}
      <div className="space-y-6">
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Station Lineup ({stations.length})
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Reorder channels, customize thumbnails &amp; colors, edit rules, or duplicate.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void handleRegenerateAll()}
                disabled={isRegeneratingAll || stations.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-medium transition cursor-pointer disabled:opacity-40"
                title="Reshuffle and regenerate schedules for all stations from the current moment with fresh random seeds"
              >
                <Shuffle className={`w-3.5 h-3.5 ${isRegeneratingAll ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">{isRegeneratingAll ? 'Regenerating...' : 'Regenerate Schedules'}</span>
                <span className="sm:hidden">{isRegeneratingAll ? '...' : 'Reshuffle'}</span>
              </button>

              <button
                onClick={openNewStationEditor}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs transition cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>New Station</span>
              </button>
            </div>
          </div>

          {/* Batch Action Bar */}
          {selectedStationIds.size > 0 && (
            <div className="px-4 py-3 bg-zinc-100 dark:bg-zinc-900/90 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-150">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleToggleSelectAll}
                  className="p-1 rounded text-zinc-700 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 cursor-pointer"
                  title={isAllSelected ? 'Deselect all' : 'Select all'}
                >
                  <div
                    className={`w-4 h-4 rounded border flex items-center justify-center transition shrink-0 ${
                      isAllSelected || isSomeSelected
                        ? 'bg-zinc-700 dark:bg-zinc-800 border-zinc-500 dark:border-zinc-500 text-zinc-200'
                        : 'bg-zinc-100/90 dark:bg-zinc-900 border-zinc-400 dark:border-zinc-600 hover:border-zinc-500 dark:hover:border-zinc-500 text-transparent'
                    }`}
                  >
                    {isAllSelected ? (
                      <Check className="w-3 h-3 stroke-[3]" />
                    ) : isSomeSelected ? (
                      <span className="w-2 h-0.5 bg-zinc-200 rounded-full" />
                    ) : null}
                  </div>
                </button>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    {selectedStationIds.size} of {stations.length} channel{selectedStationIds.size === 1 ? '' : 's'} selected
                  </span>
                  <button
                    type="button"
                    onClick={handleClearSelection}
                    className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:underline cursor-pointer"
                  >
                    Clear selection
                  </button>
                </div>
              </div>

              {/* Batch Operations Toolbar */}
              <div className="flex flex-wrap items-center gap-1.5">
                {/* 1. Move En Masse */}
                <div className="relative batch-menu-trigger">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMoveMenu((prev) => !prev);
                      setShowPlayModeMenu(false);
                    }}
                    disabled={batchActionLoading}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-indigo-200 dark:border-indigo-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <GripVertical className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Move</span>
                    <ChevronDown className="w-3 h-3 text-zinc-400" />
                  </button>

                  {showMoveMenu && (
                    <div className="batch-menu-popover absolute right-0 top-full mt-1.5 w-44 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl py-1 z-30 divide-y divide-zinc-100 dark:divide-zinc-800">
                      <div className="py-0.5">
                        <button
                          type="button"
                          onClick={() => void handleBatchMove('top')}
                          className="w-full px-3 py-1.5 text-left text-xs text-zinc-700 dark:text-zinc-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 flex items-center gap-2 cursor-pointer"
                        >
                          <ArrowUpToLine className="w-3.5 h-3.5 text-indigo-500" />
                          <span>Move to Top</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleBatchMove('up')}
                          className="w-full px-3 py-1.5 text-left text-xs text-zinc-700 dark:text-zinc-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 flex items-center gap-2 cursor-pointer"
                        >
                          <ArrowUp className="w-3.5 h-3.5 text-indigo-500" />
                          <span>Shift Up by 1</span>
                        </button>
                      </div>
                      <div className="py-0.5">
                        <button
                          type="button"
                          onClick={() => void handleBatchMove('down')}
                          className="w-full px-3 py-1.5 text-left text-xs text-zinc-700 dark:text-zinc-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 flex items-center gap-2 cursor-pointer"
                        >
                          <ArrowDown className="w-3.5 h-3.5 text-indigo-500" />
                          <span>Shift Down by 1</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleBatchMove('bottom')}
                          className="w-full px-3 py-1.5 text-left text-xs text-zinc-700 dark:text-zinc-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 flex items-center gap-2 cursor-pointer"
                        >
                          <ArrowDownToLine className="w-3.5 h-3.5 text-indigo-500" />
                          <span>Move to Bottom</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Change Shuffle / Play Mode En Masse */}
                <div className="relative batch-menu-trigger">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowPlayModeMenu((prev) => !prev);
                      setShowMoveMenu(false);
                    }}
                    disabled={batchActionLoading}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-indigo-200 dark:border-indigo-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <Shuffle className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Shuffle Mode</span>
                    <ChevronDown className="w-3 h-3 text-zinc-400" />
                  </button>

                  {showPlayModeMenu && (
                    <div className="batch-menu-popover absolute right-0 top-full mt-1.5 w-56 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl py-1 z-30 divide-y divide-zinc-100 dark:divide-zinc-800">
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                        Set Play Mode En Masse
                      </div>
                      <div className="py-0.5">
                        <button
                          type="button"
                          onClick={() => void handleBatchPlayMode('shuffle')}
                          className="w-full px-3 py-2 text-left text-xs text-zinc-700 dark:text-zinc-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 flex flex-col cursor-pointer"
                        >
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">Track Shuffle</span>
                          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Random track-by-track playback</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleBatchPlayMode('album_shuffle')}
                          className="w-full px-3 py-2 text-left text-xs text-zinc-700 dark:text-zinc-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 flex flex-col cursor-pointer"
                        >
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">Album Shuffle</span>
                          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Random album order, tracks in sequence</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleBatchPlayMode('straight')}
                          className="w-full px-3 py-2 text-left text-xs text-zinc-700 dark:text-zinc-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 flex flex-col cursor-pointer"
                        >
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">Sequential (Straight)</span>
                          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Standard chronological / album order</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. Duplicate En Masse */}
                <button
                  type="button"
                  onClick={() => void handleBatchDuplicate()}
                  disabled={batchActionLoading}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-indigo-200 dark:border-indigo-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 shadow-xs cursor-pointer disabled:opacity-50"
                  title="Duplicate all selected stations"
                >
                  <Copy className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Duplicate</span>
                </button>

                {/* 4. Reshuffle / Regenerate Selected */}
                <button
                  type="button"
                  onClick={() => void handleBatchRegenerate()}
                  disabled={batchActionLoading}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-indigo-200 dark:border-indigo-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 shadow-xs cursor-pointer disabled:opacity-50"
                  title="Reshuffle & regenerate schedules for selected stations"
                >
                  <Shuffle className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Reshuffle</span>
                </button>

                {/* 5. Enable / Disable En Masse */}
                <button
                  type="button"
                  onClick={() => void handleBatchToggleEnabled(true)}
                  disabled={batchActionLoading}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-indigo-200 dark:border-indigo-800 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 shadow-xs cursor-pointer disabled:opacity-50"
                  title="Enable all selected stations on the live guide"
                >
                  <Power className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Turn On</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleBatchToggleEnabled(false)}
                  disabled={batchActionLoading}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-indigo-200 dark:border-indigo-800 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 shadow-xs cursor-pointer disabled:opacity-50"
                  title="Disable all selected stations"
                >
                  <Power className="w-3.5 h-3.5 opacity-60" />
                  <span className="hidden sm:inline">Turn Off</span>
                </button>

                {/* 6. Delete En Masse */}
                <button
                  type="button"
                  onClick={() => setShowBatchDeleteConfirm(true)}
                  disabled={batchActionLoading}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 shadow-xs cursor-pointer disabled:opacity-50"
                  title="Delete selected stations"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                  <span>Delete ({selectedStationIds.size})</span>
                </button>
              </div>
            </div>
          )}

          {regenerateToast && (
            <div className="px-5 py-2.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-b border-indigo-100 dark:border-indigo-900/60 text-xs flex items-center justify-between">
              <span>{regenerateToast}</span>
              <button
                type="button"
                onClick={() => setRegenerateToast(null)}
                className="p-1 text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {stations.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
                No stations yet. Click &ldquo;New Station&rdquo; or accept a starter suggestion below.
              </div>
            ) : (
              stations.map((st, idx) => {
                const isSelected = selectedStationIds.has(st.id);
                const isBeingEdited = editingId === st.id;
                const isBatchDragActive = Boolean(
                  draggedStationId &&
                  selectedStationIds.has(draggedStationId) &&
                  selectedStationIds.size > 1
                );
                const isPartOfDraggedBatch = isBatchDragActive && isSelected;
                const isDragged = draggedStationId === st.id;
                const isDragOver = dragOverStationId === st.id;
                const showDropBefore = isDragOver && dragOverPosition === 'before';
                const showDropAfter = isDragOver && dragOverPosition === 'after';
                const rulePills = buildStationRuleSummaryPills(st.rules);

                const isBatchRow = isSelected && selectedStationIds.size > 1;
                const moveUpDisabled = isBatchRow ? !canBatchMoveUp : idx === 0;
                const moveDownDisabled = isBatchRow ? !canBatchMoveDown : idx === stations.length - 1;
                const moveUpTitle = isBatchRow
                  ? (canBatchMoveUp ? `Move all ${selectedStationIds.size} selected stations up` : 'Selected stations cannot move up further')
                  : 'Move channel up';
                const moveDownTitle = isBatchRow
                  ? (canBatchMoveDown ? `Move all ${selectedStationIds.size} selected stations down` : 'Selected stations cannot move down further')
                  : 'Move channel down';

                return (
                  <div
                    key={st.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, st.id)}
                    onDragOver={(e) => handleDragOver(e, st.id)}
                    onDrop={(e) => void handleDrop(e, st.id)}
                    onDragEnd={handleDragEnd}
                    className={`relative px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 transition ${
                      isDragged || isPartOfDraggedBatch
                        ? 'opacity-40 bg-indigo-50/50 dark:bg-indigo-950/25 ring-1 ring-dashed ring-indigo-400 dark:ring-indigo-500 scale-[0.99]'
                        : isSelected
                          ? 'bg-indigo-50/70 dark:bg-indigo-950/35 ring-1 ring-inset ring-indigo-500/35 border-l-4 border-l-indigo-600 dark:border-l-indigo-400'
                          : isBeingEdited
                            ? 'bg-indigo-50/70 dark:bg-indigo-950/30'
                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                    } ${
                      showDropBefore
                        ? 'border-t-2 border-t-indigo-500'
                        : showDropAfter
                          ? 'border-b-2 border-b-indigo-500'
                          : ''
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {/* Checkbox for Bulk Selection - darkened to sleek grey on dark theme */}
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isSelected}
                        aria-label={`Select station ${st.name}`}
                        onClick={(e) => handleToggleSelectStation(st.id, e)}
                        className={`w-4 h-4 rounded border flex items-center justify-center transition shrink-0 cursor-pointer select-none ${
                          isSelected
                            ? 'bg-zinc-700 dark:bg-zinc-800 border-zinc-500 dark:border-zinc-500 text-zinc-200'
                            : 'bg-zinc-100/90 dark:bg-zinc-900 border-zinc-400 dark:border-zinc-600 hover:border-zinc-500 dark:hover:border-zinc-500 text-transparent'
                        }`}
                        title={isSelected ? `Deselect ${st.name}` : `Select ${st.name}`}
                      >
                        <Check className="w-3 h-3 stroke-[3]" />
                      </button>

                      {/* Drag Handle + Up/Down Buttons */}
                      <div className="flex items-center gap-1 shrink-0">
                        <div
                          className={`p-1 rounded cursor-grab active:cursor-grabbing transition ${
                            isBatchRow
                              ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-100/70 dark:bg-indigo-950/60'
                              : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200'
                          }`}
                          title={
                            isBatchRow
                              ? `Drag to move all ${selectedStationIds.size} selected stations together`
                              : 'Drag to reorder channel'
                          }
                        >
                          <GripVertical className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <button
                            type="button"
                            onClick={() => void handleMoveChannel(idx, -1)}
                            disabled={moveUpDisabled}
                            className={`p-0.5 rounded text-zinc-500 dark:text-zinc-400 disabled:opacity-30 cursor-pointer transition ${
                              isBatchRow
                                ? 'hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-bold'
                                : 'hover:bg-zinc-200 dark:hover:bg-zinc-700'
                            }`}
                            title={moveUpTitle}
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleMoveChannel(idx, 1)}
                            disabled={moveDownDisabled}
                            className={`p-0.5 rounded text-zinc-500 dark:text-zinc-400 disabled:opacity-30 cursor-pointer transition ${
                              isBatchRow
                                ? 'hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-bold'
                                : 'hover:bg-zinc-200 dark:hover:bg-zinc-700'
                            }`}
                            title={moveDownTitle}
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {/* Reusable Channel Badge (Thumbnail or Category Formula Tile) */}
                      <ChannelBadge
                        channelNumber={st.channelNumber}
                        tileColor={st.tileColor}
                        thumbnailUrl={st.thumbnailUrl}
                        category={st.category}
                        size="md"
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                            {st.name}
                          </span>
                          <StationCategoryPill category={st.category} compact />
                          {isBatchRow && (
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                              title={`${selectedStationIds.size} stations selected for batch move/actions`}
                            >
                              {selectedStationIds.size} selected
                            </span>
                          )}
                          {st.customColor && (
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400"
                              title="Using custom color override"
                            >
                              Custom Color
                            </span>
                          )}
                          {!st.enabled && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                              Disabled
                            </span>
                          )}
                        </div>

                        {/* Rule Summary Tags & Station Metadata */}
                        <div className="text-xs text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                          {rulePills.map((pill) => (
                            <span
                              key={pill}
                              className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] font-medium text-zinc-700 dark:text-zinc-300"
                            >
                              {pill}
                            </span>
                          ))}
                          <span className="capitalize">
                            {st.playMode.replace('_', ' ')}
                          </span>
                          <span>&middot;</span>
                          <span className="font-mono tabular-nums">
                            {st.matchingTrackCount} tracks
                          </span>
                          <span>&middot;</span>
                          <span className="font-mono tabular-nums">
                            {formatDurationHoursAndMins(st.matchingDurationMs)}
                          </span>
                          <span>&middot;</span>
                          <span>
                            {st.crossfadeEnabled
                              ? `Crossfade ${st.crossfadeSeconds}s`
                              : 'No Crossfade'}
                          </span>
                          {st.daypartsEnabled && (
                            <>
                              <span>&middot;</span>
                              <span
                                className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-medium"
                                title="Radio Dayparting On: Prefers quieter/slower songs from 8:00 PM – 6:00 AM"
                              >
                                <Moon className="w-3 h-3" />
                                <span>8 PM–6 AM Chill</span>
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons: Enable/Disable, Edit, Duplicate, Delete */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <label
                        className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300 mr-1 cursor-pointer select-none"
                        title="Enable or disable station on the live guide"
                      >
                        <input
                          type="checkbox"
                          checked={st.enabled}
                          onChange={() => void handleToggleStationEnabled(st)}
                          className="w-3.5 h-3.5 rounded accent-zinc-600 dark:accent-zinc-700 cursor-pointer"
                        />
                        <span className="hidden sm:inline">On</span>
                      </label>

                      <button
                        onClick={() => openEditStationEditor(st)}
                        className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 transition cursor-pointer"
                        title="Edit station, thumbnail & rules"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => void handleDuplicateStation(st.id)}
                        className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 transition cursor-pointer"
                        title="Duplicate station"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => void handleRegenerateStation(st)}
                        disabled={regeneratingStationId === st.id}
                        className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 transition cursor-pointer disabled:opacity-40"
                        title={`Reshuffle & regenerate schedule for "${st.name}"`}
                      >
                        <Shuffle className={`w-3.5 h-3.5 ${regeneratingStationId === st.id ? 'animate-spin' : ''}`} />
                      </button>

                      <button
                        onClick={() => void handleDeleteStation(st.id)}
                        className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 transition cursor-pointer"
                        title="Delete station"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Batch Delete Confirmation Modal */}
        {showBatchDeleteConfirm && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="batch-delete-modal-title"
            onClick={() => setShowBatchDeleteConfirm(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150"
            >
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 id="batch-delete-modal-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Delete {selectedStationIds.size} Station{selectedStationIds.size > 1 ? 's' : ''}?
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    This will permanently remove the following stations and their schedules from your lineup:
                  </p>
                </div>
              </div>

              <div className="max-h-48 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 p-2 divide-y divide-zinc-200 dark:divide-zinc-800/60">
                {stations
                  .filter((s) => selectedStationIds.has(s.id))
                  .map((s) => (
                    <div key={s.id} className="py-1.5 px-2 flex items-center justify-between text-xs">
                      <span className="font-medium text-zinc-800 dark:text-zinc-200 truncate pr-2">
                        Ch. {s.channelNumber} &middot; {s.name}
                      </span>
                      <span className="text-[10px] text-zinc-400 uppercase tracking-wider shrink-0">
                        {s.playMode.replace('_', ' ')}
                      </span>
                    </div>
                  ))}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowBatchDeleteConfirm(false)}
                  disabled={batchActionLoading}
                  className="px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmBatchDelete()}
                  disabled={batchActionLoading}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-xs cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>
                    {batchActionLoading
                      ? 'Deleting...'
                      : `Delete ${selectedStationIds.size} Station${selectedStationIds.size > 1 ? 's' : ''}`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Station Editor Popup Modal / Mobile Sheet */}
        {editingId && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-xs p-0 sm:p-4"
            onClick={closeEditorModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="station-editor-modal-title"
          >
            <section
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-3xl max-h-[92svh] sm:max-h-[88dvh] rounded-t-2xl sm:rounded-2xl border-t sm:border border-indigo-500/40 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden flex flex-col"
            >
              {/* Mobile Drag Pill Indicator */}
              <div className="sm:hidden flex justify-center pt-2 pb-0.5 bg-zinc-50/80 dark:bg-zinc-950/60">
                <div className="w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
              </div>

              {/* Sticky Modal Header + Live Rule Preview */}
              <div className="px-4 sm:px-5 py-3 sm:py-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/60 shrink-0 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                    <ChannelBadge
                      channelNumber={editorChannelNumber}
                      tileColor={effectiveEditorTileColor}
                      thumbnailUrl={editorThumbnailUrl.trim() || null}
                      category={editorCategory}
                      size="md"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <h3
                          id="station-editor-modal-title"
                          className="text-sm sm:text-base font-semibold text-zinc-900 dark:text-zinc-100 truncate"
                        >
                          {editingId === 'new' ? 'Create New Station' : 'Edit Station'}
                        </h3>
                        <StationCategoryPill category={editorCategory} compact />
                      </div>
                      <p className="text-[11px] sm:text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                        Customize channel thumbnail, badge color, and library rules.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={closeEditorModal}
                    className="p-1.5 rounded-lg hover:bg-zinc-200/70 dark:hover:bg-zinc-800 text-zinc-500 cursor-pointer shrink-0"
                    title="Close editor (Esc)"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Live Preview Banner pinned in header */}
                <div className="px-3 py-2 rounded-xl bg-indigo-50/90 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800/70 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] sm:text-xs font-medium text-indigo-900 dark:text-indigo-200">
                    Live Rule Preview
                  </div>
                  <div className="text-[11px] sm:text-xs font-semibold text-indigo-700 dark:text-indigo-300 font-mono tabular-nums">
                    {preview ? (
                      <>
                        {preview.matchingTrackCount} matching track
                        {preview.matchingTrackCount === 1 ? '' : 's'} &middot;{' '}
                        {formatDurationHoursAndMins(preview.matchingDurationMs)} total
                      </>
                    ) : (
                      'Calculating...'
                    )}
                  </div>
                </div>
              </div>

              {/* Scrollable Editor Form Body */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 sm:space-y-5">
                {/* Name & Play Mode */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Station Name
                </label>
                <input
                  type="text"
                  value={editorName}
                  onChange={(e) => setEditorName(e.target.value)}
                  placeholder="e.g., 90s Alternative or Radiohead"
                  className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-100"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Play Mode
                </label>
                <select
                  value={editorPlayMode}
                  onChange={(e) => {
                    const nextMode = e.target.value as PlayMode;
                    setEditorPlayMode(nextMode);
                    if (!crossfadeTouched) {
                      setEditorCrossfadeEnabled(
                        inferDefaultCrossfade(nextMode, editorRules)
                      );
                    }
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-100"
                >
                  <option value="straight">
                    Straight (Chronological by year, album, disc &amp; track)
                  </option>
                  <option value="album_shuffle">
                    Album Shuffle (Random albums, each played start-to-finish)
                  </option>
                  <option value="shuffle">
                    Shuffle (Random tracks, no repeat until all play)
                  </option>
                </select>
              </div>
            </div>

            {/* Channel Appearance: Custom Thumbnail & Formulaic / Custom Badge Color */}
            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-indigo-500" />
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    Channel Label Appearance &amp; Thumbnail
                  </span>
                </div>
                {editorThumbnailUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      thumbnailTouchedRef.current = true;
                      setEditorThumbnailUrl('');
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-zinc-200/80 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                    <span>Clear Thumbnail (Use CH Badge)</span>
                  </button>
                )}
              </div>

              {/* Thumbnail Upload & URL Input */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                <div className="sm:col-span-5">
                  <input
                    ref={thumbFileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      thumbnailTouchedRef.current = true;
                      void handleUploadThumbnailFile(e);
                    }}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => thumbFileInputRef.current?.click()}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:border-indigo-500 text-xs font-medium text-zinc-800 dark:text-zinc-200 transition cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Upload Image Thumbnail</span>
                  </button>
                </div>

                <div className="sm:col-span-7">
                  <input
                    type="text"
                    value={
                      editorThumbnailUrl.startsWith('data:image/')
                        ? ''
                        : editorThumbnailUrl
                    }
                    onChange={(e) => {
                      thumbnailTouchedRef.current = true;
                      setEditorThumbnailUrl(e.target.value);
                    }}
                    placeholder={
                      editorThumbnailUrl.startsWith('data:image/')
                        ? 'Custom uploaded image active (paste URL to replace)'
                        : 'Or paste image URL (https://... or /api/art/...)'
                    }
                    className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-100"
                  />
                </div>
              </div>

              {/* Auto-Pick Artwork from Matching Albums & Press Art */}
              {preview && preview.sampleArtworks && preview.sampleArtworks.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                    Pick artwork from matching music ({preview.sampleArtworks.length} available, artist press photos prioritized):
                  </div>
                  <div className="flex items-center gap-2 overflow-x-auto pb-1.5 pt-0.5">
                    {preview.sampleArtworks.map((item) => {
                      const isSelected = editorThumbnailUrl === item.artUrl;
                      return (
                        <button
                          key={item.albumId}
                          type="button"
                          onClick={() => {
                            thumbnailTouchedRef.current = true;
                            setEditorThumbnailUrl(isSelected ? '' : item.artUrl);
                          }}
                          title={
                            item.isArtistArt
                              ? `${item.artist} (Band/Artist Press Photo)`
                              : `${item.album} — ${item.artist}`
                          }
                          className={`group relative w-12 h-12 rounded-xl overflow-hidden shrink-0 border-2 transition cursor-pointer ${
                            isSelected
                              ? 'border-indigo-600 ring-2 ring-indigo-500/40 scale-105'
                              : 'border-transparent hover:border-indigo-400 opacity-85 hover:opacity-100'
                          }`}
                        >
                          <img
                            src={item.artUrl}
                            alt={item.album}
                            className="w-full h-full object-cover"
                          />
                          {item.isArtistArt && (
                            <div className="absolute top-0 inset-x-0 bg-indigo-950/85 text-[7px] text-indigo-200 font-semibold uppercase tracking-wider text-center py-0.5 pointer-events-none">
                              Artist
                            </div>
                          )}
                          {isSelected && (
                            <div className="absolute inset-0 bg-indigo-600/35 flex items-center justify-center">
                              <Check className="w-4 h-4 text-white drop-shadow" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Badge Color Formula vs Custom Color Override */}
              <div className="pt-2 border-t border-zinc-200/80 dark:border-zinc-800/80 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Badge Background Color
                  </div>
                  <div className="inline-flex items-center rounded-xl bg-zinc-200/70 dark:bg-zinc-800 p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setEditorCustomColor(false)}
                      className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                        !editorCustomColor
                          ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                          : 'text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      Auto Formula ({editorCategoryVisuals.shortLabel})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditorCustomColor(true);
                        if (!editorTileColor) {
                          setEditorTileColor(editorCategoryVisuals.color);
                        }
                      }}
                      className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                        editorCustomColor
                          ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                          : 'text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      Custom Color
                    </button>
                  </div>
                </div>

                {editorCustomColor ? (
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {CUSTOM_SWATCH_PALETTE.map((swatch) => {
                      const active =
                        editorTileColor.toLowerCase() === swatch.hex.toLowerCase();
                      return (
                        <button
                          key={swatch.hex}
                          type="button"
                          onClick={() => setEditorTileColor(swatch.hex)}
                          title={swatch.name}
                          style={{ backgroundColor: swatch.hex }}
                          className={`w-6 h-6 rounded-lg transition cursor-pointer flex items-center justify-center ${
                            active
                              ? 'ring-2 ring-offset-2 ring-indigo-500 dark:ring-offset-zinc-900 scale-110'
                              : 'opacity-80 hover:opacity-100'
                          }`}
                        >
                          {active && <Check className="w-3.5 h-3.5 text-white" />}
                        </button>
                      );
                    })}
                    <label
                      className="inline-flex items-center gap-1.5 ml-1 text-[11px] text-zinc-500 dark:text-zinc-400 cursor-pointer"
                      title="Pick any custom hex color"
                    >
                      <input
                        type="color"
                        value={editorTileColor}
                        onChange={(e) => setEditorTileColor(e.target.value)}
                        className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                      />
                      <span className="font-mono uppercase">{editorTileColor}</span>
                    </label>
                  </div>
                ) : (
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Automatically colored <span className="font-semibold">{editorCategoryVisuals.label}</span> based on this station&rsquo;s play mode and filter rules.
                  </p>
                )}
              </div>
            </div>

            {/* Smart Station Toggle */}
            <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                  Smart Station (Auto-Update Library Matches)
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  When enabled, new albums or tracks added to your library that match these rules are automatically included. Turn off to lock the current track snapshot.
                </p>
              </div>
              <input
                type="checkbox"
                checked={editorSmartUpdate}
                onChange={(e) => setEditorSmartUpdate(e.target.checked)}
                className="w-4 h-4 rounded accent-zinc-600 dark:accent-zinc-700 cursor-pointer shrink-0"
              />
            </div>

            {/* Source Libraries Filter */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Source Libraries{' '}
                <span className="text-zinc-400 font-normal">
                  (leave all unchecked to include all enabled libraries)
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                {options?.libraries
                  .filter((l) => l.enabled)
                  .map((lib) => {
                    const selected = (editorRules.libraryIds || []).includes(
                      lib.id
                    );
                    return (
                      <button
                        key={lib.id}
                        type="button"
                        onClick={() => toggleRuleArrayItem('libraryIds', lib.id)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition cursor-pointer ${
                          selected
                            ? 'border-indigo-600 bg-indigo-600 text-white'
                            : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                        }`}
                      >
                        {lib.name} ({lib.trackCount})
                      </button>
                    );
                  })}
              </div>
            </div>

            {/* Artists Include List */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Artists{' '}
                  <span className="text-zinc-400 font-normal">
                    ({(editorRules.artists || []).length} selected of{' '}
                    {options?.artists.length || 0})
                  </span>
                </label>
                <div className="relative w-48">
                  <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={artistSearch}
                    onChange={(e) => setArtistSearch(e.target.value)}
                    placeholder="Filter artists..."
                    className="w-full pl-8 pr-7 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-100"
                  />
                  {artistSearch && (
                    <button
                      type="button"
                      onClick={() => setArtistSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                      title="Clear artist filter"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
              <div className="max-h-32 overflow-y-auto p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 flex flex-wrap gap-1.5">
                {visibleArtists.items.map((artist) => {
                  const selected = selectedArtistsSet.has(artist);
                  return (
                    <button
                      key={artist}
                      type="button"
                      onClick={() => toggleRuleArrayItem('artists', artist)}
                      className={`px-2.5 py-1 rounded-lg text-xs transition cursor-pointer ${
                        selected
                          ? 'bg-indigo-600 text-white font-medium'
                          : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-indigo-400'
                      }`}
                    >
                      {artist}
                    </button>
                  );
                })}
                {visibleArtists.totalMatches > visibleArtists.items.length && (
                  <span className="text-[11px] text-zinc-400 px-2 py-1 self-center">
                    +{visibleArtists.totalMatches - visibleArtists.items.length} more (use search box above)
                  </span>
                )}
              </div>
            </div>

            {/* Albums Filter */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Albums{' '}
                  <span className="text-zinc-400 font-normal">
                    ({(editorRules.albums || []).length} selected of{' '}
                    {options?.albums.length || 0})
                  </span>
                </label>
                <div className="relative w-48">
                  <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={albumSearch}
                    onChange={(e) => setAlbumSearch(e.target.value)}
                    placeholder="Filter albums..."
                    className="w-full pl-8 pr-7 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-100"
                  />
                  {albumSearch && (
                    <button
                      type="button"
                      onClick={() => setAlbumSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                      title="Clear album filter"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
              <div className="max-h-32 overflow-y-auto p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 flex flex-wrap gap-1.5">
                {visibleAlbums.items.map((alb) => {
                  const selected = selectedAlbumsSet.has(alb.title);
                  return (
                    <button
                      key={alb.id}
                      type="button"
                      onClick={() => toggleRuleArrayItem('albums', alb.title)}
                      className={`px-2.5 py-1 rounded-lg text-xs transition cursor-pointer ${
                        selected
                          ? 'bg-indigo-600 text-white font-medium'
                          : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-indigo-400'
                      }`}
                    >
                      {alb.title}{' '}
                      <span className="opacity-70">({alb.artist})</span>
                    </button>
                  );
                })}
                {visibleAlbums.totalMatches > visibleAlbums.items.length && (
                  <span className="text-[11px] text-zinc-400 px-2 py-1 self-center">
                    +{visibleAlbums.totalMatches - visibleAlbums.items.length} more (use search box above)
                  </span>
                )}
              </div>
            </div>

            {/* Genres & Era (Year Range) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Genres{' '}
                    <span className="text-zinc-400 font-normal">
                      ({(editorRules.genres || []).length} selected)
                    </span>
                  </label>
                  <div className="relative w-36">
                    <Search className="w-3 h-3 text-zinc-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={genreSearch}
                      onChange={(e) => setGenreSearch(e.target.value)}
                      placeholder="Filter..."
                      className="w-full pl-6 pr-6 py-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-[11px] text-zinc-900 dark:text-zinc-100"
                    />
                    {genreSearch && (
                      <button
                        type="button"
                        onClick={() => setGenreSearch('')}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                        title="Clear genre filter"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="max-h-28 overflow-y-auto p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 flex flex-wrap gap-1.5">
                  {visibleGenres.items.map((genre) => {
                    const selected = selectedGenresSet.has(genre);
                    return (
                      <button
                        key={genre}
                        type="button"
                        onClick={() => toggleRuleArrayItem('genres', genre)}
                        className={`px-2.5 py-1 rounded-lg text-xs transition cursor-pointer ${
                          selected
                            ? 'bg-indigo-600 text-white font-medium'
                            : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-indigo-400'
                        }`}
                      >
                        {genre}
                      </button>
                    );
                  })}
                  {visibleGenres.totalMatches > visibleGenres.items.length && (
                    <span className="text-[11px] text-zinc-400 px-2 py-1 self-center">
                      +{visibleGenres.totalMatches - visibleGenres.items.length} more
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Era (Year Range)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <input
                      type="number"
                      placeholder={
                        options?.yearMin ? `From (${options.yearMin})` : 'Min Year'
                      }
                      value={editorRules.yearMin ?? ''}
                      onChange={(e) =>
                        setEditorRules((prev) => ({
                          ...prev,
                          yearMin: e.target.value
                            ? parseInt(e.target.value, 10)
                            : null,
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-100"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <input
                      type="number"
                      placeholder={
                        options?.yearMax ? `To (${options.yearMax})` : 'Max Year'
                      }
                      value={editorRules.yearMax ?? ''}
                      onChange={(e) =>
                        setEditorRules((prev) => ({
                          ...prev,
                          yearMax: e.target.value
                            ? parseInt(e.target.value, 10)
                            : null,
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-100"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 pt-0.5">
                  Resolves original release dates and excludes modern remaster/greatest-hits reissue drift.
                </p>
              </div>
            </div>

            {/* Bundled Crossfade & Dayparting Section */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <button
                type="button"
                onClick={() => setAdvancedOpen((o) => !o)}
                className="w-full px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-950/50 flex items-center justify-between text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span>Crossfade &amp; Radio Dayparting</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold">
                    {editorCrossfadeEnabled
                      ? `Crossfade ${editorCrossfadeSeconds}s`
                      : 'Crossfade Off'}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-md font-semibold ${
                      editorDaypartsEnabled
                        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                        : 'bg-zinc-200/70 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    {editorDaypartsEnabled
                      ? 'Dayparting On (8 PM–6 AM)'
                      : 'Dayparting Off'}
                  </span>
                </div>
                {advancedOpen ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>
              {advancedOpen && (
                <div className="p-3.5 bg-white dark:bg-zinc-900 space-y-4 divide-y divide-zinc-200 dark:divide-zinc-800">
                  {/* Crossfade Between Songs */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                          Crossfade Between Songs
                        </div>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          Smoothly overlap the end of the outgoing track with the start of the next track. Defaults on for era/genre singles shuffle stations and off for full albums.
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={editorCrossfadeEnabled}
                        onClick={() => {
                          setCrossfadeTouched(true);
                          setEditorCrossfadeEnabled((prev) => !prev);
                        }}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                          editorCrossfadeEnabled
                            ? 'bg-indigo-600'
                            : 'bg-zinc-300 dark:bg-zinc-700'
                        }`}
                        title="Toggle crossfade between songs"
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition duration-200 ease-in-out ${
                            editorCrossfadeEnabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">
                        Fade Length
                      </span>
                      <div className="inline-flex items-center gap-1.5">
                        {CROSSFADE_DURATION_OPTIONS.map((sec) => {
                          const active = editorCrossfadeSeconds === sec;
                          return (
                            <button
                              key={sec}
                              type="button"
                              disabled={!editorCrossfadeEnabled}
                              onClick={() => {
                                setCrossfadeTouched(true);
                                setEditorCrossfadeSeconds(sec);
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                active && editorCrossfadeEnabled
                                  ? 'border-indigo-600 bg-indigo-600 text-white'
                                  : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-indigo-400'
                              }`}
                            >
                              {sec}s
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Radio Dayparting (8 PM – 6 AM Chill Mode) */}
                  <div className="pt-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                          <Moon className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                          <span>Radio Dayparting (8:00 PM – 6:00 AM Chill Rotation)</span>
                        </div>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                          Follows standard broadcast radio guidelines: from 8:00 PM to 6:00 AM, this station automatically prefers quieter, slower, and more relaxed songs (detected via BPM, Mood/Style tags, and acoustic/tempo cues), returning to its daytime rotation at 6:00 AM.
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={editorDaypartsEnabled}
                        onClick={() => setEditorDaypartsEnabled((prev) => !prev)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                          editorDaypartsEnabled
                            ? 'bg-indigo-600'
                            : 'bg-zinc-300 dark:bg-zinc-700'
                        }`}
                        title="Toggle 8:00 PM – 6:00 AM overnight chill dayparting"
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition duration-200 ease-in-out ${
                            editorDaypartsEnabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {preview && (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-600 dark:text-zinc-400 pt-1 font-mono tabular-nums">
                        <span>
                          Overnight Chill Pool:{' '}
                          <strong className="text-zinc-900 dark:text-zinc-100">
                            {preview.chillTrackCount}
                          </strong>{' '}
                          quiet/slow &middot;{' '}
                          <strong className="text-zinc-900 dark:text-zinc-100">
                            {preview.balancedTrackCount}
                          </strong>{' '}
                          mid-tempo &middot;{' '}
                          <strong className="text-zinc-900 dark:text-zinc-100">
                            {preview.upbeatTrackCount}
                          </strong>{' '}
                          upbeat
                        </span>
                        {preview.chillTrackCount < 3 && preview.matchingTrackCount > 0 && (
                          <span className="text-amber-600 dark:text-amber-400 font-sans">
                            Blends in mid-tempo tracks overnight so playback never loops a small pool
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

              </div>

              {/* Sticky Save / Cancel Footer */}
              <div className="px-4 sm:px-5 pt-3 pb-[max(1rem,calc(env(safe-area-inset-bottom,0px)+0.5rem))] sm:pb-3.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/95 dark:bg-zinc-950/95 shrink-0 flex items-center justify-between gap-2">
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                  {!editorName.trim()
                    ? 'Enter a station name to save'
                    : `CH ${editorChannelNumber} • ${editorName.trim()}`}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={closeEditorModal}
                    className="px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveStation()}
                    disabled={saving || !editorName.trim()}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-xs cursor-pointer"
                  >
                    {saving
                      ? 'Saving...'
                      : editingId === 'new'
                        ? 'Create Station'
                        : 'Save Changes'}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>

      {/* 2. Starter Station Suggestions (One-Click Accept or Ignore) */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Starter Station Suggestions ({filteredSuggestions.length})
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Prioritised by top artist album channels (most media first) followed by era &amp; genre shuffle stations, automatically refilling as you add or ignore stations.
              </p>
            </div>
          </div>

          <div className="inline-flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800/80 p-1 rounded-xl text-xs">
            {(
              [
                { id: 'all', label: 'All (8 + 8)' },
                { id: 'artist', label: 'Artists (Chrono)' },
                { id: 'genre', label: 'Genres' },
                { id: 'decade', label: 'Eras' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSuggestionFilter(tab.id)}
                className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                  suggestionFilter === tab.id
                    ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {filteredSuggestions.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            No matching starter suggestions in this category.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredSuggestions.map((sug) => {
              const sugCategory = inferStationCategory(sug.playMode, sug.rules);
              return (
                <div
                  key={sug.key}
                  className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {sug.name}
                      </span>
                      <StationCategoryPill category={sugCategory} compact />
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      {sug.description}
                    </p>
                    <div className="mt-2 text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                      {sug.matchingTrackCount} tracks &middot;{' '}
                      {formatDurationHoursAndMins(sug.matchingDurationMs)} &middot;{' '}
                      {sug.playMode.replace('_', ' ')} &middot;{' '}
                      {sug.crossfadeEnabled
                        ? `crossfade ${sug.crossfadeSeconds || 5}s`
                        : 'no crossfade'}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => void handleAcceptSuggestion(sug)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Add Station</span>
                    </button>
                    <button
                      onClick={() => void handleDismissSuggestion(sug.key)}
                      className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-medium transition cursor-pointer"
                    >
                      Ignore
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
