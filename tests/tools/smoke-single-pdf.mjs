// 单文件构建（dist-single）file:// 冒烟：无头 Edge + CDP 驱动真实页面，
// 以 DataTransfer 注入合成 PDF 夹具（数据全部虚构），验证 PDF 分支在
// 单文件/无 Worker 环境下走通：上传 → 解析 → 列映射步骤渲染出表头。
// 用法：node tests/tools/smoke-single-pdf.mjs（需本机 Edge；先 npm run build:single）
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const PORT = 9333;
const PAGE_URL = 'file:///' + resolve('dist-single/index.html').replace(/\\/g, '/');
const FIXTURE = resolve('tests/fixtures/服务结算明细-测试样例.pdf');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  if (!existsSync('dist-single/index.html')) throw new Error('dist-single/index.html 不存在，先 npm run build:single');
  const pdfBase64 = readFileSync(FIXTURE).toString('base64');

  const userDir = mkdtempSync(join(tmpdir(), 'tc-smoke-'));
  const edge = EDGE_CANDIDATES.find(existsSync);
  if (!edge) throw new Error('未找到 Edge');
  const proc = spawn(edge, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
    `--user-data-dir=${join(userDir, 'profile')}`, `--remote-debugging-port=${PORT}`,
    'about:blank',
  ], { stdio: 'ignore' });
  try {
    // 等 CDP 端口就绪
    let version = null;
    for (let i = 0; i < 50 && !version; i++) {
      await sleep(200);
      try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { /* 未就绪 */ }
    }
    if (!version) throw new Error('CDP 端口未就绪');

    // 新建标签页（Chromium 111+ 需要 PUT）
    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(PAGE_URL)}`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    const pending = new Map();
    const consoleErrors = [];
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
      }
    };
    const send = (method, params = {}) => new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, m => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
    const evalJs = async expression => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate 异常');
      return r.result.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: PAGE_URL });
    await sleep(1500);

    // 注入 PDF（DataTransfer 模拟用户选择文件）并等待列映射步骤出现
    const result = await evalJs(`(async () => {
      const bin = atob(${JSON.stringify(pdfBase64)});
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const file = new File([u8], '服务结算明细-测试样例.pdf', { type: 'application/pdf' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.getElementById('file-input');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 100; i++) {
        await new Promise(r => setTimeout(r, 200));
        const step = document.getElementById('step-mapping');
        if (step && !step.classList.contains('hidden')) {
          const text = document.getElementById('mapping-content').innerText;
          return { ok: true, hasHeader: text.includes('服务人员姓名') && text.includes('身份证号') && text.includes('银行账号'), excerpt: text.slice(0, 400) };
        }
      }
      return { ok: false, body: document.body.innerText.slice(0, 400) };
    })()`);

    ws.close();
    if (!result.ok) {
      console.error('❌ 冒烟失败：列映射步骤未出现\n', result.body);
      process.exit(1);
    }
    if (!result.hasHeader) {
      console.error('❌ 冒烟失败：列映射已出现但未识别出 PDF 表头\n', result.excerpt);
      process.exit(1);
    }
    const realErrors = consoleErrors.filter(e => !/legacy build|pdf.worker|deprecat/i.test(e));
    if (realErrors.length) {
      console.error('❌ 冒烟失败：页面控制台有错误\n', realErrors.join('\n'));
      process.exit(1);
    }
    console.log('✅ 单文件 file:// PDF 冒烟通过：上传→解析→列映射（含 服务人员姓名/身份证号/银行账号）');
  } finally {
    proc.kill();
    try { rmSync(userDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); } catch { /* Edge 可能仍占用 */ }
  }
}
main().catch(e => { console.error('❌ 冒烟异常：', e.message); process.exit(1); });
