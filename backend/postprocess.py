"""
后处理模块
提供背景合成、尺寸调整、DPI 设置和压缩功能。
"""

from __future__ import annotations

import io

from PIL import Image


def mm_to_px(mm: float, dpi: int) -> int:
    """将毫米转换为像素值。1 inch = 25.4 mm。"""
    return round(mm / 25.4 * dpi)


def add_background(rgba_image: Image.Image, bg_color: str) -> Image.Image:
    """
    将 RGBA 图像合成到纯色背景上，返回 RGB 图像。

    Parameters
    ----------
    rgba_image : PIL.Image.Image
        RGBA 模式的抠图结果。
    bg_color : str
        十六进制颜色，如 "#FFFFFF"。

    Returns
    -------
    PIL.Image.Image
        RGB 模式的合成图像。
    """
    rgba = rgba_image.convert("RGBA")
    color = bg_color.lstrip("#")
    r, g, b = int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16)

    background = Image.new("RGBA", rgba.size, (r, g, b, 255))
    composite = Image.alpha_composite(background, rgba)
    return composite.convert("RGB")


def resize_to_spec(image: Image.Image, width_px: int, height_px: int) -> Image.Image:
    """
    将图像调整为指定的像素尺寸，使用 LANCZOS 高质量缩放。

    Parameters
    ----------
    image : PIL.Image.Image
        输入图像。
    width_px : int
        目标宽度（像素）。
    height_px : int
        目标高度（像素）。

    Returns
    -------
    PIL.Image.Image
        调整尺寸后的图像。
    """
    if width_px <= 0 or height_px <= 0:
        raise ValueError(f"目标尺寸无效: {width_px}x{height_px}")
    if image.size == (width_px, height_px):
        return image
    return image.resize((width_px, height_px), Image.LANCZOS)


def set_dpi(image: Image.Image, dpi: int) -> Image.Image:
    """
    设置图像的 DPI 元数据。

    Parameters
    ----------
    image : PIL.Image.Image
        输入图像。
    dpi : int
        目标 DPI 值。

    Returns
    -------
    PIL.Image.Image
        设置了 DPI 信息的图像（info 字典中包含 dpi 字段）。
    """
    image.info["dpi"] = (dpi, dpi)
    return image


def compress_to_size(
    image: Image.Image,
    max_kb: int,
    fmt: str,
    dpi: int,
) -> bytes:
    """
    通过二分查找 JPEG 质量参数，将图像压缩到指定大小以内。
    PNG 格式不支持有损压缩，直接返回 optimize 后的结果。

    Parameters
    ----------
    image : PIL.Image.Image
        输入图像（RGB 模式）。
    max_kb : int
        最大文件大小（KB）。
    fmt : str
        输出格式 "jpg" 或 "png"。
    dpi : int
        DPI 值，写入输出文件。

    Returns
    -------
    bytes
        编码后的图片字节数据。
    """
    max_bytes = max_kb * 1024

    if fmt.lower() == "png":
        buf = io.BytesIO()
        image.save(buf, format="PNG", dpi=(dpi, dpi), optimize=True)
        return buf.getvalue()

    # JPEG: 先试最高质量
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=95, dpi=(dpi, dpi), optimize=True)
    data = buf.getvalue()
    if len(data) <= max_bytes:
        return data

    # 二分查找合适的质量
    lo, hi = 1, 95
    best_data = None

    while lo <= hi:
        mid = (lo + hi) // 2
        buf = io.BytesIO()
        image.save(buf, format="JPEG", quality=mid, dpi=(dpi, dpi), optimize=True)
        data = buf.getvalue()
        if len(data) <= max_bytes:
            best_data = data
            lo = mid + 1  # 尝试更高质量
        else:
            hi = mid - 1

    if best_data is not None:
        return best_data

    # 最低质量仍然超限，返回最低质量结果
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=1, dpi=(dpi, dpi), optimize=True)
    return buf.getvalue()


def encode_image(
    image: Image.Image,
    fmt: str,
    dpi: int,
    max_kb: int | None = None,
) -> bytes:
    """
    将图像编码为指定格式的字节数据。
    如果指定了 max_kb，对 JPEG 格式使用压缩。

    Parameters
    ----------
    image : PIL.Image.Image
        输入图像。
    fmt : str
        输出格式 "jpg" 或 "png"。
    dpi : int
        DPI 值。
    max_kb : int | None
        最大文件大小限制（KB），为 None 则不限制。

    Returns
    -------
    bytes
        编码后的图片字节数据。
    """
    if max_kb is not None and max_kb > 0:
        return compress_to_size(image, max_kb, fmt, dpi)

    pil_format = "JPEG" if fmt.lower() in ("jpg", "jpeg") else "PNG"
    buf = io.BytesIO()
    save_kwargs: dict = {"format": pil_format, "dpi": (dpi, dpi), "optimize": True}
    if pil_format == "JPEG":
        save_kwargs["quality"] = 95
    image.save(buf, **save_kwargs)
    return buf.getvalue()
