// 步骤 0：知识库卡片（自 src/legacy.js 逐字搬移，阶段 3 E 分区）。
// 静态按钮接线（原 index.html 内联 onclick/onchange）→ initKbPanel() 统一 addEventListener；
// 本模块渲染的 HTML（kb-status-area）不含任何交互元素，无需事件委托。
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

// 知识库卡片静态按钮接线（照 index.html 原内联 onclick/onchange 逐字等价）。
// 说明：三个触发文件选择器的小按钮（📤 上传知识库 / 🔄 更新配置数据 / 📥 导入备份）
// 原内联 onclick 只调用 document.getElementById(...).click()，不依赖任何 window 函数，
// 留在 index.html 中继续工作，本函数不重复接线（避免双触发）。
export function initKbPanel(): void {
  // 原 legacy.js 顶层副作用随迁移收入本模块：订阅知识库变更 + 首次渲染状态
  onKBChanged(updateKBStatus);
  updateKBStatus();

  // 隐藏 file input 的 change（原 onchange="handleKBUpload(event)" 等）
  byId('kb-upload-input').addEventListener('change', handleKBUpload);
  byId('kb-config-upload-input').addEventListener('change', handleKBConfigUpload);
  byId('kb-import-input').addEventListener('change', handleKBImport);

  // 功能按钮（原 onclick="downloadKBSample()" / "exportKBToExcel()" / "clearKB()"）。
  // 静态按钮在 index.html 中没有 id（不允许改 index.html），故按按钮文本精确匹配接线。
  wireKbButtonByLabel('📄 下载样例文件', downloadKBSample);
  wireKbButtonByLabel('💾 导出备份', exportKBToExcel);
  wireKbButtonByLabel('🗑️ 清空知识库', clearKB);
}

// 在知识库卡片按钮行内按可见文本查找按钮并接 click（未找到时静默跳过）
function wireKbButtonByLabel(label: string, handler: () => void): void {
  const row = document.querySelector('#step-kb .kb-btn-row');
  if (!row) return;
  for (const btn of Array.from(row.querySelectorAll('button'))) {
    if ((btn.textContent || '').trim() === label) {
      btn.addEventListener('click', handler);
      return;
    }
  }
}
