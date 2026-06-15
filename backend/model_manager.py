"""
模型下载管理器
负责模型源测速、下载（支持断点续传）、状态查询和缓存清理。
"""

from __future__ import annotations

import asyncio
import os
import platform
import time
from pathlib import Path
from typing import AsyncGenerator

import httpx

# ---------------------------------------------------------------------------
# 模型元数据
# ---------------------------------------------------------------------------

MODEL_META = {
    "fast": {
        "name": "u2net_human_seg",
        "filename": "u2net_human_seg.onnx",
        "description": "快速模式 (u2net_human_seg)",
    },
    "precise": {
        "name": "BiRefNet",
        "filename": "BiRefNet-general-epoch_244.onnx",
        "description": "精细模式 (BiRefNet)",
    },
}

# ---------------------------------------------------------------------------
# 下载源配置
# 每个源包含 base_url 与一个轻量级的 probe 文件（用于测速 HEAD 请求）。
# ---------------------------------------------------------------------------

SOURCES = [
    {
        "id": "huggingface",
        "label": "HuggingFace 官方",
        "base_urls": {
            "fast": "https://huggingface.co/danielgatis/rembg/resolve/main/u2net_human_seg.onnx",
            "precise": "https://huggingface.co/ZhengPeng7/BiRefNet/resolve/main/BiRefNet-general-epoch_244.onnx",
        },
        "probe": "https://huggingface.co/api/models",
    },
    {
        "id": "hf_mirror",
        "label": "hf-mirror 镜像",
        "base_urls": {
            "fast": "https://hf-mirror.com/danielgatis/rembg/resolve/main/u2net_human_seg.onnx",
            "precise": "https://hf-mirror.com/ZhengPeng7/BiRefNet/resolve/main/BiRefNet-general-epoch_244.onnx",
        },
        "probe": "https://hf-mirror.com/api/models",
    },
    {
        "id": "modelscope",
        "label": "ModelScope 魔搭",
        "base_urls": {
            "fast": "https://modelscope.cn/models/damo/cv_u2net_human-seg/resolve/master/u2net_human_seg.onnx",
            "precise": "https://modelscope.cn/models/ZhengPeng7/BiRefNet/resolve/master/BiRefNet-general-epoch_244.onnx",
        },
        "probe": "https://modelscope.cn/api/v1/models",
    },
    {
        "id": "github",
        "label": "GitHub Releases",
        "base_urls": {
            "fast": "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx",
            "precise": "https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-general-epoch_244.onnx",
        },
        "probe": "https://github.com",
    },
]

# ---------------------------------------------------------------------------
# 模型存储路径
# ---------------------------------------------------------------------------


def _get_model_dir() -> Path:
    """返回平台对应的模型存储目录。"""
    system = platform.system()
    if system == "Windows":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif system == "Darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    model_dir = base / "id-photo-tool" / "models"
    model_dir.mkdir(parents=True, exist_ok=True)
    return model_dir


MODEL_DIR = _get_model_dir()


def get_model_path(mode: str) -> Path:
    """获取指定模式的模型文件路径。"""
    meta = MODEL_META.get(mode)
    if meta is None:
        raise ValueError(f"未知模式: {mode}")
    return MODEL_DIR / meta["filename"]


# ---------------------------------------------------------------------------
# 测速
# ---------------------------------------------------------------------------

SPEED_TEST_TIMEOUT = 8  # 秒


async def _probe_source(source: dict, client: httpx.AsyncClient) -> tuple[str, float]:
    """对单个源发送 HEAD 探测请求，返回 (source_id, latency_ms)。超时/失败返回极大值。"""
    try:
        start = time.monotonic()
        resp = await client.head(source["probe"], timeout=SPEED_TEST_TIMEOUT, follow_redirects=True)
        elapsed_ms = (time.monotonic() - start) * 1000
        if resp.status_code < 400:
            return source["id"], round(elapsed_ms, 1)
    except Exception:
        pass
    return source["id"], 99999.0


async def speed_test_all() -> list[tuple[str, float]]:
    """并发测速所有源，返回按延迟排序的列表 [(source_id, latency_ms), ...]。"""
    async with httpx.AsyncClient() as client:
        tasks = [_probe_source(s, client) for s in SOURCES]
        results = await asyncio.gather(*tasks)
    results_sorted = sorted(results, key=lambda x: x[1])
    return results_sorted


# ---------------------------------------------------------------------------
# 模型状态
# ---------------------------------------------------------------------------


def get_model_status() -> dict:
    """返回每个模型的下载状态和文件大小。"""
    status = {}
    for mode, meta in MODEL_META.items():
        path = MODEL_DIR / meta["filename"]
        exists = path.is_file()
        size_mb = round(path.stat().st_size / (1024 * 1024), 1) if exists else 0
        status[mode] = {
            "name": meta["name"],
            "description": meta["description"],
            "downloaded": exists,
            "size_mb": size_mb,
            "path": str(path),
        }
    return status


# ---------------------------------------------------------------------------
# 模型下载（SSE 事件流）
# ---------------------------------------------------------------------------

CHUNK_SIZE = 256 * 1024  # 256 KB


async def download_model(mode: str) -> AsyncGenerator[str, None]:
    """
    下载指定模式的模型，以 SSE 事件流方式生成进度信息。
    事件类型: speed_test, selected_source, progress, done, error
    """
    import json

    meta = MODEL_META.get(mode)
    if meta is None:
        yield f"event: error\ndata: {json.dumps({'message': f'未知模式: {mode}'}, ensure_ascii=False)}\n\n"
        return

    dest = MODEL_DIR / meta["filename"]
    tmp = dest.with_suffix(dest.suffix + ".tmp")

    # 如果已存在完整文件，直接返回
    if dest.is_file():
        yield f"event: done\ndata: {json.dumps({'message': '模型已存在，无需下载', 'path': str(dest)}, ensure_ascii=False)}\n\n"
        return

    # 1. 测速
    yield f"event: speed_test\ndata: {json.dumps({'message': '正在测速各下载源...'}, ensure_ascii=False)}\n\n"
    ranked = await speed_test_all()
    yield f"event: speed_test\ndata: {json.dumps({'results': [{'source': sid, 'latency_ms': lat} for sid, lat in ranked]}, ensure_ascii=False)}\n\n"

    # 2. 按延迟依次尝试下载
    for source_id, latency in ranked:
        if latency >= 99999:
            continue

        source = next((s for s in SOURCES if s["id"] == source_id), None)
        if source is None:
            continue
        url = source["base_urls"].get(mode)
        if url is None:
            continue

        label = source["label"]
        yield f"event: selected_source\ndata: {json.dumps({'source': source_id, 'label': label, 'latency_ms': latency}, ensure_ascii=False)}\n\n"

        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
                # 断点续传：检查 tmp 文件
                downloaded = 0
                headers = {}
                if tmp.is_file():
                    downloaded = tmp.stat().st_size
                    headers["Range"] = f"bytes={downloaded}-"

                async with client.stream("GET", url, headers=headers) as resp:
                    if resp.status_code == 416:
                        # Range 不满足，重新下载
                        downloaded = 0
                        if tmp.is_file():
                            tmp.unlink()

                    if resp.status_code == 416:
                        # Re-issue the request without Range header
                        async with client.stream("GET", url) as resp2:
                            if resp2.status_code not in (200, 206):
                                yield f"event: error\ndata: {json.dumps({'message': f'{label} 返回 HTTP {resp2.status_code}，尝试下一个源'}, ensure_ascii=False)}\n\n"
                                continue

                            total2 = None
                            cl2 = resp2.headers.get("content-length")
                            if cl2:
                                total2 = int(cl2)
                            dl2 = 0
                            with open(tmp, "wb") as f2:
                                async for chunk2 in resp2.aiter_bytes(chunk_size=CHUNK_SIZE):
                                    f2.write(chunk2)
                                    dl2 += len(chunk2)
                                    pct2 = round(dl2 / total2 * 100, 1) if total2 else None
                                    yield f"event: progress\ndata: {json.dumps({'downloaded_bytes': dl2, 'total_bytes': total2, 'percent': pct2}, ensure_ascii=False)}\n\n"

                            if dest.is_file():
                                dest.unlink()
                            tmp.rename(dest)
                            yield f"event: done\ndata: {json.dumps({'message': '模型下载完成', 'path': str(dest), 'size_mb': round(dest.stat().st_size / (1024*1024), 1)}, ensure_ascii=False)}\n\n"
                            return

                    elif resp.status_code not in (200, 206):
                        yield f"event: error\ndata: {json.dumps({'message': f'{label} 返回 HTTP {resp.status_code}，尝试下一个源'}, ensure_ascii=False)}\n\n"
                        continue

                    total = None
                    content_length = resp.headers.get("content-length")
                    if content_length:
                        total = int(content_length) + downloaded

                    open_mode = "ab" if downloaded > 0 and resp.status_code == 206 else "wb"
                    if open_mode == "wb":
                        downloaded = 0

                    with open(tmp, open_mode) as f:
                        async for chunk in resp.aiter_bytes(chunk_size=CHUNK_SIZE):
                            f.write(chunk)
                            downloaded += len(chunk)
                            pct = round(downloaded / total * 100, 1) if total else None
                            yield f"event: progress\ndata: {json.dumps({'downloaded_bytes': downloaded, 'total_bytes': total, 'percent': pct}, ensure_ascii=False)}\n\n"

                # 下载完成，重命名
                if dest.is_file():
                    dest.unlink()
                tmp.rename(dest)
                yield f"event: done\ndata: {json.dumps({'message': '模型下载完成', 'path': str(dest), 'size_mb': round(dest.stat().st_size / (1024*1024), 1)}, ensure_ascii=False)}\n\n"
                return

        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'message': f'{label} 下载失败: {str(e)}，尝试下一个源'}, ensure_ascii=False)}\n\n"
            continue

    # 所有源都失败
    yield f"event: error\ndata: {json.dumps({'message': '所有下载源均不可用，请检查网络连接后重试'}, ensure_ascii=False)}\n\n"


# ---------------------------------------------------------------------------
# 缓存清理
# ---------------------------------------------------------------------------


def delete_model_cache(mode: str) -> dict:
    """删除指定模式或全部模型缓存。返回删除结果。"""
    deleted = []
    modes = list(MODEL_META.keys()) if mode == "all" else [mode]
    for m in modes:
        meta = MODEL_META.get(m)
        if meta is None:
            continue
        path = MODEL_DIR / meta["filename"]
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        for p in (path, tmp_path):
            if p.is_file():
                p.unlink()
                deleted.append(str(p))
    return {"deleted": deleted, "message": f"已清理 {len(deleted)} 个文件"}
