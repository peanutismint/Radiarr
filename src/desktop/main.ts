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

// SVG tray icon rendering
function createTrayIcon(): Electron.NativeImage {
  // A clean 32x32 radio wave icon with transparent background and indigo accents
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/>
    <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/>
    <circle cx="12" cy="12" r="2.5" fill="#6366f1"/>
    <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/>
    <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>
  </svg>`;

  try {
    const icon = nativeImage.createFromBuffer(Buffer.from(svg));
    if (process.platform === 'darwin') {
      icon.setTemplateImage(true);
    }
    return icon.resize({ width: 18, height: 18 });
  } catch {
    return nativeImage.createEmpty();
  }
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

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Radiarr v0.8.0 (Active)`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Open Radiarr Window',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      },
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
    {
      label: 'Quit Radiarr',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
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
          body: 'Your live radio stations and scheduled playback continue streaming in the system tray.',
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
  createTray();

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
