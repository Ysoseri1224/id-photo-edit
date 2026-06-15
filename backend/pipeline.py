"""
处理流水线
串联抠图、背景合成、尺寸调整、DPI 设置和压缩，完成完整的证件照处理。
"""

import base64
import io

from PIL import Image

from matting import remove_background
from postprocess import (
    add_background,
    encode_image,
    mm_to_px,
    resize_to_spec,
    set_dpi,
)


def process_image(params: dict) -> dict:
    """
    完整的证件照处理流水线。

    Parameters
    ----------
    params : dict
        包含以下字段:
        - image_base64: str -- 输入图片的 Base64 编码（支持 data URI）
        - matting_mode: str -- "fast" 或 "precise"
        - bg_color: str -- 十六进制背景色，如 "#FFFFFF"
        - output_mode: str -- "mm" 或 "px"
        - width_mm: float | None -- 输出宽度（毫米），output_mode=="mm" 时必填
        - height_mm: float | None -- 输出高度（毫米），output_mode=="mm" 时必填
        - width_px: int | None -- 输出宽度（像素），output_mode=="px" 时必填
        - height_px: int | None -- 输出高度（像素），output_mode=="px" 时必填
        - dpi: int -- 输出 DPI
        - format: str -- "jpg" 或 "png"
        - max_size_kb: int | None -- 最大文件大小限制（KB）

    Returns
    -------
    dict
        {
            "result_base64": str,
            "actual_size_kb": float,
            "width_px": int,
            "height_px": int,
        }
    """
    # ------------------------------------------------------------------
    # 1. 解码 Base64 -> PIL Image
    # ------------------------------------------------------------------
    image_b64 = params.get("image_base64")
    if not image_b64:
        raise ValueError("缺少图片数据，请上传图片后重试")

    try:
        # 兼容 data URI 格式 (data:image/png;base64,xxxx)
        if "," in image_b64 and image_b64.index(",") < 100:
            image_b64 = image_b64.split(",", 1)[1]
        raw_bytes = base64.b64decode(image_b64)
        image = Image.open(io.BytesIO(raw_bytes))
    except Exception:
        raise ValueError("图片解码失败，请确认上传的是有效的图片文件")

    # 统一转为 RGB（处理 CMYK、P、LA 等模式）
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGB")

    # ------------------------------------------------------------------
    # 2. 抠图（去除背景）
    # ------------------------------------------------------------------
    matting_mode = params.get("matting_mode", "fast")
    rgba = remove_background(image, mode=matting_mode)

    # ------------------------------------------------------------------
    # 3. 合成背景
    # ------------------------------------------------------------------
    bg_color = params.get("bg_color", "#FFFFFF")
    result = add_background(rgba, bg_color)

    # ------------------------------------------------------------------
    # 4. 计算目标尺寸
    # ------------------------------------------------------------------
    dpi = params.get("dpi", 300)
    output_mode = params.get("output_mode", "px")

    if output_mode == "mm":
        w_mm = params.get("width_mm")
        h_mm = params.get("height_mm")
        if w_mm is None or h_mm is None:
            raise ValueError("毫米模式下必须指定 width_mm 和 height_mm")
        target_w = mm_to_px(float(w_mm), dpi)
        target_h = mm_to_px(float(h_mm), dpi)
    else:
        target_w = params.get("width_px")
        target_h = params.get("height_px")
        if target_w is None or target_h is None:
            raise ValueError("像素模式下必须指定 width_px 和 height_px")
        target_w = int(target_w)
        target_h = int(target_h)

    if target_w <= 0 or target_h <= 0:
        raise ValueError(f"目标尺寸无效: {target_w}x{target_h}，请检查参数")

    # ------------------------------------------------------------------
    # 5. 调整尺寸
    # ------------------------------------------------------------------
    result = resize_to_spec(result, target_w, target_h)

    # ------------------------------------------------------------------
    # 6. 设置 DPI 元数据
    # ------------------------------------------------------------------
    result = set_dpi(result, dpi)

    # ------------------------------------------------------------------
    # 7. 编码输出（压缩如果有大小限制）
    # ------------------------------------------------------------------
    fmt = params.get("format", "jpg")
    max_size_kb = params.get("max_size_kb")
    output_bytes = encode_image(result, fmt, dpi, max_kb=max_size_kb)

    # ------------------------------------------------------------------
    # 8. 构建返回结果
    # ------------------------------------------------------------------
    result_b64 = base64.b64encode(output_bytes).decode("ascii")
    actual_size_kb = round(len(output_bytes) / 1024, 1)

    return {
        "result_base64": result_b64,
        "actual_size_kb": actual_size_kb,
        "width_px": target_w,
        "height_px": target_h,
    }
