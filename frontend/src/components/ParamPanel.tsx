import React, { useState, useEffect } from 'react';
import { presets, type PhotoSpec } from '../specs';

interface ProcessParams {
  width_px: number;
  height_px: number;
  dpi: number;
  bg_color: string;
  format: string;
  max_size_kb?: number;
  model_key: string;
}

interface ModelOption {
  key: string;
  name: string;
  recommended?: boolean;
}

interface ParamPanelProps {
  onProcess: (params: ProcessParams) => void;
  resultReady: boolean;
  onDownload: () => void;
  processing: boolean;
  imageCropped: boolean;
  presetId: string;
  onPresetChange: (presetId: string) => void;
  modelOptions: ModelOption[];
  selectedModelKey: string;
  onSelectModel: (modelKey: string) => void;
  onOpenModelManager: (modelKey: string | null) => void;
}

const BG_COLORS = [
  { label: '白', value: '#FFFFFF' },
  { label: '蓝', value: '#438EDB' },
  { label: '红', value: '#D74532' },
  { label: '灰', value: '#F2F0F0' },
  { label: '深蓝', value: '#4B6190' },
  { label: '浅蓝', value: '#86C8E8' },
];

function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

function pxToMm(px: number, dpi: number): number {
  return Math.round((px / dpi) * 25.4 * 10) / 10;
}

export default function ParamPanel({
  onProcess,
  resultReady,
  onDownload,
  processing,
  imageCropped,
  presetId,
  onPresetChange,
  modelOptions,
  selectedModelKey,
  onSelectModel,
  onOpenModelManager,
}: ParamPanelProps) {
  const [sizeMode, setSizeMode] = useState<'mm' | 'px'>('mm');
  const [widthPx, setWidthPx] = useState(295);
  const [heightPx, setHeightPx] = useState(413);
  const [widthMm, setWidthMm] = useState(25);
  const [heightMm, setHeightMm] = useState(35);
  const [dpi, setDpi] = useState(300);
  const [bgColor, setBgColor] = useState('#FFFFFF');
  const [bgColorInput, setBgColorInput] = useState('#FFFFFF');
  const [format, setFormat] = useState<'jpg' | 'png'>('jpg');
  const [maxSizeKb, setMaxSizeKb] = useState<string>('100');

  const applyPreset = (spec: PhotoSpec) => {
    if (spec.width_px) setWidthPx(spec.width_px);
    if (spec.height_px) setHeightPx(spec.height_px);
    if (spec.width_mm) setWidthMm(spec.width_mm);
    if (spec.height_mm) setHeightMm(spec.height_mm);
    setDpi(spec.dpi);
    setBgColor(spec.bg_color);
    setBgColorInput(spec.bg_color);
    setFormat(spec.format);
    setMaxSizeKb(spec.max_size_kb?.toString() || '');

    if (spec.width_mm && spec.height_mm) {
      setSizeMode('mm');
    } else {
      setSizeMode('px');
    }
  };

  useEffect(() => {
    const spec = presets.find((p) => p.id === presetId);
    if (spec) applyPreset(spec);
  }, [presetId]);

  const handleWidthChange = (val: string) => {
    const num = parseInt(val, 10);
    if (isNaN(num) || num <= 0) return;
    if (sizeMode === 'mm') {
      setWidthMm(num);
      setWidthPx(mmToPx(num, dpi));
    } else {
      setWidthPx(num);
      setWidthMm(pxToMm(num, dpi));
    }
  };

  const handleHeightChange = (val: string) => {
    const num = parseInt(val, 10);
    if (isNaN(num) || num <= 0) return;
    if (sizeMode === 'mm') {
      setHeightMm(num);
      setHeightPx(mmToPx(num, dpi));
    } else {
      setHeightPx(num);
      setHeightMm(pxToMm(num, dpi));
    }
  };

  const handleDpiChange = (val: string) => {
    const num = parseInt(val, 10);
    if (isNaN(num) || num <= 0) return;
    setDpi(num);
    if (sizeMode === 'mm') {
      setWidthPx(mmToPx(widthMm, num));
      setHeightPx(mmToPx(heightMm, num));
    }
  };

  const handleBgColorInput = (val: string) => {
    setBgColorInput(val);
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      setBgColor(val);
    }
  };

  const handleProcess = () => {
    const params: ProcessParams = {
      width_px: widthPx,
      height_px: heightPx,
      dpi,
      bg_color: bgColor,
      format,
      model_key: selectedModelKey,
    };
    const sizeNum = parseInt(maxSizeKb, 10);
    if (!isNaN(sizeNum) && sizeNum > 0) {
      params.max_size_kb = sizeNum;
    }
    onProcess(params);
  };

  return (
    <div className="param-panel">
      <h3 className="panel-title">参数设置</h3>

      <div className="param-group">
        <label className="param-label">证件照规格</label>
        <select
          className="param-select"
          value={presetId}
          onChange={(e) => onPresetChange(e.target.value)}
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="param-group">
        <label className="param-label">处理模式</label>
        <select
          className="param-select"
          value={selectedModelKey}
          onChange={(e) => onSelectModel(e.target.value)}
        >
          {modelOptions.map((model) => (
            <option key={model.key} value={model.key}>
              {model.name}{model.recommended ? '（推荐）' : ''}
            </option>
          ))}
        </select>
        <div className="param-actions" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-secondary btn-block"
            onClick={() => onOpenModelManager(selectedModelKey)}
          >
            管理模式资源
          </button>
        </div>
      </div>

      <div className="param-group">
        <label className="param-label">背景颜色</label>
        <div className="color-swatches">
          {BG_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`color-swatch ${bgColor.toUpperCase() === c.value.toUpperCase() ? 'selected' : ''}`}
              style={{ backgroundColor: c.value }}
              title={c.label}
              onClick={() => {
                setBgColor(c.value);
                setBgColorInput(c.value);
              }}
            />
          ))}
        </div>
        <input
          type="text"
          className="param-input color-input"
          value={bgColorInput}
          onChange={(e) => handleBgColorInput(e.target.value)}
          placeholder="#FFFFFF"
          maxLength={7}
        />
      </div>

      <div className="param-group">
        <label className="param-label">尺寸模式</label>
        <div className="radio-group">
          <label className="radio-label">
            <input
              type="radio"
              name="sizeMode"
              checked={sizeMode === 'mm'}
              onChange={() => setSizeMode('mm')}
            />
            <span>毫米 (mm)</span>
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="sizeMode"
              checked={sizeMode === 'px'}
              onChange={() => setSizeMode('px')}
            />
            <span>像素 (px)</span>
          </label>
        </div>
      </div>

      <div className="param-row">
        <div className="param-group half">
          <label className="param-label">宽度 ({sizeMode})</label>
          <input
            type="number"
            className="param-input"
            value={sizeMode === 'mm' ? widthMm : widthPx}
            onChange={(e) => handleWidthChange(e.target.value)}
            min={1}
          />
        </div>
        <div className="param-group half">
          <label className="param-label">高度 ({sizeMode})</label>
          <input
            type="number"
            className="param-input"
            value={sizeMode === 'mm' ? heightMm : heightPx}
            onChange={(e) => handleHeightChange(e.target.value)}
            min={1}
          />
        </div>
      </div>

      <div className="param-group">
        <label className="param-label">DPI</label>
        <input
          type="number"
          className="param-input"
          value={dpi}
          onChange={(e) => handleDpiChange(e.target.value)}
          min={72}
          max={600}
        />
      </div>

      <div className="param-group">
        <label className="param-label">输出格式</label>
        <div className="radio-group">
          <label className="radio-label">
            <input
              type="radio"
              name="format"
              checked={format === 'jpg'}
              onChange={() => setFormat('jpg')}
            />
            <span>JPG</span>
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="format"
              checked={format === 'png'}
              onChange={() => setFormat('png')}
            />
            <span>PNG</span>
          </label>
        </div>
      </div>

      <div className="param-group">
        <label className="param-label">最大文件大小 (KB)</label>
        <input
          type="number"
          className="param-input"
          value={maxSizeKb}
          onChange={(e) => setMaxSizeKb(e.target.value)}
          placeholder="可选"
          min={1}
        />
      </div>

      <div className="param-actions">
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={!imageCropped || processing || !selectedModelKey}
          onClick={handleProcess}
        >
          {processing ? '处理中...' : '开始处理'}
        </button>

        {resultReady && (
          <button
            type="button"
            className="btn btn-success btn-block"
            onClick={onDownload}
          >
            下载结果
          </button>
        )}
      </div>
    </div>
  );
}
