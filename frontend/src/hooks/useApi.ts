import { useCallback } from 'react';

// ---------------------------------------------------------------------------
// Electron environment detection & API base URL
// ---------------------------------------------------------------------------

interface ElectronAPI {
  getSidecarPort: () => Promise<number>;
  saveFile: (base64: string, defaultName: string) => Promise<string | null>;
  platform: string;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

/**
 * Resolve the base URL for backend API calls.
 *
 * - In Electron (dev or production) the sidecar port is passed via the URL
 *   query string (`?sidecarPort=XXXXX`) or can be obtained from the preload
 *   bridge. We build an absolute origin so fetch works even when the page is
 *   served from `file://`.
 * - In plain browser dev mode the Vite proxy at `/api` forwards to the
 *   backend, so we keep the `/api` prefix.
 */
function getApiBase(): string {
  // 1. Check URL query string (works in both Electron dev & prod)
  const params = new URLSearchParams(window.location.search);
  const portFromQuery = params.get('sidecarPort');
  if (portFromQuery) {
    return `http://127.0.0.1:${portFromQuery}`;
  }

  // 2. If electronAPI exists, we are in Electron but port was not in query.
  //    Fall through – the port will be resolved asynchronously in the hook
  //    init. For now return empty string (will be overwritten).
  //    This case should not normally happen because main.ts always passes
  //    the query param.

  // 3. Plain browser / Vite dev server – use the proxy prefix
  return '/api';
}

let _apiBase: string = getApiBase();

/** Allow the hook to lazily update the base once the port is known. */
async function ensureApiBase(): Promise<string> {
  if (_apiBase && _apiBase !== '') return _apiBase;
  if (window.electronAPI) {
    const port = await window.electronAPI.getSidecarPort();
    _apiBase = `http://127.0.0.1:${port}`;
  }
  return _apiBase;
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface HealthResponse {
  status: string;
}

interface ModelStatus {
  fast: {
    name: string;
    downloaded: boolean;
    size_mb?: number;
  };
  precise: {
    name: string;
    downloaded: boolean;
    size_mb?: number;
  };
}

interface ApiErrorData {
  error?: string;
  code?: string;
  missing_model?: {
    mode: 'fast' | 'precise';
    name: string;
  };
}

class ApiError extends Error {
  status: number;
  code?: string;
  missingModel?: {
    mode: 'fast' | 'precise';
    name: string;
  };

  constructor(message: string, status: number, data?: ApiErrorData) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = data?.code;
    this.missingModel = data?.missing_model;
  }
}

interface DownloadProgress {
  progress: number;
  speed: string;
  eta: string;
  source?: string;
}

interface DownloadEvent {
  type: 'speed_test' | 'selected_source' | 'progress' | 'done' | 'error';
  data: Record<string, unknown>;
}

interface ProcessParams {
  image_base64: string;
  matting_mode: 'fast' | 'precise';
  bg_color: string;
  output_mode: string;
  width_px?: number;
  height_px?: number;
  width_mm?: number;
  height_mm?: number;
  dpi: number;
  format: string;
  max_size_kb?: number | null;
}

interface ProcessResult {
  result_base64: string;
  width_px: number;
  height_px: number;
  actual_size_kb: number;
}

export function useApi() {
  const checkHealth = useCallback(async (): Promise<HealthResponse> => {
    const res = await apiFetch('/health');
    if (!res.ok) throw new Error('health check failed');
    return res.json();
  }, []);

  const getModelStatus = useCallback(async (): Promise<ModelStatus> => {
    const res = await apiFetch('/models/status');
    if (!res.ok) throw new Error('failed to get model status');
    return res.json();
  }, []);

  const downloadModel = useCallback(
    (
      mode: 'fast' | 'precise',
      onProgress: (data: DownloadProgress) => void,
      onComplete: () => void,
      onError: (err: string) => void,
    ): (() => void) => {
      const controller = new AbortController();
      const startedAt = Date.now();

      (async () => {
        try {
          const res = await apiFetch('/models/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode }),
            signal: controller.signal,
          });

          if (!res.ok) {
            onError('download request failed');
            return;
          }

          const reader = res.body?.getReader();
          if (!reader) {
            onError('no response body');
            return;
          }

          const decoder = new TextDecoder();
          let buffer = '';
          let eventType = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split('\n\n');
            buffer = chunks.pop() || '';

            for (const chunk of chunks) {
              const lines = chunk
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean);

              for (const line of lines) {
                if (line.startsWith('event: ')) {
                  eventType = line.slice(7);
                  continue;
                }

                if (!line.startsWith('data: ')) continue;

                const jsonStr = line.slice(6);
                if (jsonStr === '[DONE]') {
                  onComplete();
                  return;
                }

                try {
                  const data = JSON.parse(jsonStr) as Record<string, unknown>;
                  const event: DownloadEvent = {
                    type: (eventType || 'progress') as DownloadEvent['type'],
                    data,
                  };

                  if (event.type === 'error') {
                    const message =
                      typeof event.data.message === 'string'
                        ? event.data.message
                        : 'download failed';
                    if (message.includes('尝试下一个源')) {
                      continue;
                    }
                    onError(message);
                    return;
                  }

                  if (event.type === 'done') {
                    onComplete();
                    return;
                  }

                  if (event.type === 'selected_source') {
                    onProgress({
                      progress: 0,
                      speed: '测速中',
                      eta: '正在估算',
                      source:
                        typeof event.data.label === 'string' ? event.data.label : undefined,
                    });
                    continue;
                  }

                  if (event.type === 'progress') {
                    const downloadedBytes = Number(event.data.downloaded_bytes ?? 0);
                    const totalBytes = Number(event.data.total_bytes ?? 0);
                    const percent = Number(event.data.percent ?? 0);
                    const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.1);
                    const bytesPerSecond = downloadedBytes > 0 ? downloadedBytes / elapsedSeconds : 0;
                    onProgress({
                      progress: Number.isFinite(percent) ? percent / 100 : 0,
                      speed: formatSpeed(bytesPerSecond),
                      eta: formatEta(downloadedBytes, totalBytes, bytesPerSecond),
                    });
                  }
                } catch {
                  // skip malformed data
                }
              }

              eventType = '';
            }
          }

          onComplete();
        } catch (err) {
          if (controller.signal.aborted) return;
          onError(err instanceof Error ? err.message : 'download failed');
        }
      })();

      return () => controller.abort();
    },
    [],
  );

  const deleteModelCache = useCallback(async (mode: 'fast' | 'precise'): Promise<void> => {
    const res = await apiFetch('/models/cache', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (!res.ok) throw new Error('failed to delete model cache');
  }, []);

  const processImage = useCallback(async (params: ProcessParams): Promise<ProcessResult> => {
    const res = await apiFetch('/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      let msg = '处理失败';
      let errorData: ApiErrorData | undefined;
      try {
        const body = (await res.json()) as ApiErrorData;
        errorData = body;
        if (body.error) msg = body.error;
      } catch {
        const text = await res.text();
        if (text) msg = text;
      }
      throw new ApiError(msg, res.status, errorData);
    }
    return res.json();
  }, []);

  return { checkHealth, getModelStatus, downloadModel, deleteModelCache, processImage };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '速度统计中';

  const mbPerSecond = bytesPerSecond / (1024 * 1024);
  if (mbPerSecond >= 1) return `${mbPerSecond.toFixed(1)} MB/s`;

  const kbPerSecond = bytesPerSecond / 1024;
  return `${kbPerSecond.toFixed(0)} KB/s`;
}

function formatEta(downloadedBytes: number, totalBytes: number, bytesPerSecond: number): string {
  if (
    !Number.isFinite(downloadedBytes) ||
    !Number.isFinite(totalBytes) ||
    totalBytes <= 0 ||
    !Number.isFinite(bytesPerSecond) ||
    bytesPerSecond <= 0
  ) {
    return '正在估算';
  }

  const remainingSeconds = Math.max((totalBytes - downloadedBytes) / bytesPerSecond, 0);

  if (remainingSeconds < 5) return '即将完成';
  if (remainingSeconds < 60) return `预计 ${Math.ceil(remainingSeconds)} 秒后完成`;

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = Math.ceil(remainingSeconds % 60);

  if (minutes < 60) {
    if (seconds === 60) return `预计 ${minutes + 1} 分钟后完成`;
    if (seconds === 0) return `预计 ${minutes} 分钟后完成`;
    return `预计 ${minutes} 分 ${seconds} 秒后完成`;
  }

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (restMinutes === 0) return `预计 ${hours} 小时后完成`;
  return `预计 ${hours} 小时 ${restMinutes} 分钟后完成`;
}

export { ApiError };
export type { HealthResponse, ModelStatus, DownloadProgress, ProcessParams, ProcessResult };

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = await ensureApiBase();

  try {
    return await fetch(`${base}${path}`, init);
  } catch (error) {
    throw new Error(buildNetworkErrorMessage(base, error));
  }
}

function buildNetworkErrorMessage(base: string, error: unknown): string {
  const reason = error instanceof Error ? error.message : 'unknown network error';

  if (base === '/api') {
    return `无法连接到本地后端服务。请使用 \`npm run dev\` 启动前后端，或确认 8765 端口上的后端可用。原始错误: ${reason}`;
  }

  return `无法连接到后端服务 ${base}。请确认应用后端已启动。原始错误: ${reason}`;
}
