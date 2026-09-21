// 生成 PDF 解析测试夹具（tests/fixtures/服务结算明细-测试样例.pdf）。
// 数据全部为虚构（张三/李四/王五/赵六/钱七、1380000000x、11010119900101001x），
// 不含任何真实个人信息；布局按真实业务 PDF 的关键几何特征仿真：
//   两行折行的表头单元格（垂直居中）+ 带空格的银行卡号 + 左侧标签的合计/总计行。
// 用法：node tests/tools/make-pdf-fixture.mjs（需本机 Edge，仅本地生成，CI 不依赖）
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const OUT = resolve('tests/fixtures/服务结算明细-测试样例.pdf');

const rows = [
  ['1', '张三', '110101199001010011', '13800000001', '工商银行北京测试支行', '6222 0000 1234 5678', '数据录入', '1500.00', '82.50'],
  ['2', '李四', '110101199002020022', '13800000002', '建设银行上海测试支行', '6222 0000 1234 5679', '市场推广', '2400.00', '132.00'],
  ['3', '王五', '110101199003030033', '13800000003', '招商银行广州测试支行', '6222 0000 1234 5680', '客服', '1800.00', '99.00'],
];
const rows2 = [
  ['4', '赵六', '110101199004040044', '13800000004', '中国银行深圳测试支行', '6222 0000 1234 5681', '仓储分拣', '2000.00', '110.00'],
  ['5', '钱七', '110101199005050055', '13800000005', '交通银行杭州测试支行', '6222 0000 1234 5682', '主播助理', '2600.00', '143.00'],
];

const table = (rows) => `
<table>
<tr><th>序号</th><th style="width:8%">服务人员<br>姓名</th><th style="width:9%">身份<br>证号</th><th>手机号码</th><th>银行卡开户行名称</th><th>银行账号</th><th>工作岗位</th><th>结算金额</th><th style="width:7%">支友谊外<br>服手续费</th></tr>
${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('\n')}
<tr><td>合计</td><td colspan="6"></td><td>5,700.00</td><td>313.50</td></tr>
<tr><td>总计</td><td colspan="7"></td><td>6,013.50</td></tr>
</table>`;

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { size: A4 landscape; margin: 15mm; }
body { font-family: "SimSun", "Microsoft YaHei", serif; color: #000; }
h2 { text-align: center; font-size: 18px; margin: 0 0 8px; font-weight: bold; }
.unit { text-align: right; font-size: 14px; margin: 0 0 4px; }
table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
th, td { border: 1px solid #000; padding: 9px 6px; text-align: center; vertical-align: middle; line-height: 1.4; }
th { font-weight: 400; }
</style></head><body>
<h2>2026年9月服务结算明细（虚拟测试公司）</h2>
<p class="unit">单位：元</p>
${table(rows)}
<div style="page-break-before: always;"></div>
<h2>2026年9月服务结算明细（虚拟测试公司）</h2>
<p class="unit">单位：元</p>
${table(rows2)}
</body></html>`;

const tmp = mkdtempSync(join(tmpdir(), 'pdf-fixture-'));
const htmlPath = join(tmp, 'fixture.html');
writeFileSync(htmlPath, html);

const candidates = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

// Edge 启动器进程可能先于真实渲染进程退出，故轮询等待 PDF 落盘
let done = false;
for (const edge of candidates) {
  if (!existsSync(edge)) continue;
  if (existsSync(OUT)) rmSync(OUT);
  const r = spawnSync(edge, [
    // Edge 153 实测：旧 --headless 会渲染出 ERR_FILE_NOT_FOUND 页，必须用 --headless=new
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
    `--user-data-dir=${join(tmp, 'profile')}`, '--no-pdf-header-footer',
    `--print-to-pdf=${OUT}`, `file:///${htmlPath.replace(/\\/g, '/')}`,
  ], { stdio: 'pipe', timeout: 60000 });
  if (r.stderr?.toString()) console.error(r.stderr.toString());
  for (let i = 0; i < 75 && !existsSync(OUT); i++) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  if (existsSync(OUT)) { done = true; break; }
}
try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* Edge 可能仍占用 profile 目录，留给系统清理 */ }
if (!done) { console.error('生成失败：未找到可用的 Edge 或打印超时'); process.exit(1); }
console.log('已生成', OUT);
