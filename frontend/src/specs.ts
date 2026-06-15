export interface PhotoSpec {
  id: string;
  name: string;
  width_mm?: number;
  height_mm?: number;
  width_px?: number;
  height_px?: number;
  dpi: number;
  bg_color: string;
  format: 'jpg' | 'png';
  max_size_kb?: number;
}

export const presets: PhotoSpec[] = [
  {
    id: 'one-inch',
    name: '一寸',
    width_mm: 25,
    height_mm: 35,
    width_px: 295,
    height_px: 413,
    dpi: 300,
    bg_color: '#FFFFFF',
    format: 'jpg',
    max_size_kb: 100,
  },
  {
    id: 'two-inch',
    name: '二寸',
    width_mm: 35,
    height_mm: 49,
    width_px: 413,
    height_px: 579,
    dpi: 300,
    bg_color: '#FFFFFF',
    format: 'jpg',
    max_size_kb: 100,
  },
  {
    id: 'cn-passport',
    name: '中国护照',
    width_mm: 33,
    height_mm: 48,
    width_px: 390,
    height_px: 567,
    dpi: 300,
    bg_color: '#FFFFFF',
    format: 'jpg',
    max_size_kb: 120,
  },
  {
    id: 'us-visa',
    name: '美国签证',
    width_mm: 51,
    height_mm: 51,
    width_px: 600,
    height_px: 600,
    dpi: 300,
    bg_color: '#FFFFFF',
    format: 'jpg',
    max_size_kb: 240,
  },
  {
    id: 'schengen-visa',
    name: '申根签证',
    width_mm: 35,
    height_mm: 45,
    width_px: 413,
    height_px: 531,
    dpi: 300,
    bg_color: '#FFFFFF',
    format: 'jpg',
    max_size_kb: 200,
  },
  {
    id: 'gaokao',
    name: '高考报名',
    width_px: 480,
    height_px: 640,
    dpi: 300,
    bg_color: '#FFFFFF',
    format: 'jpg',
    max_size_kb: 200,
  },
  {
    id: 'kaoyan',
    name: '考研报名',
    width_px: 567,
    height_px: 756,
    dpi: 300,
    bg_color: '#438EDB',
    format: 'jpg',
    max_size_kb: 200,
  },
  {
    id: 'driver-license',
    name: '驾照',
    width_mm: 22,
    height_mm: 32,
    width_px: 260,
    height_px: 378,
    dpi: 300,
    bg_color: '#FFFFFF',
    format: 'jpg',
    max_size_kb: 100,
  },
  {
    id: 'resume',
    name: '简历照',
    width_mm: 35,
    height_mm: 50,
    width_px: 413,
    height_px: 591,
    dpi: 300,
    bg_color: '#438EDB',
    format: 'jpg',
  },
  {
    id: 'custom',
    name: '自定义',
    width_px: 413,
    height_px: 579,
    dpi: 300,
    bg_color: '#FFFFFF',
    format: 'jpg',
  },
];
