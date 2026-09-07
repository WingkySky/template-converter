// io 层：知识库 localStorage 持久化（设计文档 5.4）。
// 签名与存储介质无关——未来接云端存储时实现同签名适配器替换，core/ui 一行不动。
import { KB_STORAGE_KEY, KB_SCHEMA_VERSION, migrateKB } from '../core/kb/model';
import type { KB } from '../core/kb/model';

let _kbCache: KB | null = null;  // KB 内存缓存

// 知识库变更通知（替代原 saveKB/clearKB 内对 updateKBStatus 的直接调用：
// 存储层不应知道 UI 的存在，由 legacy/ui 注册监听）
const listeners: (() => void)[] = [];
export function onKBChanged(fn: () => void): void {
  listeners.push(fn);
}
function notifyKBChanged(): void {
  listeners.forEach(fn => fn());
}

// 加载知识库
export function loadKB(): KB {
  // 优先从缓存返回
  if (_kbCache !== null) return _kbCache;
  try {
    const raw = localStorage.getItem(KB_STORAGE_KEY);
    if (raw) {
      const kb = JSON.parse(raw);
      if (kb && kb.shangSheMap) {
        // 确保新字段有默认值（兼容旧数据）
        if (!kb.configData) kb.configData = { taxSources: [], platforms: [] };
        if (!kb.taskListData) kb.taskListData = [];
        migrateKB(kb);
        _kbCache = kb;
        return kb;
      }
    }
  } catch (e) {
    console.warn('加载知识库失败:', e);
  }
  const defaultKB = { shangSheMap: {}, configData: { taxSources: [], platforms: [] }, taskListData: [], lastUpdated: null, schemaVersion: KB_SCHEMA_VERSION };
  _kbCache = defaultKB;
  return defaultKB;
}

// 保存知识库
export function saveKB(kb: KB): void {
  kb.schemaVersion = KB_SCHEMA_VERSION;
  kb.lastUpdated = new Date().toISOString();
  try {
    localStorage.setItem(KB_STORAGE_KEY, JSON.stringify(kb));
    _kbCache = kb;
  } catch (e) {
    console.error('保存知识库失败:', e);
    // 降级方案：自动下载 JSON 备份
    const blob = new Blob([JSON.stringify(kb, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `知识库备份_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    alert('知识库数据超出浏览器存储限制，已自动下载为 JSON 备份文件。请妥善保存备份文件。');
  }
  notifyKBChanged();
}

// 使知识库缓存失效
export function invalidateKBCache(): void {
  _kbCache = null;
}

// 清空知识库存储（确认交互与 UI 刷新由调用方负责）
export function clearKBStorage(): void {
  localStorage.removeItem(KB_STORAGE_KEY);
  invalidateKBCache();
}
