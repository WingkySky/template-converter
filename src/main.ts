import './style.css';
import './vendor-globals';
import './legacy.js';
import { byId } from './ui/dom';
import { initKbPanel } from './ui/steps/kb-panel';
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
} from './legacy.js';

// ==================== 装配 ====================
initKbPanel();
initUploadArea();
initAccumIndicatorDelegate();
initMappingDelegates();
initTemplateDelegates();
byId('file-input').addEventListener('change', handleFileInput);

// 编排层接缝（upload/mapping/template 模块不反向依赖 legacy 编排）
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
