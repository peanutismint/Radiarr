import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
  Tray,
} from 'electron';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { startServer } from '../../server.ts';

// Ensure single instance across the system
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let hasShownTrayTip = false;

const PORT = Number(process.env.PORT) || 8484;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

// Window state management
interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

const getWindowStateFile = (): string => {
  return path.join(app.getPath('userData'), 'radiarr-window-state.json');
};

const loadSavedWindowState = (): WindowState => {
  const defaultState: WindowState = {
    width: 1280,
    height: 840,
  };
  try {
    const file = getWindowStateFile();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as WindowState;
      // Validate that coordinates fall within at least one active screen
      if (typeof data.x === 'number' && typeof data.y === 'number') {
        const visibleOnDisplay = screen.getAllDisplays().some((disp) => {
          const { x, y, width, height } = disp.bounds;
          return (
            (data.x ?? 0) >= x &&
            (data.x ?? 0) < x + width &&
            (data.y ?? 0) >= y &&
            (data.y ?? 0) < y + height
          );
        });
        if (visibleOnDisplay) {
          return { ...defaultState, ...data };
        }
      }
      return { ...defaultState, width: data.width || 1280, height: data.height || 840 };
    }
  } catch (e) {
    console.warn('Could not read saved window state:', e);
  }
  return defaultState;
};

const saveWindowState = (): void => {
  if (!mainWindow) return;
  try {
    const isMaximized = mainWindow.isMaximized();
    const bounds = mainWindow.getBounds();
    const state: WindowState = {
      isMaximized,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
    fs.writeFileSync(getWindowStateFile(), JSON.stringify(state, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not save window state:', e);
  }
};

// macOS: where Radiarr appears (menu bar, Dock, or both). Default: menu bar only.
type DockMode = 'menubar' | 'dock' | 'both';
const DOCK_MODES: DockMode[] = ['menubar', 'dock', 'both'];
const isMac = process.platform === 'darwin';

const getDesktopSettingsFile = (): string =>
  path.join(app.getPath('userData'), 'radiarr-desktop-settings.json');

const loadDockMode = (): DockMode => {
  try {
    const file = getDesktopSettingsFile();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as { dockMode?: string };
      if (DOCK_MODES.includes(data.dockMode as DockMode)) {
        return data.dockMode as DockMode;
      }
    }
  } catch (e) {
    console.warn('Could not read desktop settings:', e);
  }
  return 'menubar';
};

const saveDockMode = (mode: DockMode): void => {
  try {
    const file = getDesktopSettingsFile();
    let data: Record<string, unknown> = {};
    if (fs.existsSync(file)) {
      data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
    data.dockMode = mode;
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not save desktop settings:', e);
  }
};

let dockMode: DockMode = 'menubar';

function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * Shows or hides the Dock icon and the menu bar icon to match `mode`.
 * Only macOS has a Dock; other platforms always keep their tray icon.
 */
async function applyDockMode(mode: DockMode): Promise<void> {
  dockMode = mode;
  if (!isMac) return;

  const wantsMenuBar = mode === 'menubar' || mode === 'both';
  const wantsDock = mode === 'dock' || mode === 'both';
  const windowWasVisible = Boolean(mainWindow?.isVisible());

  if (wantsMenuBar && !tray) {
    createTray();
  } else if (!wantsMenuBar && tray) {
    tray.destroy();
    tray = null;
  }

  if (app.dock) {
    if (wantsDock) {
      await app.dock.show();
    } else {
      app.dock.hide();
    }
  }

  // Switching Dock visibility can push the window behind other apps.
  if (windowWasVisible) {
    showMainWindow();
  }

  rebuildTrayMenu();
}

// Tray / menu bar icon. Electron cannot draw SVG here, so these are PNGs.
// macOS uses a black "Template" image, which macOS recolours to suit light,
// dark and greyscale menu bars. Windows and Linux use the indigo version.
// Files ending in @2x are picked up automatically on high-resolution screens.
function createTrayIcon(): Electron.NativeImage {
  const fileName = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const candidates = [
    path.join(process.resourcesPath || '', 'tray', fileName),
    path.join(__dirname, '..', 'assets', 'tray', fileName),
  ];
  const iconPath = candidates.find((p) => fs.existsSync(p));
  if (!iconPath) {
    console.warn('Tray icon not found in', candidates);
    return nativeImage.createEmpty();
  }
  const icon = nativeImage.createFromPath(iconPath);
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }
  return icon;
}

function triggerLibraryRescan(): void {
  try {
    const req = http.request(
      `${SERVER_URL}/api/libraries/scan`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        if (res.statusCode === 200 && Notification.isSupported()) {
          new Notification({
            title: 'Radiarr Library Rescan',
            body: 'Rescan initiated across all configured music libraries.',
          }).show();
        }
      }
    );
    req.on('error', (err) => {
      console.warn('Failed to trigger scan from tray:', err);
    });
    req.end();
  } catch (e) {
    console.warn('Rescan request error:', e);
  }
}

function createTray(): void {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Radiarr - Virtual Live Radio');

  rebuildTrayMenu();

  tray.on('click', () => {
    if (isMac) return; // macOS opens the menu on click
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        showMainWindow();
      }
    }
  });

  tray.on('double-click', () => {
    showMainWindow();
  });
}

function rebuildTrayMenu(): void {
  if (!tray) return;

  const showInItems: Electron.MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: 'Show Radiarr In',
          submenu: [
            { label: 'Menu Bar Only', value: 'menubar' },
            { label: 'Dock Only', value: 'dock' },
            { label: 'Menu Bar and Dock', value: 'both' },
          ].map(({ label, value }) => ({
            label,
            type: 'radio' as const,
            checked: dockMode === value,
            click: () => {
              saveDockMode(value as DockMode);
              void applyDockMode(value as DockMode);
            },
          })),
        },
        { type: 'separator' },
      ]
    : [];

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Radiarr v${app.getVersion()}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Open Radiarr Window',
      click: () => showMainWindow(),
    },
    {
      label: `Copy Web Stream URL (${SERVER_URL})`,
      click: () => {
        clipboard.writeText(SERVER_URL);
      },
    },
    {
      label: 'Open in Default Browser',
      click: () => {
        shell.openExternal(SERVER_URL);
      },
    },
    { type: 'separator' },
    {
      label: 'Rescan Music Libraries',
      click: () => {
        triggerLibraryRescan();
      },
    },
    { type: 'separator' },
    ...showInItems,
    {
      label: 'Quit Radiarr',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function createWindow(): void {
  const state = loadSavedWindowState();

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 460,
    minHeight: 560,
    backgroundColor: '#09090b',
    // Window/taskbar icon on Windows and Linux (macOS uses the app bundle icon).
    icon: [
      path.join(process.resourcesPath || '', 'icon.png'),
      path.join(__dirname, '..', 'assets', 'icon.png'),
    ].find((p) => fs.existsSync(p)),
    title: 'Radiarr',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: fs.existsSync(path.join(__dirname, 'preload.cjs'))
        ? path.join(__dirname, 'preload.cjs')
        : path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  if (state.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.loadURL(SERVER_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  mainWindow.on('close', (event: Electron.Event) => {
    if (!isQuitting) {
      event.preventDefault();
      saveWindowState();
      mainWindow?.hide();

      if (!hasShownTrayTip && Notification.isSupported()) {
        hasShownTrayTip = true;
        new Notification({
          title: 'Radiarr is running in the background',
          body: isMac && dockMode === 'dock'
            ? 'Your stations keep playing. Click Radiarr in the Dock to reopen it.'
            : isMac
              ? 'Your stations keep playing. Use the Radiarr icon in the menu bar to reopen it.'
              : 'Your stations keep playing. Use the Radiarr icon in the system tray to reopen it.',
        }).show();
      }
    }
  });
}

// Health check to verify embedded server is ready
async function waitForServer(url: string, maxRetries = 40): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(url, (res) => {
          if (res.statusCode && res.statusCode < 500) {
            resolve();
          } else {
            reject(new Error(`Status ${res.statusCode}`));
          }
        });
        req.on('error', reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`Radiarr server did not respond at ${url}`);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  // Start the embedded server unless one is already answering on this port.
  // (waitForServer throws when nothing responds, which is our cue to start it.)
  try {
    await waitForServer(`${SERVER_URL}/api/settings`, 2);
  } catch {
    console.log('Starting embedded Radiarr server...');
    // Installed copies must serve the pre-built web UI rather than
    // trying to start the development server.
    if (app.isPackaged) {
      process.env.ELECTRON_PROD = '1';
    }
    try {
      await startServer(PORT);
      // Ensure server is accepting requests before window renders
      await waitForServer(`${SERVER_URL}/api/settings`, 40);
    } catch (e) {
      console.error('Failed to start Radiarr server:', e);
      dialog.showErrorBox(
        'Radiarr could not start',
        `The built-in Radiarr server failed to start on port ${PORT}.\n\n${
          e instanceof Error ? e.message : String(e)
        }`
      );
      isQuitting = true;
      app.quit();
      return;
    }
  }

  createWindow();
  if (isMac) {
    await applyDockMode(loadDockMode());
  } else {
    createTray();
  }

  // macOS: menu bar / Dock preference, used by Settings > Appearance
  ipcMain.handle('radiarr:get-dock-mode', () => (isMac ? dockMode : null));
  ipcMain.handle('radiarr:set-dock-mode', async (_event, mode: string) => {
    if (!isMac || !DOCK_MODES.includes(mode as DockMode)) return dockMode;
    saveDockMode(mode as DockMode);
    await applyDockMode(mode as DockMode);
    return dockMode;
  });

  // Native folder selection dialog handler
  ipcMain.handle('radiarr:pick-folder', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Music Library Folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  // Open external links in default OS browser
  ipcMain.handle('radiarr:open-external', async (_event, targetUrl: string) => {
    if (typeof targetUrl === 'string' && targetUrl.startsWith('http')) {
      await shell.openExternal(targetUrl);
    }
  });

  // Expose desktop environment details
  ipcMain.handle('radiarr:get-info', () => {
    return {
      platform: process.platform,
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      serverUrl: SERVER_URL,
    };
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      if (mainWindow?.isMinimized()) mainWindow.restore();
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  saveWindowState();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});
