import React, { useEffect, useRef, useState } from 'react';
import {
  useElectronApi,
  type DownloadProgress,
  type ElectronModelStatus,
} from '../hooks/useElectronApi';

interface ModelManagerProps {
  onClose: () => void;
  initialModelKey?: string | null;
}

export default function ModelManager({ onClose, initialModelKey = null }: ModelManagerProps) {
  const { getModelStatus, downloadModel, deleteModel, setSelectedModel } = useElectronApi();
  const [status, setStatus] = useState<ElectronModelStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloadingModelKey, setDownloadingModelKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const autoStartedRef = useRef(false);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      setStatus(await getModelStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取模型状态失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    return () => {
      unsubscribeRef.current?.();
    };
  }, []);

  useEffect(() => {
    autoStartedRef.current = false;
  }, [initialModelKey]);

  useEffect(() => {
    if (!status || !initialModelKey || autoStartedRef.current || downloadingModelKey) {
      return;
    }
    const target = status.models.find((item) => item.key === initialModelKey);
    if (target && !target.downloaded) {
      autoStartedRef.current = true;
      handleDownload(target.key);
    }
  }, [status, initialModelKey, downloadingModelKey]);

  const handleDownload = async (modelKey: string) => {
    setDownloadingModelKey(modelKey);
    setProgress(null);
    setError('');
    unsubscribeRef.current?.();
    unsubscribeRef.current = await downloadModel(
      modelKey,
      (data) => setProgress(data),
      async () => {
        setDownloadingModelKey(null);
        setProgress(null);
        await refresh();
      },
      (message) => {
        setDownloadingModelKey(null);
        setProgress(null);
        setError(`下载失败: ${message}`);
      },
    );
  };

  const handleDelete = async (modelKey: string) => {
    if (!confirm('确定要删除该模型吗?')) return;
    setError('');
    try {
      await deleteModel(modelKey);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleSelect = async (modelKey: string) => {
    setError('');
    try {
      await setSelectedModel(modelKey);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换默认模型失败');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>模式资源管理</h3>
          <button type="button" className="modal-close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          {loading && <p className="model-loading">加载中...</p>}
          {error && <p className="model-error">{error}</p>}

          {!loading && status?.models.map((model) => {
            const isSelected = status.selected_model === model.key;
            const isDownloading = downloadingModelKey === model.key;
            return (
              <div key={model.key} className="model-card">
                <div className="model-info">
                  <div className="model-name">
                    {model.name}
                    {model.recommended ? '（推荐）' : ''}
                  </div>
                  <div className="model-detail">{model.description}</div>
                  <div className="model-status-row">
                    <span className={`model-status-badge ${model.downloaded ? 'downloaded' : 'not-downloaded'}`}>
                      {model.downloaded ? '已就绪' : '未就绪'}
                    </span>
                    {isSelected && <span className="model-status-badge downloaded">当前默认</span>}
                  </div>
                </div>

                <div className="model-actions">
                  {isDownloading ? (
                    <button type="button" className="btn btn-secondary btn-sm" disabled>
                      下载中
                    </button>
                  ) : !model.downloaded ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => handleDownload(model.key)}
                    >
                      {model.key === 'fast_hivision_modnet' ? '检查' : '下载'}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleSelect(model.key)}
                        disabled={isSelected}
                      >
                        {isSelected ? '已选中' : '设为默认'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDelete(model.key)}
                        disabled={isSelected || model.key === 'fast_hivision_modnet'}
                      >
                        删除
                      </button>
                    </>
                  )}
                </div>

                {isDownloading && progress && (
                  <div className="download-progress">
                    <div className="progress-bar-track">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${Math.min(progress.progress * 100, 100)}%` }}
                      />
                    </div>
                    <div className="progress-info">
                      <span>{(progress.progress * 100).toFixed(1)}%</span>
                      <span>{progress.speed}</span>
                      <span>{progress.eta}</span>
                    </div>
                    {progress.source && (
                      <div className="progress-source">来源: {progress.source}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
