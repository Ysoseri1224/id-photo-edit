import { useCallback } from 'react';

interface ElectronModelStatusItem {
  key: string;
  name: string;
  description: string;
  downloaded: boolean;
  recommended?: boolean;
}

interface ElectronModelStatus {
  selected_model: string;
  models: ElectronModelStatusItem[];
}

interface DownloadProgress {
  progress: number;
  speed: string;
  eta: string;
  source?: string;
}

interface ProcessParams {
  image_base64: string;
  model_key: string;
  bg_color: string;
  width_px: number;
  height_px: number;
  dpi: number;
  format: string;
  max_size_kb?: number;
}

interface ProcessResult {
  result_base64: string;
  width_px: number;
  height_px: number;
  actual_size_kb: number;
}

interface ElectronAPI {
  getModelStatus: () => Promise<ElectronModelStatus>;
  downloadModel: (modelKey: string) => Promise<void>;
  onModelDownloadProgress: (callback: (payload: {
    modelKey: string;
    progress: number;
    speed: string;
    eta: string;
    source?: string;
    done?: boolean;
    error?: string;
  }) => void) => (() => void);
  deleteModel: (modelKey: string) => Promise<void>;
  setSelectedModel: (modelKey: string) => Promise<void>;
  processPhoto: (params: ProcessParams) => Promise<ProcessResult>;
  saveFile: (base64: string, defaultName: string) => Promise<string | null>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export function useElectronApi() {
  const api = window.electronAPI;

  const requireApi = useCallback((): ElectronAPI => {
    if (!api) {
      throw new Error('当前环境不支持桌面能力，请使用 Electron 应用启动');
    }
    return api;
  }, [api]);

  const getModelStatus = useCallback(async (): Promise<ElectronModelStatus> => {
    return requireApi().getModelStatus();
  }, [requireApi]);

  const downloadModel = useCallback(async (
    modelKey: string,
    onProgress: (data: DownloadProgress) => void,
    onComplete: () => void,
    onError: (message: string) => void,
  ): Promise<() => void> => {
    const electronApi = requireApi();
    const unsubscribe = electronApi.onModelDownloadProgress((payload) => {
      if (payload.modelKey !== modelKey) {
        return;
      }
      if (payload.error) {
        onError(payload.error);
        return;
      }
      if (payload.done) {
        onComplete();
        return;
      }
      onProgress({
        progress: payload.progress,
        speed: payload.speed,
        eta: payload.eta,
        source: payload.source,
      });
    });

    electronApi.downloadModel(modelKey).catch((error) => {
      onError(error instanceof Error ? error.message : '下载失败');
    });

    return unsubscribe;
  }, [requireApi]);

  const deleteModel = useCallback(async (modelKey: string): Promise<void> => {
    await requireApi().deleteModel(modelKey);
  }, [requireApi]);

  const setSelectedModel = useCallback(async (modelKey: string): Promise<void> => {
    await requireApi().setSelectedModel(modelKey);
  }, [requireApi]);

  const processPhoto = useCallback(async (params: ProcessParams): Promise<ProcessResult> => {
    return requireApi().processPhoto(params);
  }, [requireApi]);

  const saveFile = useCallback(async (base64: string, defaultName: string): Promise<string | null> => {
    return requireApi().saveFile(base64, defaultName);
  }, [requireApi]);

  return {
    getModelStatus,
    downloadModel,
    deleteModel,
    setSelectedModel,
    processPhoto,
    saveFile,
  };
}

export type {
  ElectronModelStatus,
  ElectronModelStatusItem,
  DownloadProgress,
  ProcessParams,
  ProcessResult,
};
