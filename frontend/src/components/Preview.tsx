import React from 'react';

interface PreviewProps {
  originalSrc: string;
  resultSrc: string;
  resultWidth: number;
  resultHeight: number;
  resultFileSize: number;
}

function formatSize(kb: number): string {
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

export default function Preview({
  originalSrc,
  resultSrc,
  resultWidth,
  resultHeight,
  resultFileSize,
}: PreviewProps) {
  return (
    <div className="preview-container">
      <div className="preview-images">
        <div className="preview-card">
          <h4 className="preview-card-title">原始裁剪</h4>
          <div className="preview-img-wrap">
            <img src={originalSrc} alt="original" className="preview-img" />
          </div>
        </div>
        <div className="preview-card">
          <h4 className="preview-card-title">处理结果</h4>
          <div className="preview-img-wrap">
            <img src={resultSrc} alt="result" className="preview-img" />
          </div>
        </div>
      </div>
      <div className="preview-meta">
        <span>尺寸: {resultWidth} x {resultHeight} px</span>
        <span>大小: {formatSize(resultFileSize)}</span>
      </div>
    </div>
  );
}
