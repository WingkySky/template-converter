// 步骤 0：知识库卡片。
// 静态按钮统一由本模块接线（index.html 不再含任何内联事件处理器）。
import { escapeHTML, byId } from '../dom';
import { clearKBStorage, loadKB, onKBChanged } from '../../io/kb-storage';
import {
  downloadKBSample, exportKBToExcel, handleKBUpload, handleKBConfigUpload, handleKBImport,
} from '../../io/kb-transfer';

// 清空知识库（确认交互属 UI；存储清理在 io/kb-storage）
export function clearKB(): void {
  if (!confirm('确定要清空知识库吗？此操作不可恢复。')) return;
  clearKBStorage();
  updateKBStatus();
}

// 更新知识库状态显示
export function updateKBStatus(): void {
  const kb = loadKB();
  const shangSheCount = Object.keys(kb.shangSheMap).length;
  let taskCount = 0;
  for (const entry of Object.values(kb.shangSheMap)) {
    taskCount += (entry.tasks || []).length;
  }
  let lastUpdated = '未加载';
  if (kb.lastUpdated) {
    const d = new Date(kb.lastUpdated);
    lastUpdated = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  const area = document.getElementById('kb-status-area');
  if (area) {
    area.innerHTML = `
      <div class="kb-stat"><div><div class="num">${shangSheCount}</div><div class="label">商社数量</div></div></div>
      <div class="kb-stat"><div><div class="num">${taskCount}</div><div class="label">任务数量</div></div></div>
      <div class="kb-stat"><div><div class="num" style="font-size:13px;">${escapeHTML(lastUpdated)}</div><div class="label">最后更新</div></div></div>
    `;
  }
}

export function initKbPanel(): void {
  // 原 legacy.js 顶层副作用随迁移收入本模块：订阅知识库变更 + 首次渲染状态
  onKBChanged(updateKBStatus);
  updateKBStatus();

  // 容错接线：节点缺失时静默跳过（测试环境/骨架裁剪时不阻断整体装配）
  const on = (id: string, ev: string, fn: EventListener) => {
    document.getElementById(id)?.addEventListener(ev, fn);
  };

  // 触发按钮 → 打开对应文件选择器
  on('kb-btn-upload', 'click', () => byId('kb-upload-input').click());
  on('kb-btn-config', 'click', () => byId('kb-config-upload-input').click());
  on('kb-btn-import', 'click', () => byId('kb-import-input').click());

  // 隐藏 file input 的 change
  on('kb-upload-input', 'change', handleKBUpload);
  on('kb-config-upload-input', 'change', handleKBConfigUpload);
  on('kb-import-input', 'change', handleKBImport);

  // 功能按钮
  on('kb-btn-sample', 'click', downloadKBSample);
  on('kb-btn-export', 'click', exportKBToExcel);
  on('kb-btn-clear', 'click', clearKB);
}
