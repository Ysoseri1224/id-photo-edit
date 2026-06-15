# 证件照处理工具

> 一款离线优先的证件照处理工具。上传照片，裁剪人像，自动换底色，导出符合常见报名/签证/护照尺寸要求的证件照。**示例截图中的证件照由ChatGPT生成不来源于真实用户、公众人物或第三方照片，不涉及任何真实个人的肖像、隐私及相关人格权利。**

<p align="center">
  <img src="./assets/readme-cover.png" alt="证件照处理工具封面" width="100%" />
</p>


<p align="center">
  <a href="https://github.com/Ysoseri1224/id-photo-edit/releases/tag/v1.0.0"><img alt="Release" src="https://img.shields.io/github/v/release/Ysoseri1224/id-photo-edit?display_name=tag" /></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20Electron-blue" />
  <img alt="Frontend" src="https://img.shields.io/badge/frontend-React%20%2B%20Vite-61dafb" />
  <img alt="Backend" src="https://img.shields.io/badge/backend-FastAPI-05998b" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green" />
</p>

## 这是什么

`id-photo-edit` 是一个面向日常办证、报名和签证场景的证件照桌面工具。

主要功能包括：

- 上传原图
- 按目标规格裁剪
- 自动抠图
- 切换底色
- 导出最终成品

整个项目采用 `Electron + React + FastAPI` 架构，前端负责交互，后端负责抠图与图像处理。默认支持本地运行

## 为什么做这个

很多证件照工具要么太重，要么微信小程序要求看广告或者付费，要么流程不透明不可控。

这个项目以此痛点为灵感实现了以下几件事：

- 本地处理优先，避免把照片上传到第三方站点
- 规格预设清晰，减少手工换算尺寸和 DPI
- 提供快速/精准两种抠图模式，兼顾速度与质量
- 项目内置多个下载源，会自动测速并选择可用源。下载进度里会显示预计剩余时间。

## 核心功能

- 常见证件照规格预设
  支持一寸、二寸、中国护照、普通签证、申根签证、高考报名、考研报名、驾照、简历照和自定义规格。

- 本地图片裁剪
  上传后先进行裁剪，保证构图和输出比例可控。

- 两种抠图模式
  `快速模式` 基于 `rembg + u2net_human_seg`，开箱即用。
  `精准模式` 基于 `BiRefNet`，边缘质量更高，首次使用需要下载模型。

- 背景色切换
  内置白、蓝、红、灰、深蓝、浅蓝，也支持手动输入十六进制颜色。

- 导出控制
  支持 `JPG / PNG`，可按像素或预设规格导出，并支持限制最大文件体积。

- 模型管理
  可以查看模型状态、下载、删除缓存。精准模式缺模型时，会弹窗提示并可直接进入下载流程。

## 技术栈

- 桌面容器：`Electron`
- 前端：`React 18`、`TypeScript`、`Vite`
- 后端：`FastAPI`
- 图像处理：`Pillow`、`OpenCV`
- 抠图相关：`rembg`、`onnxruntime`、`BiRefNet`

## 快速开始

### 1. 环境要求

- Node.js 18+
- Python 3.9+

### 2. 安装依赖

```bash
npm install
cd frontend && npm install
cd ..
pip install -r backend/requirements.txt
```

### 3. 启动开发环境

浏览器开发模式：

```bash
npm run dev
```

启动后会同时拉起：

- 前端：`http://localhost:5173`
- 后端：`http://127.0.0.1:8765`

桌面开发模式：

```bash
npm run electron:dev
```

### 4. 构建

```bash
npm run build
```

## 项目结构

```text
id-photo-tool/
├─ backend/          # FastAPI、模型下载、图像处理流水线
├─ electron/         # Electron 主进程与 preload
├─ frontend/         # React 前端
├─ dist-electron/    # Electron 编译输出
├─ dist-frontend/    # 前端构建输出
└─ README.md
```

## 模型说明

### 快速模式

- 使用 `u2net_human_seg`
- 通过 `rembg` 侧自动管理缓存
- 启动成本低，适合大部分普通场景

### 精准模式

- 使用 `BiRefNet-general-epoch_244.onnx`
- 首次需要在应用内下载模型
- 更适合发丝、衣领、肩部等边缘细节要求更高的场景

## 后续可以继续做什么

- 增加自动排版与冲印版输出
- 增加人脸位置校验与头顶留白校验
- 增加更多国家/地区证件照规范
- 增加打包分发流程和自动更新
- 增加 macOS / Linux 兼容性

## 版本发布

baseline版本：[`v1.0.0`](https://github.com/Ysoseri1224/id-photo-edit/releases/tag/v1.0.0)

## 许可证

MIT
