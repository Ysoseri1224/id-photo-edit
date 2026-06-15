"""
FastAPI 应用入口
证件照处理工具的后端 HTTP 服务。

启动后第一行输出端口号（供 Electron 读取），然后进入 uvicorn 事件循环。
"""

import argparse
import socket
import sys

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from matting import MissingModelError
from model_manager import delete_model_cache, download_model, get_model_status
from pipeline import process_image

# ---------------------------------------------------------------------------
# FastAPI 应用
# ---------------------------------------------------------------------------

app = FastAPI(title="证件照处理工具", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# 全局异常处理 — 隐藏调用栈，返回中文错误信息
# ---------------------------------------------------------------------------


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(
        status_code=400,
        content={"error": str(exc)},
    )


@app.exception_handler(FileNotFoundError)
async def file_not_found_handler(request: Request, exc: FileNotFoundError):
    if isinstance(exc, MissingModelError):
        return JSONResponse(
            status_code=409,
            content={
                "error": str(exc),
                "code": exc.code,
                "missing_model": {
                    "mode": exc.mode,
                    "name": exc.model_name,
                },
            },
        )
    return JSONResponse(
        status_code=400,
        content={"error": str(exc)},
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # 生产环境不暴露调用栈，仅打印到 stderr 供调试
    print(f"[ERROR] {type(exc).__name__}: {exc}", file=sys.stderr)
    return JSONResponse(
        status_code=500,
        content={"error": f"服务内部错误，请稍后重试"},
    )


# ---------------------------------------------------------------------------
# 健康检查
# ---------------------------------------------------------------------------


@app.get("/health")
async def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# 模型管理
# ---------------------------------------------------------------------------


@app.get("/models/status")
async def models_status():
    """返回各模型的下载状态和文件大小。"""
    return get_model_status()


@app.post("/models/download")
async def models_download(request: Request):
    """触发模型下载，以 SSE 事件流返回进度。"""
    body = await request.json()
    mode = body.get("mode", "fast")
    if mode not in ("fast", "precise"):
        return JSONResponse(
            status_code=400,
            content={"error": f"不支持的模式: {mode}，请使用 fast 或 precise"},
        )

    async def event_stream():
        async for event in download_model(mode):
            yield event

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.delete("/models/cache")
async def models_cache_delete(request: Request):
    """删除模型缓存文件。"""
    body = await request.json()
    mode = body.get("mode", "all")
    if mode not in ("fast", "precise", "all"):
        return JSONResponse(
            status_code=400,
            content={"error": f"不支持的模式: {mode}，请使用 fast、precise 或 all"},
        )
    result = delete_model_cache(mode)
    return result


# ---------------------------------------------------------------------------
# 核心处理
# ---------------------------------------------------------------------------


@app.post("/process")
async def process(request: Request):
    """
    证件照处理主接口。
    接收 JSON 请求，返回处理后的图片 Base64 和元数据。
    """
    try:
        params = await request.json()
    except Exception:
        return JSONResponse(
            status_code=400,
            content={"error": "请求格式错误，请发送有效的 JSON 数据"},
        )

    # 基础参数校验
    if not params.get("image_base64"):
        return JSONResponse(
            status_code=400,
            content={"error": "缺少图片数据，请上传图片后重试"},
        )

    matting_mode = params.get("matting_mode", "fast")
    if matting_mode not in ("fast", "precise"):
        return JSONResponse(
            status_code=400,
            content={"error": f"不支持的抠图模式: {matting_mode}，请使用 fast 或 precise"},
        )

    try:
        result = process_image(params)
        return result
    except MissingModelError as e:
        return JSONResponse(
            status_code=409,
            content={
                "error": str(e),
                "code": e.code,
                "missing_model": {
                    "mode": e.mode,
                    "name": e.model_name,
                },
            },
        )
    except FileNotFoundError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    except RuntimeError as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
    except Exception as e:
        print(f"[ERROR] process: {type(e).__name__}: {e}", file=sys.stderr)
        return JSONResponse(
            status_code=500,
            content={"error": "图片处理失败，请检查图片是否有效后重试"},
        )


# ---------------------------------------------------------------------------
# 启动入口
# ---------------------------------------------------------------------------


def find_free_port() -> int:
    """绑定临时端口后立即释放，获取一个可用端口号。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="证件照处理工具后端服务")
    parser.add_argument("--port", type=int, default=0, help="监听端口，默认自动分配")
    args = parser.parse_args()

    port = args.port if args.port > 0 else find_free_port()

    # 第一行输出端口号，供 Electron 主进程读取
    print(port, flush=True)

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
    )
