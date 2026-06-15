import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import isDev from 'electron-is-dev';
import {
  deleteModel,
  downloadModel,
  getModelStatus,
  processPhoto,
  setSelectedModel,
  type DownloadProgressPayload,
  type ProcessPhotoParams,
} from './modelService';

let mainWindow: BrowserWindow | null = null;
let frontendDevUrl: string | null = null;

const activeDownloads = new Map<string, Promise<void>>();

async function checkUrlAvailable(url: string, timeoutMs: number = 1500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForFrontendDevUrl(timeoutMs: number = 30000): Promise<string> {
  const candidates = [5173, 5174, 5175, 5176, 5177, 5178];
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    for (const port of candidates) {
      const url = `http://localhost:${port}`;
      if (await checkUrlAvailable(url)) {
        return url;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('前端开发服务启动超时，请先确认 Vite 已正常启动。');
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '证件照处理工具',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    const devUrl = frontendDevUrl ?? 'http://localhost:5173';
    await mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(app.getAppPath(), 'dist-frontend', 'index.html');
    await mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function emitDownloadProgress(payload: DownloadProgressPayload): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('model-download-progress', payload);
}

function registerIpcHandlers(): void {
  ipcMain.handle('get-model-status', async () => {
    return getModelStatus();
  });

  ipcMain.handle('download-model', async (_event, modelKey: string) => {
    if (activeDownloads.has(modelKey)) {
      return activeDownloads.get(modelKey);
    }

    const task = downloadModel(modelKey, emitDownloadProgress).finally(() => {
      activeDownloads.delete(modelKey);
    });

    activeDownloads.set(modelKey, task);
    return task;
  });

  ipcMain.handle('delete-model', async (_event, modelKey: string) => {
    deleteModel(modelKey);
  });

  ipcMain.handle('set-selected-model', async (_event, modelKey: string) => {
    setSelectedModel(modelKey);
  });

  ipcMain.handle('process-photo', async (_event, params: ProcessPhotoParams) => {
    return processPhoto(params);
  });

  ipcMain.handle('save-file', async (_event, base64Data: string, defaultName: string) => {
    if (!mainWindow) {
      return null;
    }

    const extension = path.extname(defaultName).replace('.', '').toLowerCase();
    const filters =
      extension === 'png'
        ? [{ name: 'PNG 图片', extensions: ['png'] }]
        : [{ name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] }];

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '保存文件',
      defaultPath: defaultName,
      filters: [...filters, { name: '所有文件', extensions: ['*'] }],
    });

    if (canceled || !filePath) {
      return null;
    }

    const payload = base64Data.includes(',') ? base64Data.split(',', 2)[1] : base64Data;
    fs.writeFileSync(filePath, Buffer.from(payload, 'base64'));
    return filePath;
  });
}

app.whenReady().then(async () => {
  try {
    if (isDev) {
      frontendDevUrl = await waitForFrontendDevUrl();
    }

    registerIpcHandlers();
    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    dialog.showErrorBox('启动失败', message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
