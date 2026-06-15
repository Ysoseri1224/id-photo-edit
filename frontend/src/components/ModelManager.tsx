import React, { useEffect, useState, useRef } from 'react';
import { useApi, type ModelStatus, type DownloadProgress } from '../hooks/useApi';

interface ModelManagerProps {
  onClose: () => void;
  initialDownloadMode?: 'fast' | 'precise' | null;
}

interface ModelInfo {
  key: 'fast' | 'precise';
  label: string;
  name: string;
  downloaded: boolean;
  size_mb?: number;
}

export default function ModelManager({ onClose, initialDownloadMode = null }: ModelManagerProps) {
  const { getModelStatus, downloadModel, deleteModelCache } = useApi();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState<'fast' | 'precise' | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const autoStartedRef = useRef(false);

  const fetchStatus = async () => {
    setLoading(true);
    setError('');
    try {
      const status: ModelStatus = await getModelStatus();
      setModels([
        {
          key: 'fast',
          label: '快速模式',
          name: status.fast.name,
          downloaded: status.fast.downloaded,
          size_mb: status.fast.size_mb,
        },
        {
          key: 'precise',
          label: '精准模式',
          name: status.precise.name,
          downloaded: status.precise.downloaded,
          size_mb: status.precise.size_mb,
        },
      ]);
    } catch {
      setError('获取模型状态失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    return () => {
      if (cancelRef.current) cancelRef.current();
    };
  }, []);

  useEffect(() => {
    autoStartedRef.current = false;
  }, [initialDownloadMode]);

  useEffect(() => {
    if (
      initialDownloadMode &&
      !autoStartedRef.current &&
      !loading &&
      downloading === null &&
      models.length > 0
    ) {
      const target = models.find((model) => model.key === initialDownloadMode);
      if (target && !target.downloaded) {
        autoStartedRef.current = true;
        handleDownload(initialDownloadMode);
      }
    }
  }, [initialDownloadMode, loading, downloading, models]);

  const handleDownload = (mode: 'fast' | 'precise') => {
    setDownloading(mode);
    setProgress(null);
    setError('');

    const cancel = downloadModel(
      mode,
      (data) => setProgress(data),
      () => {
        setDownloading(null);
        setProgress(null);
        fetchStatus();
      },
      (err) => {
        setDownloading(null);
        setProgress(null);
        setError(`下载失败: ${err}`);
      },
    );

    cancelRef.current = cancel;
  };

  const handleDelete = async (mode: 'fast' | 'precise') => {
    if (!confirm('确定要删除该模型缓存吗?')) return;
    setError('');
    try {
      await deleteModelCache(mode);
      await fetchStatus();
    } catch {
      setError('删除失败');
    }
  };

  const handleCancelDownload = () => {
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }
    setDownloading(null);
    setProgress(null);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>模型管理</h3>
          <button type="button" className="modal-close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          {loading && <p className="model-loading">加载中...</p>}

          {error && <p className="model-error">{error}</p>}

          {!loading &&
            models.map((m) => (
              <div key={m.key} className="model-card">
                <div className="model-info">
                  <div className="model-name">{m.label}</div>
                  <div className="model-detail">{m.name}</div>
                  <div className="model-status-row">
                    <span
                      className={`model-status-badge ${m.downloaded ? 'downloaded' : 'not-downloaded'}`}
                    >
                      {m.downloaded ? '已下载' : '未下载'}
                    </span>
                    {m.size_mb != null && (
                      <span className="model-size">{m.size_mb.toFixed(1)} MB</span>
                    )}
                  </div>
                </div>

                <div className="model-actions">
                  {downloading === m.key ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={handleCancelDownload}
                    >
                      取消
                    </button>
                  ) : m.downloaded ? (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDelete(m.key)}
                      disabled={downloading !== null}
                    >
                      删除
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => handleDownload(m.key)}
                      disabled={downloading !== null}
                    >
                      下载
                    </button>
                  )}
                </div>

                {downloading === m.key && progress && (
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
            ))}
        </div>
      </div>
    </div>
  );
}
