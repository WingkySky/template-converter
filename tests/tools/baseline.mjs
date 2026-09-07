// 基线生成：用重构前的 legacy 代码对全部用例跑一遍管道，
// 产物落盘 tests/fixtures/baseline/（随重构提交，作为回归基准）。
// 重跑本脚本即刷新基线（仅应在重构开始前或有意更新行为时执行）。
// 用法：node tests/tools/baseline.mjs
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getLegacy, seedKB, runCase, fileEntry } from './legacy-driver.mjs';

const FIX = 'tests/fixtures';
const OUT = join(FIX, 'baseline');
const KB = `${FIX}/灵工商社数据(1).xlsx`;

// 转换用例源文件
const F_SBY = `${FIX}/身边云模板_测试样例.xlsx`;
const F_2026 = `${FIX}/2026年灵工发放表格-20260601-V2.xlsx`;
const F_NSYY = `${FIX}/支付明细样例-6月.xlsx`;
const F_BATCH = `${FIX}/批量导入灵活用工费用模板（新）.xlsx`;
const F_CSV_GBK = `${FIX}/发放明细-GBK.csv`;
const F_CSV_UTF8 = `${FIX}/发放明细-UTF8.csv`;
const F_CSV_KB = `${FIX}/发放明细-KB匹配-UTF8.csv`;

function buildCases() {
  const cases = [];
  const sources = [
    { key: 'sby-sample', files: [F_SBY] },
    { key: 'fafang-2026', files: [F_2026] },
    { key: 'paydetail-06', files: [F_NSYY] },
    { key: 'batch-import', files: [F_BATCH] },
    { key: 'csv-gbk', files: [F_CSV_GBK] },
    { key: 'csv-utf8', files: [F_CSV_UTF8] },
    { key: 'csv-kb-match', files: [F_CSV_KB] },
    { key: 'multi-3src', files: [F_NSYY, F_2026, F_CSV_GBK] },
  ];
  const templates = [
    { key: 'yidao', id: 'yidao' },
    { key: 'shenbianyun', id: 'shenbianyun' },
    { key: 'shenbianyun-cur', id: 'shenbianyun', sbyPlainAmount: false },
    { key: 'youyi', id: 'youyi' },
  ];
  for (const s of sources) {
    for (const t of templates) {
      cases.push({
        id: `${s.key}__${t.key}`,
        files: s.files.map(p => fileEntry(p)),
        template: t.id,
        sbyPlainAmount: t.sbyPlainAmount ?? true,
      });
    }
  }
  return cases;
}

const { w } = await getLegacy();
seedKB(KB);
console.log('知识库种子完成');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const manifest = { generatedAt: new Date().toISOString(), cases: {} };
let totalArtifacts = 0;

for (const c of buildCases()) {
  const { snapshot, artifacts } = await runCase(c);
  const dir = join(OUT, c.id);
  mkdirSync(dir, { recursive: true });
  const entries = artifacts.map((a, i) => {
    const fn = `${String(i).padStart(3, '0')}.${a.ext}`;
    writeFileSync(join(dir, fn), a.data);
    totalArtifacts++;
    return { name: a.name, file: fn, ext: a.ext };
  });
  manifest.cases[c.id] = { template: c.template, snapshot, artifacts: entries };
  console.log(`✓ ${c.id}: ${artifacts.length} 个产物, ${snapshot.rows.length} 行输出, 批次号=${snapshot.batchNo || '(空)'}`);
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n基线完成：${Object.keys(manifest.cases).length} 用例 / ${totalArtifacts} 产物 → ${OUT}`);
