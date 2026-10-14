// 图像前处理：小字号数字是 OCR 误读重灾区（2026-10-13 实测 10px 高的小数点即开始
// 误读为 &），放大 + 灰度 + 对比度拉伸是本地引擎准确率的最大杠杆（设计 §5.1）。
// enhance 为纯函数（GrayImage → GrayImage，可单测；ImageData 结构兼容 GrayImage，
// 浏览器侧直接传入即可）；缩放依赖 canvas 2D API，属浏览器薄封装，不进单测。

/** 与 DOM ImageData 结构兼容的最小灰度图接口（data 为 RGBA 扁平数组） */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** 前处理参数（集中一处，按真实样张标定——延续 PDF 导入的标定方法论，设计 §9 红线） */
export interface PreprocessParams {
  /** 短边目标放大倍数（实际取值受 maxShortSide 约束） */
  scale: number;
  /** 放大后短边上限：内存与本地引擎耗时护栏（A4 300dpi 扫描件短边 ≈2480，不放大） */
  maxShortSide: number;
  grayscale: boolean;
  /** 对比度拉伸系数：out = (in - 128) * contrast + 128 */
  contrast: number;
  /** 二值化阈值（0~255）；undefined 不二值化——截图类灰度+对比度即可，扫描件灰底再开 */
  binarizeThreshold?: number;
}

export const DEFAULT_PREPROCESS: PreprocessParams = {
  // scale 1.5（2026-10-14 标定）：Paddle 检测模型内部自带 resize（短边统一 960），
  // 原有 3x 是给 Tesseract 小字定的遗产——真实样张实测 1.5x 质量与 3x 持平
  // （conf 0.996、全列正确）且 predict 8.8s vs 20s、画布内存峰值降 4 倍
  scale: 1.5,
  maxShortSide: 3600,
  grayscale: true,
  contrast: 1.5,
  binarizeThreshold: undefined,
};

/** 实际放大倍数：目标 scale，但放大后短边不超过 maxShortSide；图已够大则不放大（绝不缩小——细节即准确率） */
export function effectiveScale(srcShortSide: number, p: PreprocessParams): number {
  if (srcShortSide <= 0) return 1;
  return Math.min(p.scale, Math.max(1, p.maxShortSide / srcShortSide));
}

/** 灰度（BT.601）+ 对比度拉伸 + 可选二值化。纯函数：返回新数组，不改输入 */
export function enhance(src: GrayImage, p: PreprocessParams): GrayImage {
  const data = new Uint8ClampedArray(src.data.length);
  const contrast = Math.max(0.1, p.contrast);
  const th = p.binarizeThreshold;
  for (let i = 0; i < src.data.length; i += 4) {
    let v = src.data[i] * 0.299 + src.data[i + 1] * 0.587 + src.data[i + 2] * 0.114;
    if (p.grayscale || th != null) {
      v = (v - 128) * contrast + 128;
      if (th != null) v = v >= th ? 255 : 0;
    }
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = src.data[i + 3];
  }
  return { width: src.width, height: src.height, data };
}
