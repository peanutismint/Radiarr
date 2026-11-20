import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('radiarrDesktop', {
  isDesktop: true,
  platform: process.platform,
  pickFolder: (): Promise<string | null> => {
    return ipcRenderer.invoke('radiarr:pick-folder');
  },
  openExternal: (url: string): Promise<void> => {
    return ipcRenderer.invoke('radiarr:open-external', url);
  },
  getDockMode: (): Promise<'menubar' | 'dock' | 'both' | null> => {
    return ipcRenderer.invoke('radiarr:get-dock-mode');
  },
  setDockMode: (
    mode: 'menubar' | 'dock' | 'both'
  ): Promise<'menubar' | 'dock' | 'both' | null> => {
    return ipcRenderer.invoke('radiarr:set-dock-mode', mode);
  },
  getInfo: (): Promise<{
    platform: string;
    version: string;
    isPackaged: boolean;
    serverUrl?: string;
  }> => {
    return ipcRenderer.invoke('radiarr:get-info');
  },
});

