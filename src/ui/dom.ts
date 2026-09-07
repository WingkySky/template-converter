// ui 层基础工具：HTML 转义与事件委托。
// 阶段 3 起所有动态生成的 HTML 一律用 data-action 属性 + 事件委托，
// 不再向 window 挂函数、不再使用内联 onclick。

/** HTML 转义（自 legacy 逐字迁入） */
export function escapeHTML(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 事件委托：在 container 上监听 type 事件，命中 [data-action] 时
 * 按 action 名分发到 handlers。data-* 属性作为参数载体：
 *   <button data-action="applyFilter" data-col-idx="3">应用</button>
 *   handler(el, e) 中用 el.dataset.colIdx 取参。
 * 未命中 action 或无对应 handler 时静默放行（允许嵌套/共存）。
 */
export function delegateAction(
  container: ParentNode,
  type: string,
  handlers: Record<string, (el: HTMLElement, e: Event) => void>,
): void {
  container.addEventListener(type, (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (!target || typeof (target as Element).closest !== 'function') return;
    const el = target.closest('[data-action]') as HTMLElement | null;
    if (!el) return;
    const action = el.dataset.action;
    if (!action) return;
    const fn = handlers[action];
    if (fn) fn(el, e);
  });
}

/** 简化 getElementById */
export function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}
