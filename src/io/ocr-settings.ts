// OCR 识别设置存取（io 层）：localStorage 明文存储，key 只存本浏览器；
// 开启云端引擎即身份证/卡号/金额发送至所填服务——风险在设置面板红字明示（设计 §5.2）。
export interface OcrLlmSettings {
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface OcrSettings {
  engine: 'local' | 'llm';
  llm: OcrLlmSettings;
}

export const OCR_SETTINGS_KEY = 'tc-ocr-settings-v1';

// 云端默认示例：Agnes AI agnes-3.0-flash（OpenAI 兼容 /v1，文档现价 $0，2026-10-13；
// 仅作示例文案——任何 OpenAI 兼容视觉服务均可替换，设计 §5.3）
export const DEFAULT_OCR_SETTINGS: OcrSettings = {
  engine: 'local',
  llm: {
    baseURL: 'https://apihub.agnes-ai.com/v1',
    apiKey: '',
    model: 'agnes-3.0-flash',
  },
};

export function loadOcrSettings(): OcrSettings {
  try {
    const raw = localStorage.getItem(OCR_SETTINGS_KEY);
    if (!raw) return cloneDefaults();
    const parsed = JSON.parse(raw) as Partial<OcrSettings>;
    return {
      engine: parsed.engine === 'llm' ? 'llm' : 'local',
      llm: {
        baseURL: String(parsed.llm?.baseURL || DEFAULT_OCR_SETTINGS.llm.baseURL).trim(),
        apiKey: String(parsed.llm?.apiKey || ''),
        model: String(parsed.llm?.model || DEFAULT_OCR_SETTINGS.llm.model).trim(),
      },
    };
  } catch {
    return cloneDefaults();
  }
}

export function saveOcrSettings(settings: OcrSettings): void {
  try {
    localStorage.setItem(OCR_SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* 隐私模式忽略 */ }
}

function cloneDefaults(): OcrSettings {
  return { engine: DEFAULT_OCR_SETTINGS.engine, llm: { ...DEFAULT_OCR_SETTINGS.llm } };
}
