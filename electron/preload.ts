import { contextBridge, ipcRenderer } from 'electron';
import type { DownloadProgressPayload, ProcessPhotoParams } from './modelService';

contextBridge.exposeInMainWorld('electronAPI', {
  getModelStatus: () => {
    return ipcRenderer.invoke('get-model-status');
  },

  downloadModel: (modelKey: string) => {
    return ipcRenderer.invoke('download-model', modelKey);
  },

  onModelDownloadProgress: (callback: (payload: DownloadProgressPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: DownloadProgressPayload) => {
      callback(payload);
    };
    ipcRenderer.on('model-download-progress', listener);
    return () => {
      ipcRenderer.removeListener('model-download-progress', listener);
    };
  },

  deleteModel: (modelKey: string) => {
    return ipcRenderer.invoke('delete-model', modelKey);
  },

  setSelectedModel: (modelKey: string) => {
    return ipcRenderer.invoke('set-selected-model', modelKey);
  },

  processPhoto: (params: ProcessPhotoParams) => {
    return ipcRenderer.invoke('process-photo', params);
  },

  saveFile: (base64: string, defaultName: string) => {
    return ipcRenderer.invoke('save-file', base64, defaultName);
  },
});
