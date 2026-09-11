import './style.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import { byId } from './ui/dom';
import { icon } from './ui/icons';
import { initKbPanel } from './ui/steps/kb-panel';
import { initKBConfigPanel } from './ui/steps/kb-config-panel';
import {
  setResetAllHandler, initUploadArea, initAccumIndicatorDelegate, handleFileInput,
} from './ui/steps/upload';
import { initMappingDelegates } from './ui/steps/mapping';
import { initTemplateDelegates, setGenerateOutputHandler } from './ui/steps/template';
import { initExportPanelHandlers } from './ui/export/controls';
import { getSelectedTemplates } from './ui/steps/template';
import {
  generateOutput, resetAll, showExportStep, cacheCurrentTemplateOutput,
  getSplitGroups, getSplitGroupCounts, isSplitExportActive, ensureSplitBatches,
  initExportStepDelegates,
} from './ui/steps/export';

// 静态骨架中的 data-icon 占位符注水为内联 SVG
document.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
  el.innerHTML = icon(el.dataset.icon || 'info', Number(el.dataset.size || 16));
});

// 主题切换：明/暗，持久化到 localStorage（初始值由 index.html 头部脚本预设）
const themeBtn = byId('theme-toggle');
const syncThemeIcon = (): void => {
  const dark = document.documentElement.dataset.theme === 'dark';
  themeBtn.innerHTML = icon(dark ? 'sun' : 'moon', 15);
};
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('tc-theme', next); } catch { /* 隐私模式忽略 */ }
  syncThemeIcon();
});
syncThemeIcon();

// ==================== 装配 ====================
initKbPanel();
initKBConfigPanel();
initUploadArea();
initAccumIndicatorDelegate();
initMappingDelegates();
initTemplateDelegates();
byId('file-input').addEventListener('change', handleFileInput);

// 编排层接缝（upload/mapping/template 模块不反向依赖 export 编排）
setResetAllHandler(resetAll);
setGenerateOutputHandler(generateOutput);

// 导出面板五模块的统一事件委托 + 编排依赖注入
initExportPanelHandlers({
  showExportStep,
  cacheCurrentTemplateOutput,
  getSelectedTemplates,
  getSplitGroups,
  getSplitGroupCounts,
  isSplitExportActive,
  ensureSplitBatches,
});

// 导出步骤动态 HTML 中残留内联 onclick 的收尾接线（导出按钮/模版切换/genCustom/goBack）
initExportStepDelegates();

// e2e 冒烟标记：headless 验证单文件构建（dist-single）在 file:// 下已完成启动
document.documentElement.dataset.appBoot = 'ok';
