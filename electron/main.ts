import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import { spawn, ChildProcess } from 'child_process';
import isDev from 'electron-is-dev';

let mainWindow: BrowserWindow | null = null;
let sidecarProcess: ChildProcess | null = null;
let sidecarPort: number = 0;
let frontendDevUrl: string | null = null;

// ---------------------------------------------------------------------------
// Port helpers
// ---------------------------------------------------------------------------

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr !== 'string') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('无法获取可用端口')));
      }
    });
    server.on('error', reject);
  });
}

function checkUrlAvailable(url: string, timeoutMs: number = 1500): Promise<boolean> {
  const http = require('http') as typeof import('http');

  return new Promise((resolve) => {
    const req = http.get(url, (res: import('http').IncomingMessage) => {
      resolve((res.statusCode ?? 500) < 500);
      res.resume();
    });

    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function resolveFrontendDevUrl(): Promise<string> {
  const candidates = [5173, 5174, 5175, 5176, 5177, 5178];

  for (const port of candidates) {
    const url = `http://localhost:${port}`;
    if (await checkUrlAvailable(url)) {
      return url;
    }
  }

  return 'http://localhost:5173';
}

// ---------------------------------------------------------------------------
// Health-check: poll GET /health until sidecar is ready
// ---------------------------------------------------------------------------

function waitForSidecar(port: number, timeoutMs: number = 10000, intervalMs: number = 500): Promise<void> {
  const http = require('http') as typeof import('http');

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function poll() {
      if (Date.now() > deadline) {
        return reject(new Error('后端服务启动超时，请检查 Python 环境是否正确配置。'));
      }

      const req = http.get(`http://127.0.0.1:${port}/health`, (res: import('http').IncomingMessage) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          setTimeout(poll, intervalMs);
        }
      });

      req.on('error', () => {
        setTimeout(poll, intervalMs);
      });

      req.setTimeout(intervalMs, () => {
        req.destroy();
        setTimeout(poll, intervalMs);
      });
    }

    poll();
  });
}

// ---------------------------------------------------------------------------
// Sidecar lifecycle
// ---------------------------------------------------------------------------

async function startSidecar(): Promise<number> {
  const port = await findAvailablePort();

  let command: string;
  let args: string[];

  if (isDev) {
    command = 'python';
    args = [
      path.join(app.getAppPath(), 'backend', 'main.py'),
      '--port',
      String(port),
    ];
  } else {
    // Production: PyInstaller binary located in resources
    const resourcesDir = path.join(process.resourcesPath, 'backend');
    const ext = process.platform === 'win32' ? '.exe' : '';
    command = path.join(resourcesDir, `main${ext}`);
    args = ['--port', String(port)];
  }

  return new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    sidecarProcess = child;
    let resolved = false;

    // Read the first line of stdout to confirm the port
    let stdoutBuffer = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      if (!resolved) {
        stdoutBuffer += chunk.toString();
        const newlineIndex = stdoutBuffer.indexOf('\n');
        if (newlineIndex !== -1) {
          const firstLine = stdoutBuffer.substring(0, newlineIndex).trim();
          const parsedPort = parseInt(firstLine, 10);
          // If the first line is a valid port number, use it; otherwise keep the assigned port.
          if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort < 65536) {
            resolved = true;
            resolve(parsedPort);
          } else {
            // First line was not a port — sidecar may just be logging. Use the assigned port.
            resolved = true;
            resolve(port);
          }
        }
      }
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      console.error('[sidecar stderr]', chunk.toString());
    });

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`后端进程启动失败：${err.message}`));
      }
    });

    child.on('exit', (code, signal) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`后端进程异常退出（代码: ${code}, 信号: ${signal}）`));
      } else {
        // Unexpected exit after startup
        handleSidecarUnexpectedExit(code, signal);
      }
    });

    // Fallback: if stdout never gives us a first line within 5s, resolve with assigned port
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(port);
      }
    }, 5000);
  });
}

function handleSidecarUnexpectedExit(code: number | null, signal: string | null) {
  sidecarProcess = null;

  const message =
    `后端服务意外退出。\n` +
    `退出代码：${code ?? '未知'}\n` +
    `信号：${signal ?? '无'}\n\n` +
    `应用程序将关闭，请重新启动。`;

  dialog.showErrorBox('后端服务异常', message);

  app.quit();
}

function killSidecar() {
  if (!sidecarProcess) return;

  try {
    if (process.platform === 'win32') {
      // On Windows, child_process.spawn creates a process but not a process group
      // by default. Use taskkill /T to kill the process tree.
      spawn('taskkill', ['/pid', String(sidecarProcess.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      // On macOS/Linux, send SIGTERM to the process group
      if (sidecarProcess.pid) {
        try {
          process.kill(-sidecarProcess.pid, 'SIGTERM');
        } catch {
          // If process group kill fails, try direct kill
          sidecarProcess.kill('SIGTERM');
        }
      }
    }
  } catch (err) {
    console.error('终止后端进程时出错：', err);
  }

  sidecarProcess = null;
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

function createWindow() {
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
    mainWindow.loadURL(`${devUrl}?sidecarPort=${sidecarPort}`);
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(app.getAppPath(), 'dist-frontend', 'index.html');
    mainWindow.loadFile(indexPath, {
      query: { sidecarPort: String(sidecarPort) },
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

function registerIpcHandlers() {
  ipcMain.handle('get-sidecar-port', () => {
    return sidecarPort;
  });

  ipcMain.handle('save-file', async (_event, base64Data: string, defaultName: string) => {
    if (!mainWindow) return null;

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '保存文件',
      defaultPath: defaultName,
      filters: [
        { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'bmp'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });

    if (canceled || !filePath) return null;

    try {
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(filePath, buffer);
      return filePath;
    } catch (err: any) {
      dialog.showErrorBox('保存失败', `文件保存失败：${err.message}`);
      return null;
    }
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  try {
    sidecarPort = await startSidecar();
    console.log(`后端服务已启动，端口：${sidecarPort}`);

    await waitForSidecar(sidecarPort);
    console.log('后端服务健康检查通过');
    if (isDev) {
      frontendDevUrl = await resolveFrontendDevUrl();
      console.log(`前端开发服务地址：${frontendDevUrl}`);
    }
  } catch (err: any) {
    dialog.showErrorBox(
      '启动失败',
      `后端服务启动失败：${err.message}\n\n请确保 Python 环境已正确配置。`
    );
    app.quit();
    return;
  }

  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  killSidecar();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  killSidecar();
});

// Ensure sidecar is cleaned up on unexpected termination
process.on('exit', () => {
  killSidecar();
});

process.on('SIGTERM', () => {
  killSidecar();
  app.quit();
});

process.on('SIGINT', () => {
  killSidecar();
  app.quit();
});
