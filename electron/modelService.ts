import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { once } from 'events';
import { spawn } from 'child_process';
import sharp from 'sharp';

let electronApp: { isPackaged: boolean } | null = null;
try {
  ({ app: electronApp } = require('electron') as { app: { isPackaged: boolean } });
} catch {
  electronApp = null;
}

type ModeKey = 'fast_hivision_modnet' | 'precise_birefnet_general';

type SourceItem = { id: string; label: string; url: string };

type ModeMeta = {
  key: ModeKey;
  name: string;
  description: string;
  filename: string;
  helperFilename: string;
  bundled?: boolean;
  recommended?: boolean;
  sources: SourceItem[];
  helperSources: SourceItem[];
};

export type ModelStatusItem = {
  key: string;
  name: string;
  description: string;
  downloaded: boolean;
  recommended?: boolean;
  bundled?: boolean;
};

export type ModelStatus = {
  selected_model: string;
  models: ModelStatusItem[];
};

export type DownloadProgressPayload = {
  modelKey: string;
  progress: number;
  speed: string;
  eta: string;
  source?: string;
  resource?: string;
  done?: boolean;
  error?: string;
};

export type ProcessPhotoParams = {
  image_base64: string;
  model_key: string;
  bg_color: string;
  width_px: number;
  height_px: number;
  dpi: number;
  format: string;
  max_size_kb?: number;
};

const MATTING_HELPER_FILENAME = 'matting-helper-win-x64.exe';
const MATTING_HELPER_RELEASE_URL = 'https://github.com/Ysoseri1224/id-photo-edit/releases/download/v1.0.0/matting-helper-win-x64.exe';

const MODES: Record<ModeKey, ModeMeta> = {
  fast_hivision_modnet: {
    key: 'fast_hivision_modnet',
    name: '快速模式',
    description: '内置 hivision_modnet，启动即可用',
    filename: 'hivision_modnet.onnx',
    helperFilename: MATTING_HELPER_FILENAME,
    bundled: true,
    recommended: true,
    sources: [],
    helperSources: [
      { id: 'github', label: 'GitHub Releases', url: MATTING_HELPER_RELEASE_URL },
    ],
  },
  precise_birefnet_general: {
    key: 'precise_birefnet_general',
    name: '精准模式',
    description: 'BiRefNet-general，首次使用需要下载资源',
    filename: 'BiRefNet-general-epoch_244.onnx',
    helperFilename: MATTING_HELPER_FILENAME,
    sources: [
      {
        id: 'hf-mirror',
        label: 'hf-mirror',
        url: 'https://hf-mirror.com/onnx-community/BiRefNet-ONNX/resolve/main/onnx/model.onnx?download=true',
      },
      {
        id: 'hf-mirror',
        label: 'hf-mirror（原仓库）',
        url: 'https://hf-mirror.com/ZhengPeng7/BiRefNet/resolve/main/BiRefNet-general-epoch_244.onnx',
      },
      {
        id: 'github',
        label: 'GitHub rembg 镜像',
        url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx',
      },
      {
        id: 'github',
        label: 'GitHub',
        url: 'https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-general-epoch_244.onnx',
      },
      {
        id: 'huggingface',
        label: 'Hugging Face ONNX Community',
        url: 'https://huggingface.co/onnx-community/BiRefNet-ONNX/resolve/main/onnx/model.onnx?download=true',
      },
      {
        id: 'huggingface',
        label: 'Hugging Face 原仓库',
        url: 'https://huggingface.co/ZhengPeng7/BiRefNet/resolve/main/BiRefNet-general-epoch_244.onnx',
      },
    ],
    helperSources: [
      { id: 'github', label: 'GitHub Releases', url: MATTING_HELPER_RELEASE_URL },
    ],
  },
};

const PROBE_URLS: Record<string, string> = {
  'hf-mirror': 'https://hf-mirror.com/api/models',
  'huggingface': 'https://huggingface.co/api/models',
  'modelscope': 'https://modelscope.cn/api/v1/models',
  'github': 'https://github.com',
};

const selectedModelFile = 'selected-model.json';
const helperTempDirName = 'helper-temp';

function getAppDataDir(): string {
  return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'id-photo-tool');
}

function getBundledModelDir(): string {
  if (electronApp && typeof electronApp.isPackaged === 'boolean' && electronApp.isPackaged) {
    const unpackedModels = path.join(process.resourcesPath, 'app.asar.unpacked', 'models');
    if (fs.existsSync(unpackedModels)) {
      return unpackedModels;
    }
    return path.join(process.resourcesPath, 'models');
  }
  return path.join(process.cwd(), 'models');
}

function getDownloadedModelDir(): string {
  const dir = path.join(getAppDataDir(), 'models');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getHelperDir(): string {
  const dir = path.join(getAppDataDir(), 'helpers');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getHelperTempDir(): string {
  const dir = path.join(getAppDataDir(), helperTempDirName);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getConfigPath(): string {
  const dir = getAppDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, selectedModelFile);
}

function getModelPath(modeKey: ModeKey): string {
  const mode = MODES[modeKey];
  return mode.bundled
    ? path.join(getBundledModelDir(), mode.filename)
    : path.join(getDownloadedModelDir(), mode.filename);
}

function getHelperPath(modeKey: ModeKey): string {
  const filename = MODES[modeKey].helperFilename;
  if (electronApp?.isPackaged) {
    const unpackedHelpers = path.join(process.resourcesPath, 'app.asar.unpacked', 'helpers');
    const unpackedHelperPath = path.join(unpackedHelpers, filename);
    if (fs.existsSync(unpackedHelperPath)) {
      return unpackedHelperPath;
    }
    return path.join(process.resourcesPath, 'helpers', filename);
  }
  if (!electronApp?.isPackaged) {
    const localBuildHelper = path.join(process.cwd(), 'dist', filename);
    if (fs.existsSync(localBuildHelper)) {
      return localBuildHelper;
    }
  }
  return path.join(getHelperDir(), filename);
}

function getModeResources(modeKey: ModeKey): Array<{ label: string; dest: string; sources: SourceItem[] }> {
  const mode = MODES[modeKey];
  const resources: Array<{ label: string; dest: string; sources: SourceItem[] }> = [
    { label: '处理组件', dest: getHelperPath(modeKey), sources: mode.helperSources },
  ];
  if (!mode.bundled) {
    resources.push({ label: '模型', dest: getModelPath(modeKey), sources: mode.sources });
  }
  return resources;
}

function isModeReady(modeKey: ModeKey): boolean {
  const helperReady = fs.existsSync(getHelperPath(modeKey));
  if (!helperReady) {
    return false;
  }
  return fs.existsSync(getModelPath(modeKey));
}

export function getSelectedModel(): ModeKey {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return 'fast_hivision_modnet';
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { selected_model?: string };
    if (parsed.selected_model && parsed.selected_model in MODES) {
      return parsed.selected_model as ModeKey;
    }
  } catch {
    // ignore invalid config
  }
  return 'fast_hivision_modnet';
}

export function setSelectedModel(modelKey: string): void {
  if (!(modelKey in MODES)) {
    throw new Error(`未知模式: ${modelKey}`);
  }
  fs.writeFileSync(getConfigPath(), JSON.stringify({ selected_model: modelKey }, null, 2), 'utf8');
}

export function getModelStatus(): ModelStatus {
  const selected = getSelectedModel();
  return {
    selected_model: selected,
    models: Object.values(MODES).map((mode) => ({
      key: mode.key,
      name: mode.name,
      description: mode.description,
      downloaded: isModeReady(mode.key),
      recommended: mode.recommended,
      bundled: mode.bundled,
    })),
  };
}

export async function downloadModel(
  modelKey: string,
  emit: (payload: DownloadProgressPayload) => void,
): Promise<void> {
  if (!(modelKey in MODES)) {
    throw new Error(`未知模式: ${modelKey}`);
  }

  const modeKey = modelKey as ModeKey;
  const resources = getModeResources(modeKey);
  for (let index = 0; index < resources.length; index += 1) {
    const resource = resources[index];
    if (fs.existsSync(resource.dest)) {
      continue;
    }
    await downloadSingleResource(modeKey, resource.label, resource.sources, resource.dest, emit, index, resources.length);
  }
  emit({ modelKey, progress: 1, speed: '已完成', eta: '已完成', done: true });
}

export function deleteModel(modelKey: string): void {
  if (!(modelKey in MODES)) {
    throw new Error(`未知模式: ${modelKey}`);
  }

  const mode = MODES[modelKey as ModeKey];
  if (mode.bundled) {
    throw new Error('快速模式资源已内置，不能删除');
  }

  const selected = getSelectedModel();
  if (selected === modelKey) {
    throw new Error('当前默认模式不能直接删除，请先切换默认模式');
  }

  const modelPath = getModelPath(modelKey as ModeKey);
  const helperPath = getHelperPath(modelKey as ModeKey);
  safeUnlink(modelPath);
  safeUnlink(`${modelPath}.tmp`);
  if (helperPath.startsWith(getHelperDir())) {
    safeUnlink(helperPath);
    safeUnlink(`${helperPath}.tmp`);
  }
}

export async function processPhoto(params: ProcessPhotoParams): Promise<{
  result_base64: string;
  width_px: number;
  height_px: number;
  actual_size_kb: number;
}> {
  const modeKey = normalizeModeKey(params.model_key);
  const modelPath = getModelPath(modeKey);
  const helperPath = getHelperPath(modeKey);
  if (!fs.existsSync(modelPath)) {
    throw new Error(`模型未就绪：${MODES[modeKey].name}`);
  }
  if (!fs.existsSync(helperPath)) {
    throw new Error(`处理组件未就绪：${MODES[modeKey].name}`);
  }

  const inputBuffer = decodeBase64Image(params.image_base64);
  let source: sharp.Sharp;
  let originalWidth = 0;
  let originalHeight = 0;

  try {
    source = sharp(inputBuffer, { failOn: 'error' }).ensureAlpha();
    const metadata = await source.metadata();
    originalWidth = metadata.width ?? 0;
    originalHeight = metadata.height ?? 0;
  } catch {
    throw new Error('裁剪结果不是有效图片，请重新裁剪后再试');
  }

  if (!originalWidth || !originalHeight) {
    throw new Error('无法读取图片尺寸');
  }

  const mattingRgba = await runMattingHelper(modeKey, inputBuffer);
  const composited = sharp(mattingRgba, {
    raw: {
      width: originalWidth,
      height: originalHeight,
      channels: 4,
    },
  })
    .flatten({ background: params.bg_color })
    .resize(params.width_px, params.height_px, { fit: 'fill' });

  const outputBuffer = await encodeOutput(composited, params.format, params.max_size_kb, params.dpi);

  return {
    result_base64: outputBuffer.toString('base64'),
    width_px: params.width_px,
    height_px: params.height_px,
    actual_size_kb: Number((outputBuffer.length / 1024).toFixed(1)),
  };
}

async function rankSources(sources: SourceItem[]): Promise<SourceItem[]> {
  const results = await Promise.all(sources.map(async (source) => {
    const startedAt = Date.now();
    try {
      const response = await fetch(PROBE_URLS[source.id], { method: 'HEAD' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return { source, latency: Date.now() - startedAt };
    } catch {
      return { source, latency: Number.MAX_SAFE_INTEGER };
    }
  }));
  return results.sort((a, b) => a.latency - b.latency).map((item) => item.source);
}

async function downloadSingleResource(
  modelKey: ModeKey,
  resourceLabel: string,
  sources: SourceItem[],
  dest: string,
  emit: (payload: DownloadProgressPayload) => void,
  resourceIndex: number,
  resourceCount: number,
): Promise<void> {
  const tmp = `${dest}.tmp`;
  const rankedSources = await rankSources(sources);
  const errors: string[] = [];

  for (const source of rankedSources) {
    let file: fs.WriteStream | null = null;
    try {
      emit({
        modelKey,
        progress: resourceIndex / resourceCount,
        speed: '连接中',
        eta: '正在开始',
        source: source.label,
        resource: resourceLabel,
      });

      const response = await fetch(source.url);
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const totalBytes = Number(response.headers.get('content-length') || 0);
      file = fs.createWriteStream(tmp);
      const reader = response.body.getReader();
      const startedAt = Date.now();
      let downloadedBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        const chunk = Buffer.from(value);
        if (!file.write(chunk)) {
          await once(file, 'drain');
        }

        downloadedBytes += value.length;
        const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.1);
        const bytesPerSecond = downloadedBytes / elapsedSeconds;
        const resourceProgress = totalBytes > 0 ? downloadedBytes / totalBytes : 0;
        emit({
          modelKey,
          progress: (resourceIndex + resourceProgress) / resourceCount,
          speed: formatSpeed(bytesPerSecond),
          eta: formatEta(downloadedBytes, totalBytes, bytesPerSecond),
          source: source.label,
          resource: resourceLabel,
        });
      }

      await new Promise<void>((resolve, reject) => {
        file!.end((error?: Error | null) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      fs.renameSync(tmp, dest);
      return;
    } catch (error) {
      errors.push(error instanceof Error ? `${source.label}: ${error.message}` : `${source.label}: 下载失败`);
      if (file) {
        file.destroy();
      }
      safeUnlink(tmp);
    }
  }

  throw new Error(`所有下载源均不可用，请检查网络连接后重试。${errors.join('；')}`);
}

function normalizeModeKey(modelKey: string): ModeKey {
  if (!(modelKey in MODES)) {
    throw new Error(`未知模式: ${modelKey}`);
  }
  return modelKey as ModeKey;
}

async function runMattingHelper(modeKey: ModeKey, inputBuffer: Buffer): Promise<Buffer> {
  const helperPath = getHelperPath(modeKey);
  const modelPath = getModelPath(modeKey);
  const tempDir = getHelperTempDir();
  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const inputPath = path.join(tempDir, `${token}-input.png`);
  const outputPath = path.join(tempDir, `${token}-output.png`);

  await sharp(inputBuffer).png().toFile(inputPath);

  try {
    await spawnHelper(helperPath, [
      '--mode',
      modeKey,
      '--input',
      inputPath,
      '--output',
      outputPath,
      '--model',
      modelPath,
    ]);

    const { data, info } = await sharp(outputPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (info.channels !== 4) {
      throw new Error('处理组件输出格式无效');
    }
    return data;
  } finally {
    safeUnlink(inputPath);
    safeUnlink(outputPath);
  }
}

function spawnHelper(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `处理组件退出码: ${code}`));
    });
  });
}

function decodeBase64Image(base64: string): Buffer {
  const normalized = base64.trim();
  if (!normalized) {
    throw new Error('裁剪结果为空，请重新裁剪后再试');
  }

  if (normalized.startsWith('data:')) {
    const match = normalized.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/s);
    if (!match) {
      throw new Error('裁剪结果格式无效，请重新裁剪后再试');
    }

    const [, mimeType = '', isBase64, payload = ''] = match;
    if (!mimeType.startsWith('image/')) {
      throw new Error('当前只支持图片裁剪结果');
    }
    if (!payload) {
      throw new Error('裁剪结果为空，请重新裁剪后再试');
    }

    if (!isBase64) {
      return Buffer.from(decodeURIComponent(payload), 'utf8');
    }

    const buffer = Buffer.from(payload, 'base64');
    if (!buffer.length) {
      throw new Error('裁剪结果为空，请重新裁剪后再试');
    }
    return buffer;
  }

  const buffer = Buffer.from(normalized, 'base64');
  if (!buffer.length) {
    throw new Error('裁剪结果为空，请重新裁剪后再试');
  }
  return buffer;
}

async function encodeOutput(
  image: sharp.Sharp,
  format: string,
  maxSizeKb: number | undefined,
  dpi: number,
): Promise<Buffer> {
  const pipeline = image.clone().withMetadata({ density: dpi });
  if (format === 'png') {
    return pipeline.png({ compressionLevel: 9 }).toBuffer();
  }

  let quality = 95;
  let output = await pipeline.jpeg({ quality }).toBuffer();
  if (!maxSizeKb) {
    return output;
  }

  const maxBytes = maxSizeKb * 1024;
  while (output.length > maxBytes && quality > 20) {
    quality -= 5;
    output = await pipeline.jpeg({ quality }).toBuffer();
  }
  return output;
}

function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '速度统计中';
  const mbPerSecond = bytesPerSecond / (1024 * 1024);
  if (mbPerSecond >= 1) {
    return `${mbPerSecond.toFixed(1)} MB/s`;
  }
  return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
}

function formatEta(downloadedBytes: number, totalBytes: number, bytesPerSecond: number): string {
  if (!totalBytes || !bytesPerSecond) return '正在估算';
  const remainingSeconds = Math.max((totalBytes - downloadedBytes) / bytesPerSecond, 0);
  if (remainingSeconds < 5) return '即将完成';
  if (remainingSeconds < 60) return `预计 ${Math.ceil(remainingSeconds)} 秒后完成`;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = Math.ceil(remainingSeconds % 60);
  return `预计 ${minutes} 分 ${seconds} 秒后完成`;
}

function safeUnlink(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
