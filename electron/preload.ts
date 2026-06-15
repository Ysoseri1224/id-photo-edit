import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * 获取后端服务端口号
   */
  getSidecarPort: (): Promise<number> => {
    return ipcRenderer.invoke('get-sidecar-port');
  },

  /**
   * 打开保存对话框并将 base64 数据写入文件
   * @param base64 - 文件内容的 base64 编码
   * @param defaultName - 默认文件名
   * @returns 保存的文件路径，取消时返回 null
   */
  saveFile: (base64: string, defaultName: string): Promise<string | null> => {
    return ipcRenderer.invoke('save-file', base64, defaultName);
  },

  /**
   * 当前操作系统平台
   */
  platform: process.platform as string,
});
