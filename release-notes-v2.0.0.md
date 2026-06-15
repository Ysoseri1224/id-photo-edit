## v2.0.0

本次版本是一次面向实际使用体验的重构，不是小修小补。

### 重构目的

- 降低无技术背景用户的使用门槛
- 避免系统 Python、端口服务、WASM 内存限制等运行时问题
- 让快速模式和精准模式都走稳定、可复现的抠图链
- 提升首次使用成功率，减少“下载了但不能用”或“环境缺失”的情况

### 本次重构内容

- 把抠图执行链重构为统一的 `matting-helper.exe`
- 快速模式改为通过内置 helper 调用 `hivision_modnet`
- 精准模式改为通过统一 helper 调用 `BiRefNet-general`
- 应用不再依赖系统 Python 环境
- 将 `matting-helper.exe` 直接打进安装包，避免首次运行还要下载基础组件
- 保留 `BiRefNet-general-epoch_244.onnx` 为按需下载资源，避免安装包继续膨胀
- 精准模式模型下载源扩展为多公开镜像，并优先尝试国内公开镜像
- 下载进度改为显示预计剩余时间

### 用户可感知的变化

- 安装后即可直接使用快速模式
- 精准模式首次使用时只下载大模型，不再额外下载运行时组件
- 运行路径更稳定，减少“缺依赖”“启动失败”“网络请求异常”等问题
- 快速模式与精准模式的结果一致性更好，后续排查也更清晰

### 架构变化摘要

旧思路：

- Electron + Node 推理
- 或依赖 Python sidecar / HTTP 进程

新思路：

- Electron + React 负责 UI、资源管理、导出
- `matting-helper.exe` 负责模型专属预处理、推理、后处理
- `fast` 内置模型，`precise` 按需下载模型

### Release 资产建议

- `id-photo-edit-2.0.0-setup.exe`
- `matting-helper-win-x64.exe`（如需单独发布调试或镜像同步）

