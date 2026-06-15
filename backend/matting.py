"""
背景去除（抠图）模块
支持 fast (u2net_human_seg / rembg) 和 precise (BiRefNet / onnxruntime) 两种模式。
CPU-only 推理。
"""

import numpy as np
from PIL import Image

from model_manager import get_model_path


class MissingModelError(FileNotFoundError):
    """Raised when a required local model file is missing."""

    def __init__(self, mode: str, model_name: str, message: str):
        super().__init__(message)
        self.mode = mode
        self.model_name = model_name
        self.code = f"MODEL_MISSING_{mode.upper()}"


# ---------------------------------------------------------------------------
# 公共接口
# ---------------------------------------------------------------------------


def remove_background(image: Image.Image, mode: str = "fast") -> Image.Image:
    """
    去除图片背景，返回 RGBA 图像。

    Parameters
    ----------
    image : PIL.Image.Image
        输入图片（任意模式）。
    mode : str
        "fast"    -- 使用 rembg + u2net_human_seg，速度快。
        "precise" -- 使用 BiRefNet ONNX，精度高。

    Returns
    -------
    PIL.Image.Image
        RGBA 模式的抠图结果。
    """
    if mode == "fast":
        return _rembg_matting(image)
    elif mode == "precise":
        return _birefnet_matting(image)
    else:
        raise ValueError(f"不支持的抠图模式: {mode}，请使用 fast 或 precise")


# ---------------------------------------------------------------------------
# fast 模式 -- rembg + u2net_human_seg
# ---------------------------------------------------------------------------

_rembg_session = None


def _get_rembg_session():
    """懒加载并缓存 rembg session，避免每次推理重复加载模型。
    rembg 自带模型下载和缓存管理（~/.u2net/），无需手动下载。"""
    global _rembg_session
    if _rembg_session is not None:
        return _rembg_session

    try:
        from rembg import new_session
    except ImportError:
        raise RuntimeError("rembg 未安装，请执行 pip install rembg[cpu]")

    _rembg_session = new_session("u2net_human_seg")
    return _rembg_session


def _rembg_matting(image: Image.Image) -> Image.Image:
    """使用 rembg 进行背景去除。"""
    try:
        from rembg import remove
    except ImportError:
        raise RuntimeError("rembg 未安装，请执行 pip install rembg[cpu]")

    try:
        session = _get_rembg_session()
        result = remove(image, session=session)
        return result.convert("RGBA")
    except (FileNotFoundError, RuntimeError):
        raise
    except Exception as e:
        raise RuntimeError(f"快速抠图处理失败: {e}")


# ---------------------------------------------------------------------------
# precise 模式 -- BiRefNet ONNX
# ---------------------------------------------------------------------------

_birefnet_session = None


def _get_birefnet_session():
    """懒加载并缓存 BiRefNet ONNX session。"""
    global _birefnet_session
    if _birefnet_session is not None:
        return _birefnet_session

    model_path = get_model_path("precise")
    if not model_path.is_file():
        raise MissingModelError(
            "precise",
            "BiRefNet",
            "精细模式模型文件不存在，请先在设置中下载 BiRefNet 模型"
        )

    try:
        import onnxruntime as ort
    except ImportError:
        raise RuntimeError("onnxruntime 未安装，请执行 pip install onnxruntime")

    try:
        _birefnet_session = ort.InferenceSession(
            str(model_path), providers=["CPUExecutionProvider"]
        )
    except Exception as e:
        raise RuntimeError(f"加载精细抠图模型失败: {e}")

    return _birefnet_session


def _birefnet_matting(image: Image.Image) -> Image.Image:
    """使用 BiRefNet ONNX 进行背景去除。"""
    try:
        session = _get_birefnet_session()
        original_size = image.size  # (W, H)

        # 从模型输入获取期望的尺寸
        input_meta = session.get_inputs()[0]
        input_name = input_meta.name
        input_shape = input_meta.shape  # [N, C, H, W]
        h, w = input_shape[2], input_shape[3]

        # 预处理: RGB, resize, 归一化, HWC->NCHW
        img_resized = image.convert("RGB").resize((w, h), Image.LANCZOS)
        img_array = np.array(img_resized, dtype=np.float32) / 255.0
        # ImageNet 归一化
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        img_array = (img_array - mean) / std
        img_array = img_array.transpose(2, 0, 1)[np.newaxis, ...].astype(np.float32)

        # 推理
        outputs = session.run(None, {input_name: img_array})

        # 后处理: 取最后一个输出，squeeze，归一化到 [0, 255]
        raw_mask = outputs[-1]
        mask = raw_mask.squeeze()

        # sigmoid（如果输出是 logits）
        if mask.min() < 0 or mask.max() > 1.5:
            mask = 1.0 / (1.0 + np.exp(-mask))

        # 归一化到 [0, 1] 范围
        mask_min, mask_max = mask.min(), mask.max()
        if mask_max - mask_min > 1e-8:
            mask = (mask - mask_min) / (mask_max - mask_min)

        mask = (mask * 255).clip(0, 255).astype(np.uint8)

        # 缩放回原图尺寸
        mask_img = Image.fromarray(mask, mode="L").resize(original_size, Image.LANCZOS)

        # 合成 RGBA
        rgba = image.convert("RGBA")
        rgba.putalpha(mask_img)
        return rgba

    except (FileNotFoundError, RuntimeError):
        raise
    except Exception as e:
        raise RuntimeError(f"精细抠图处理失败: {e}")
