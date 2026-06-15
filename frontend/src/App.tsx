import React, { useState, useCallback } from 'react';
import Cropper from './components/Cropper';
import ParamPanel from './components/ParamPanel';
import Preview from './components/Preview';
import ModelManager from './components/ModelManager';
import { presets } from './specs';
import { ApiError, useApi, type ProcessResult } from './hooks/useApi';
import './App.css';

type AppState = 'idle' | 'cropping' | 'processing' | 'done';
type MissingModelNotice = {
  mode: 'fast' | 'precise';
  name: string;
  message: string;
};

export default function App() {
  const [state, setState] = useState<AppState>('idle');
  const [showModelManager, setShowModelManager] = useState(false);
  const [modelManagerInitialMode, setModelManagerInitialMode] = useState<'fast' | 'precise' | null>(null);
  const [croppedImage, setCroppedImage] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState('');
  const [missingModelNotice, setMissingModelNotice] = useState<MissingModelNotice | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState('one-inch');
  const [outputFormat, setOutputFormat] = useState('jpg');

  const { processImage, getModelStatus } = useApi();

  const selectedPreset = presets.find((p) => p.id === selectedPresetId);
  const aspectRatio =
    selectedPreset && selectedPreset.width_px && selectedPreset.height_px
      ? selectedPreset.width_px / selectedPreset.height_px
      : null;

  const handleCrop = useCallback((base64: string) => {
    setCroppedImage(base64);
    setState('cropping');
    setResult(null);
    setError('');
  }, []);

  const handleProcess = useCallback(
    async (params: {
      width_px: number;
      height_px: number;
      dpi: number;
      bg_color: string;
      format: string;
      max_size_kb?: number;
      mode: 'fast' | 'precise';
    }) => {
      if (!croppedImage) return;
      setError('');
      setMissingModelNotice(null);

      if (params.mode === 'precise') {
        try {
          const modelStatus = await getModelStatus();
          if (!modelStatus.precise.downloaded) {
            setMissingModelNotice({
              mode: 'precise',
              name: modelStatus.precise.name,
              message: '精准模式依赖 BiRefNet 模型。当前本地未下载，先下载后才能处理图片。',
            });
            setShowModelManager(false);
            return;
          }
        } catch {
          // Ignore preflight status failure and let the backend be the source of truth.
        }
      }

      setState('processing');

      try {
        setOutputFormat(params.format);
        const res = await processImage({
          image_base64: croppedImage,
          matting_mode: params.mode,
          bg_color: params.bg_color,
          output_mode: 'px',
          width_px: params.width_px,
          height_px: params.height_px,
          dpi: params.dpi,
          format: params.format,
          max_size_kb: params.max_size_kb ?? null,
        });
        setResult(res);
        setState('done');
      } catch (err) {
        if (err instanceof ApiError && err.code === 'MODEL_MISSING_PRECISE') {
          setMissingModelNotice({
            mode: err.missingModel?.mode ?? 'precise',
            name: err.missingModel?.name ?? 'BiRefNet',
            message: err.message,
          });
          setError('');
        } else {
          setError(err instanceof Error ? err.message : '处理失败');
        }
        setState('cropping');
      }
    },
    [croppedImage, getModelStatus, processImage],
  );

  const handleDownload = useCallback(async () => {
    if (!result) return;

    const ext = outputFormat === 'png' ? 'png' : 'jpg';
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
    const fileName = `证件照_${result.width_px}x${result.height_px}.${ext}`;

    // In Electron, prefer the native save dialog via IPC
    if (window.electronAPI?.saveFile) {
      await window.electronAPI.saveFile(result.result_base64, fileName);
      return;
    }

    // Browser fallback: create a data URI and trigger download
    const dataUri = `data:${mimeType};base64,${result.result_base64}`;
    const link = document.createElement('a');
    link.href = dataUri;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [result, outputFormat]);

  const handleNewImage = useCallback(() => {
    setCroppedImage(null);
    setResult(null);
    setState('idle');
    setError('');
    setMissingModelNotice(null);
  }, []);

  const openModelManager = useCallback((mode: 'fast' | 'precise' | null = null) => {
    setModelManagerInitialMode(mode);
    setShowModelManager(true);
  }, []);

  const closeModelManager = useCallback(() => {
    setShowModelManager(false);
    setModelManagerInitialMode(null);
  }, []);

  return (
    <div className="app">
      <header className="top-bar">
        <h1 className="app-title">证件照处理工具</h1>
        <button
          type="button"
          className="btn-icon"
          title="模型管理"
          onClick={() => openModelManager(null)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      </header>

      <main className="main-content">
        <div className="image-area">
          {state === 'idle' && (
            <Cropper aspectRatio={aspectRatio} onCrop={handleCrop} />
          )}

          {(state === 'cropping' || state === 'processing') && croppedImage && (
            <div className="cropped-preview-area">
              <div className="cropped-preview-wrap">
                <img src={croppedImage} alt="cropped" className="cropped-preview-img" />
                {state === 'processing' && (
                  <div className="processing-overlay">
                    <div className="spinner" />
                    <span>处理中...</span>
                  </div>
                )}
              </div>
              <div className="cropped-preview-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleNewImage}
                  disabled={state === 'processing'}
                >
                  重新选择
                </button>
              </div>
              {error && <p className="error-msg">{error}</p>}
            </div>
          )}

          {state === 'done' && croppedImage && result && (
            <div className="result-area">
              <Preview
                originalSrc={croppedImage}
                resultSrc={`data:image/${outputFormat === 'png' ? 'png' : 'jpeg'};base64,${result.result_base64}`}
                resultWidth={result.width_px}
                resultHeight={result.height_px}
                resultFileSize={result.actual_size_kb}
              />
              <div className="result-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleNewImage}
                >
                  处理新照片
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="param-area">
          <ParamPanel
            onProcess={handleProcess}
            resultReady={state === 'done'}
            onDownload={handleDownload}
            processing={state === 'processing'}
            imageCropped={croppedImage !== null}
          />
        </div>
      </main>

      {showModelManager && (
        <ModelManager onClose={closeModelManager} initialDownloadMode={modelManagerInitialMode} />
      )}

      {missingModelNotice && (
        <div className="modal-overlay" onClick={() => setMissingModelNotice(null)}>
          <div className="modal-content notice-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>需要先下载模型</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setMissingModelNotice(null)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="notice-copy">
                <p className="notice-title">{missingModelNotice.name} 未下载</p>
                <p className="notice-text">{missingModelNotice.message}</p>
                <p className="notice-hint">打开模型管理后会自动开始下载，下载完成即可继续使用精准模式。</p>
              </div>
              <div className="notice-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setMissingModelNotice(null);
                    openModelManager(missingModelNotice.mode);
                  }}
                >
                  下载并继续
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setMissingModelNotice(null)}
                >
                  稍后再说
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
