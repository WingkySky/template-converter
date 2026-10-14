// 识别设置弹层（设计 §4）：引擎选择（本地 PaddleOCR 默认 / 云端 LLM 可选）与云端
// 三件套（baseURL / apiKey / model）。key 仅存本浏览器 localStorage（io/ocr-settings）；
// 开启云端即身份证/卡号/金额发送至所填服务——面板红字明示（设计 §5.2）。
// 弹层骨架静态位于 index.html，事件委托挂弹层根节点（与 kb-config-panel 同模式）。
import { escapeHTML, delegateAction } from './dom';
import { loadOcrSettings, saveOcrSettings, DEFAULT_OCR_SETTINGS } from '../io/ocr-settings';
import type { OcrSettings } from '../io/ocr-settings';

function renderPanel(settings: OcrSettings): void {
  const body = document.getElementById('ocr-settings-body');
  if (!body) return;
  // 弱机探测：deviceMemory 仅 Chromium 系支持（undefined 视为未知不提示）
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lowEnd = (nav.deviceMemory !== undefined && nav.deviceMemory <= 4)
    || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4);
  body.innerHTML = `
    <div class="ocrs-engine">
      <label><input type="radio" name="ocr-engine" value="auto" data-action="ocrsEngineChange" ${settings.engine === 'auto' ? 'checked' : ''}>
        <span><strong>自动（推荐）</strong>——已配置下方 API key 时用云端 LLM 识别（实测表格结构还原显著更好），云端失败自动回落本地并提示原因；未配置 key 时直接用本地</span></label>
      <label><input type="radio" name="ocr-engine" value="local" data-action="ocrsEngineChange" ${settings.engine === 'local' ? 'checked' : ''}>
        <span><strong>仅本地</strong>——PaddleOCR（PP-OCRv6_tiny）在浏览器内运行，身份证/卡号/金额不出本机；首次识别需联网下载组件与模型（约 30MB），之后浏览器缓存承载复用${lowEnd ? '；<strong>检测到本机配置较低，建议优先用云端识别</strong>' : ''}</span></label>
      <label><input type="radio" name="ocr-engine" value="llm" data-action="ocrsEngineChange" ${settings.engine === 'llm' ? 'checked' : ''}>
        <span><strong>仅云端</strong>——多模态 LLM 直接看图输出表格，准确率更高，需自备 API key；失败不回落，直接报错</span></label>
    </div>
    <div id="ocrs-llm-fields" class="${settings.engine === 'local' ? 'hidden' : ''}">
      <div class="ocrs-warn">使用云端识别即表示：图片中的身份证号、银行卡号、金额等敏感数据将发送至你所填写的服务方。API key 仅保存在本浏览器，不会经手本工具的托管方。</div>
      <div class="ocrs-field">
        <label for="ocrs-base-url">接口地址（OpenAI 兼容，含 /v1）</label>
        <input type="text" id="ocrs-base-url" value="${escapeHTML(settings.llm.baseURL)}" placeholder="https://apihub.agnes-ai.com/v1">
        <div style="font-size:12px;color:var(--text2);margin-top:4px;">示例：Agnes（免费，注册即得 key）apihub.agnes-ai.com/v1 · 本机 Ollama（需已安装，数据不出本机）http://localhost:11434/v1，模型填 glm-ocr / qwen3-vl:4b</div>
      </div>
      <div class="ocrs-field">
        <label for="ocrs-api-key">API Key</label>
        <input type="password" id="ocrs-api-key" value="${escapeHTML(settings.llm.apiKey)}" placeholder="sk-..." autocomplete="off">
      </div>
      <div class="ocrs-field">
        <label for="ocrs-model">模型名</label>
        <input type="text" id="ocrs-model" value="${escapeHTML(settings.llm.model)}" placeholder="agnes-3.0-flash">
      </div>
      <div class="ocrs-hint">所选服务需支持浏览器 CORS 直连与图片输入（image_url / base64 dataURL）。首发推荐 Agnes 3.0 Flash（文档现价 $0，apihub.agnes-ai.com）。若请求被浏览器拦截，说明该服务不支持跨域直调，请换用支持的服务。</div>
    </div>`;
}

export function openOcrSettingsPanel(): void {
  renderPanel(loadOcrSettings());
  document.getElementById('ocr-settings-modal')?.classList.remove('hidden');
}

export function closeOcrSettingsPanel(): void {
  document.getElementById('ocr-settings-modal')?.classList.add('hidden');
}

export function initOcrSettingsPanel(): void {
  document.getElementById('ocr-settings-btn')?.addEventListener('click', () => openOcrSettingsPanel());

  // 委托挂载在弹层根节点（与 kb-config-panel 同口径）
  const overlay = document.getElementById('ocr-settings-modal');
  if (overlay) {
    delegateAction(overlay, 'click', {
      ocrsClose: () => closeOcrSettingsPanel(),
      ocrsSave: () => {
        const engineInput = overlay.querySelector('input[name="ocr-engine"]:checked') as HTMLInputElement | null;
        const read = (id: string): string =>
          (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
        const engine: OcrSettings['engine'] =
          engineInput?.value === 'llm' || engineInput?.value === 'local' ? engineInput.value : 'auto';
        const settings: OcrSettings = {
          engine,
          llm: {
            baseURL: read('ocrs-base-url') || DEFAULT_OCR_SETTINGS.llm.baseURL,
            apiKey: read('ocrs-api-key'),
            model: read('ocrs-model') || DEFAULT_OCR_SETTINGS.llm.model,
          },
        };
        if (settings.engine === 'llm' && !settings.llm.apiKey) {
          alert('已选择仅云端识别，请填写 API key（或改用自动/仅本地）');
          return;
        }
        saveOcrSettings(settings);
        closeOcrSettingsPanel();
      },
    });
    delegateAction(overlay, 'change', {
      ocrsEngineChange: () => {
        const checked = overlay.querySelector('input[name="ocr-engine"]:checked') as HTMLInputElement | null;
        // 自动/仅云端都需要 LLM 配置区；仅本地才隐藏
        document.getElementById('ocrs-llm-fields')?.classList.toggle('hidden', checked?.value === 'local');
      },
    });
    // 点击遮罩空白处关闭（点击弹层本身不关闭）
    overlay.addEventListener('click', (e) => {
      if ((e as MouseEvent).target === overlay) closeOcrSettingsPanel();
    });
  }

  document.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key !== 'Escape') return;
    document.getElementById('ocr-settings-modal')?.classList.add('hidden');
  });
}
