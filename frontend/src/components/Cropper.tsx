import React, { useRef, useState, useEffect, useCallback } from 'react';

interface CropperProps {
  aspectRatio?: number | null;
  onCrop: (croppedBase64: string) => void;
}

interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

type DragHandle =
  | 'move'
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw'
  | null;

const HANDLE_SIZE = 8;
const MIN_CROP = 30;

export default function Cropper({ aspectRatio, onCrop }: CropperProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);
  const [cropBox, setCropBox] = useState<CropBox>({ x: 0, y: 0, w: 0, h: 0 });
  const [lockRatio, setLockRatio] = useState(!!aspectRatio);
  const [dragging, setDragging] = useState<DragHandle>(null);
  const [dragStart, setDragStart] = useState({ mx: 0, my: 0, box: { x: 0, y: 0, w: 0, h: 0 } });
  const [isDragOver, setIsDragOver] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const displaySize = useRef({ w: 0, h: 0, offsetX: 0, offsetY: 0, scale: 1 });

  const effectiveRatio = lockRatio ? aspectRatio ?? null : null;

  const loadImage = useCallback((file: File) => {
    if (!file.type.match(/^image\/(jpeg|png|bmp)$/)) {
      alert('请选择 JPG、PNG 或 BMP 格式的图片');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    img.onload = () => {
      setImageEl(img);
    };
    img.src = imageSrc;
  }, [imageSrc]);

  useEffect(() => {
    if (!imageEl || !canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const cw = container.clientWidth;
    const ch = container.clientHeight;

    canvas.width = cw;
    canvas.height = ch;

    const scale = Math.min(cw / imageEl.width, ch / imageEl.height, 1);
    const dw = imageEl.width * scale;
    const dh = imageEl.height * scale;
    const ox = (cw - dw) / 2;
    const oy = (ch - dh) / 2;

    displaySize.current = { w: dw, h: dh, offsetX: ox, offsetY: oy, scale };

    const margin = Math.min(dw, dh) * 0.1;
    let bx = ox + margin;
    let by = oy + margin;
    let bw = dw - margin * 2;
    let bh = dh - margin * 2;

    if (aspectRatio && aspectRatio > 0) {
      const currentRatio = bw / bh;
      if (currentRatio > aspectRatio) {
        bw = bh * aspectRatio;
      } else {
        bh = bw / aspectRatio;
      }
      bx = ox + (dw - bw) / 2;
      by = oy + (dh - bh) / 2;
    }

    setCropBox({ x: bx, y: by, w: bw, h: bh });
    setLockRatio(!!aspectRatio);
  }, [imageEl, aspectRatio]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !imageEl) return;

    const { w: dw, h: dh, offsetX: ox, offsetY: oy } = displaySize.current;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.drawImage(imageEl, ox, oy, dw, dh);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.clearRect(cropBox.x, cropBox.y, cropBox.w, cropBox.h);
    ctx.drawImage(
      imageEl,
      (cropBox.x - ox) / displaySize.current.scale,
      (cropBox.y - oy) / displaySize.current.scale,
      cropBox.w / displaySize.current.scale,
      cropBox.h / displaySize.current.scale,
      cropBox.x,
      cropBox.y,
      cropBox.w,
      cropBox.h,
    );

    ctx.strokeStyle = '#4a90d9';
    ctx.lineWidth = 2;
    ctx.strokeRect(cropBox.x, cropBox.y, cropBox.w, cropBox.h);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      const gx = cropBox.x + (cropBox.w / 3) * i;
      const gy = cropBox.y + (cropBox.h / 3) * i;
      ctx.beginPath();
      ctx.moveTo(gx, cropBox.y);
      ctx.lineTo(gx, cropBox.y + cropBox.h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cropBox.x, gy);
      ctx.lineTo(cropBox.x + cropBox.w, gy);
      ctx.stroke();
    }

    const handles: Array<{ x: number; y: number }> = [
      { x: cropBox.x, y: cropBox.y },
      { x: cropBox.x + cropBox.w / 2, y: cropBox.y },
      { x: cropBox.x + cropBox.w, y: cropBox.y },
      { x: cropBox.x, y: cropBox.y + cropBox.h / 2 },
      { x: cropBox.x + cropBox.w, y: cropBox.y + cropBox.h / 2 },
      { x: cropBox.x, y: cropBox.y + cropBox.h },
      { x: cropBox.x + cropBox.w / 2, y: cropBox.y + cropBox.h },
      { x: cropBox.x + cropBox.w, y: cropBox.y + cropBox.h },
    ];

    ctx.fillStyle = '#4a90d9';
    for (const h of handles) {
      ctx.fillRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    }
  }, [imageEl, cropBox]);

  useEffect(() => {
    draw();
  }, [draw]);

  const getHandle = (mx: number, my: number): DragHandle => {
    const { x, y, w, h } = cropBox;
    const hs = HANDLE_SIZE + 4;

    const nearLeft = Math.abs(mx - x) < hs;
    const nearRight = Math.abs(mx - (x + w)) < hs;
    const nearTop = Math.abs(my - y) < hs;
    const nearBottom = Math.abs(my - (y + h)) < hs;

    if (nearTop && nearLeft) return 'nw';
    if (nearTop && nearRight) return 'ne';
    if (nearBottom && nearLeft) return 'sw';
    if (nearBottom && nearRight) return 'se';
    if (nearTop && mx > x && mx < x + w) return 'n';
    if (nearBottom && mx > x && mx < x + w) return 's';
    if (nearLeft && my > y && my < y + h) return 'w';
    if (nearRight && my > y && my < y + h) return 'e';
    if (mx > x && mx < x + w && my > y && my < y + h) return 'move';

    return null;
  };

  const getCursor = (handle: DragHandle): string => {
    switch (handle) {
      case 'n':
      case 's':
        return 'ns-resize';
      case 'e':
      case 'w':
        return 'ew-resize';
      case 'ne':
      case 'sw':
        return 'nesw-resize';
      case 'nw':
      case 'se':
        return 'nwse-resize';
      case 'move':
        return 'move';
      default:
        return 'default';
    }
  };

  const getCanvasCoords = (e: React.MouseEvent): { mx: number; my: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { mx: e.clientX - rect.left, my: e.clientY - rect.top };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const { mx, my } = getCanvasCoords(e);
    const handle = getHandle(mx, my);
    if (!handle) return;
    setDragging(handle);
    setDragStart({ mx, my, box: { ...cropBox } });
    e.preventDefault();
  };

  const clampBox = (box: CropBox): CropBox => {
    const { w: dw, h: dh, offsetX: ox, offsetY: oy } = displaySize.current;
    const result = { ...box };
    result.w = Math.max(result.w, MIN_CROP);
    result.h = Math.max(result.h, MIN_CROP);
    result.x = Math.max(result.x, ox);
    result.y = Math.max(result.y, oy);
    if (result.x + result.w > ox + dw) result.x = ox + dw - result.w;
    if (result.y + result.h > oy + dh) result.y = oy + dh - result.h;
    if (result.x < ox) { result.w = result.w - (ox - result.x); result.x = ox; }
    if (result.y < oy) { result.h = result.h - (oy - result.y); result.y = oy; }
    return result;
  };

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!canvasRef.current) return;
      const { mx, my } = getCanvasCoords(e);

      if (!dragging) {
        const handle = getHandle(mx, my);
        canvasRef.current.style.cursor = getCursor(handle);
        return;
      }

      const dx = mx - dragStart.mx;
      const dy = my - dragStart.my;
      const ob = dragStart.box;
      let newBox = { ...ob };

      if (dragging === 'move') {
        newBox.x = ob.x + dx;
        newBox.y = ob.y + dy;
      } else {
        const isTop = dragging.includes('n');
        const isBottom = dragging.includes('s');
        const isLeft = dragging.includes('w');
        const isRight = dragging.includes('e');

        if (isRight) newBox.w = ob.w + dx;
        if (isBottom) newBox.h = ob.h + dy;
        if (isLeft) { newBox.x = ob.x + dx; newBox.w = ob.w - dx; }
        if (isTop) { newBox.y = ob.y + dy; newBox.h = ob.h - dy; }

        if (effectiveRatio && effectiveRatio > 0) {
          if (isTop || isBottom) {
            newBox.w = newBox.h * effectiveRatio;
            if (isLeft) newBox.x = ob.x + ob.w - newBox.w;
          } else {
            newBox.h = newBox.w / effectiveRatio;
            if (isTop) newBox.y = ob.y + ob.h - newBox.h;
          }
        }
      }

      setCropBox(clampBox(newBox));
    },
    [dragging, dragStart, effectiveRatio, cropBox],
  );

  const handleMouseUp = () => {
    setDragging(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) loadImage(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadImage(file);
  };

  const handleConfirmCrop = () => {
    if (!imageEl) return;
    const { offsetX: ox, offsetY: oy, scale } = displaySize.current;

    const sx = (cropBox.x - ox) / scale;
    const sy = (cropBox.y - oy) / scale;
    const sw = cropBox.w / scale;
    const sh = cropBox.h / scale;

    if (![sx, sy, sw, sh].every(Number.isFinite) || sw <= 1 || sh <= 1) {
      alert('当前裁剪区域无效，请调整后重试');
      return;
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = Math.round(sw);
    tempCanvas.height = Math.round(sh);
    if (tempCanvas.width < 1 || tempCanvas.height < 1) {
      alert('当前裁剪区域过小，请调整后重试');
      return;
    }
    const ctx = tempCanvas.getContext('2d')!;
    ctx.drawImage(imageEl, sx, sy, sw, sh, 0, 0, tempCanvas.width, tempCanvas.height);

    const base64 = tempCanvas.toDataURL('image/png');
    if (!base64 || base64 === 'data:,' || !base64.startsWith('data:image/png;base64,')) {
      alert('裁剪结果生成失败，请重新裁剪后重试');
      return;
    }
    onCrop(base64);
  };

  const handleReset = () => {
    setImageSrc(null);
    setImageEl(null);
    setCropBox({ x: 0, y: 0, w: 0, h: 0 });
  };

  if (!imageSrc) {
    return (
      <div
        className={`cropper-upload-zone ${isDragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        <div className="upload-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
          </svg>
        </div>
        <p className="upload-text">拖拽图片到此处</p>
        <p className="upload-hint">或点击下方按钮选择文件</p>
        <label className="upload-btn">
          选择图片
          <input
            type="file"
            accept="image/jpeg,image/png,image/bmp"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
        </label>
        <p className="upload-format">支持 JPG / PNG / BMP 格式</p>
      </div>
    );
  }

  return (
    <div className="cropper-container">
      <div className="cropper-canvas-wrap" ref={containerRef}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>
      <div className="cropper-toolbar">
        <label className="toggle-label">
          <span>锁定比例</span>
          <button
            type="button"
            className={`toggle-switch ${lockRatio ? 'active' : ''}`}
            onClick={() => setLockRatio(!lockRatio)}
          >
            <span className="toggle-knob" />
          </button>
        </label>
        <div className="cropper-actions">
          <button type="button" className="btn btn-secondary" onClick={handleReset}>
            重新上传
          </button>
          <button type="button" className="btn btn-primary" onClick={handleConfirmCrop}>
            确认裁剪
          </button>
        </div>
      </div>
    </div>
  );
}
