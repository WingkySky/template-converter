// 样例对比：重新跑全部用例，与 tests/fixtures/baseline/ 逐格比对。
// 任何差异都意味着重构改变了行为——闸门不过，禁止提交。
// 用法：node tests/tools/compare.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getLegacy, seedKB, runCase, fileEntry } from './legacy-driver.mjs';

const FIX = 'tests/fixtures';
const BASE = join(FIX, 'baseline');
const CURRENT = join(FIX, 'baseline-current');
const KB = `${FIX}/灵工商社数据(1).xlsx`;

const F_SBY = `${FIX}/身边云模板_测试样例.xlsx`;
const F_2026 = `${FIX}/2026年灵工发放表格-20260601-V2.xlsx`;
const F_NSYY = `${FIX}/支付明细样例-6月.xlsx`;
const F_BATCH = `${FIX}/批量导入灵活用工费用模板（新）.xlsx`;
const F_CSV_GBK = `${FIX}/发放明细-GBK.csv`;
const F_CSV_UTF8 = `${FIX}/发放明细-UTF8.csv`;
const F_CSV_KB = `${FIX}/发放明细-KB匹配-UTF8.csv`;

function buildCases() {
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
  const cases = [];
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

// 文件名中的日期（YYYYMMDD）随运行日变化，比对时归一
const normalizeName = n => norm(n);
// 批次号/文件名内嵌 getTodayStr() 日期：归一为 DATE# 再比对（避免跨天误报）
const todayStr = (() => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
})();
const norm = (() => {
  let baseDate = '';
  return s => {
    if (!baseDate) baseDate = (JSON.parse(readFileSync(join(BASE, 'manifest.json'), 'utf8')).generatedAt || '').slice(0, 10).replaceAll('-', '');
    return s.split(todayStr).join('DATE#').split(baseDate).join('DATE#');
  };
})();
const stripBOM = s => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const cellsOf = (XLSX, buf) => {
  const wb = XLSX.read(buf, { type: 'buffer' });
  return wb.SheetNames.map(sn => ({
    sheet: sn,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, raw: false }),
  }));
};

const { XLSX, w } = await getLegacy();
seedKB(KB);

const baseline = JSON.parse(readFileSync(join(BASE, 'manifest.json'), 'utf8'));
const currentCases = buildCases();
const baseIds = Object.keys(baseline.cases).sort();
const curIds = currentCases.map(c => c.id).sort();

const problems = [];
if (JSON.stringify(baseIds) !== JSON.stringify(curIds)) {
  problems.push(`用例集不一致:\n  基线独有: ${baseIds.filter(x => !curIds.includes(x)).join(', ') || '(无)'}\n  当前独有: ${curIds.filter(x => !baseIds.includes(x)).join(', ') || '(无)'}`);
}

rmSync(CURRENT, { recursive: true, force: true });
mkdirSync(CURRENT, { recursive: true });

let checked = 0;
for (const c of currentCases) {
  if (!baseline.cases[c.id]) continue;
  const base = baseline.cases[c.id];
  const { snapshot, artifacts } = await runCase(c);

  const curDir = join(CURRENT, c.id);
  mkdirSync(curDir, { recursive: true });
  const curEntries = artifacts.map((a, i) => {
    const fn = `${String(i).padStart(3, '0')}.${a.ext}`;
    writeFileSync(join(curDir, fn), a.data);
    return { name: a.name, file: fn, ext: a.ext, data: a.data };
  });

  // 1) 快照（headers/rows/batchNo/cleanCount），日期归一后比对
  if (norm(JSON.stringify(base.snapshot)) !== norm(JSON.stringify(snapshot))) {
    const bh = base.snapshot.headers, ch = snapshot.headers;
    let detail = `headers 基线[${bh?.length}] vs 当前[${ch?.length}]`;
    if (JSON.stringify(bh) !== JSON.stringify(ch)) detail += `\n    基线: ${JSON.stringify(bh)}\n    当前: ${JSON.stringify(ch)}`;
    else {
      const br = base.snapshot.rows, cr = snapshot.rows;
      const rowDiff = br?.length !== cr?.length
        ? `行数 ${br?.length} vs ${cr?.length}`
        : br.findIndex((r, i) => JSON.stringify(r) !== JSON.stringify(cr[i]));
      detail += rowDiff === -1 ? `; batchNo ${base.snapshot.batchNo} vs ${snapshot.batchNo}; cleanCount ${base.snapshot.cleanCount} vs ${snapshot.cleanCount}` : `; 首个差异行 #${rowDiff}\n    基线: ${JSON.stringify(br[rowDiff])}\n    当前: ${JSON.stringify(cr[rowDiff])}`;
    }
    problems.push(`[${c.id}] 输出快照不一致: ${detail}`);
  }

  // 2) 产物名集合（归一日期后）
  const bn = base.artifacts.map(a => normalizeName(a.name)).sort();
  const cn = curEntries.map(a => normalizeName(a.name)).sort();
  if (JSON.stringify(bn) !== JSON.stringify(cn)) {
    problems.push(`[${c.id}] 产物名不一致:\n    基线: ${bn.join(' | ')}\n    当前: ${cn.join(' | ')}`);
    continue;
  }

  // 3) 产物内容逐格比对
  for (let i = 0; i < base.artifacts.length; i++) {
    const b = base.artifacts[i];
    const cur = curEntries[i];
    if (normalizeName(b.name) !== normalizeName(cur.name)) {
      problems.push(`[${c.id}] 产物顺序错位: ${b.name} vs ${cur.name}`);
      continue;
    }
    const baseData = readFileSync(join(BASE, c.id, b.file));
    if (b.ext === 'csv') {
      const bt = stripBOM(baseData.toString('utf8'));
      const ct = stripBOM(cur.data.toString('utf8'));
      if (norm(bt) !== norm(ct)) {
        const bl = bt.split('\n'), cl = ct.split('\n');
        const bad = bl.findIndex((l, j) => l !== cl[j]);
        problems.push(`[${c.id}] CSV 不一致: ${b.name} 行 ${bad + 1}\n    基线: ${bl[bad]?.slice(0, 160)}\n    当前: ${cl[bad]?.slice(0, 160)}`);
      }
    } else {
      const bc = norm(JSON.stringify(cellsOf(XLSX, baseData)));
      const cc = norm(JSON.stringify(cellsOf(XLSX, cur.data)));
      if (bc !== cc) {
        const bs = cellsOf(XLSX, baseData), cs = cellsOf(XLSX, cur.data);
        let detail = `sheet 数 ${bs.length} vs ${cs.length}`;
        for (let s = 0; s < Math.min(bs.length, cs.length); s++) {
          const br = JSON.stringify(bs[s].rows), cr = JSON.stringify(cs[s].rows);
          if (br !== cr) {
            const bad = bs[s].rows.findIndex((r, j) => JSON.stringify(r) !== JSON.stringify(cs[s].rows[j]));
            detail = `[${bs[s].sheet}] 行 ${bad + 1}\n    基线: ${JSON.stringify(bs[s].rows[bad])?.slice(0, 200)}\n    当前: ${JSON.stringify(cs[s].rows[bad])?.slice(0, 200)}`;
            break;
          }
        }
        problems.push(`[${c.id}] Excel 不一致: ${b.name} ${detail}`);
      }
    }
    checked++;
  }
}

rmSync(CURRENT, { recursive: true, force: true });

if (problems.length) {
  console.error(`\n❌ 对比失败（${problems.length} 处差异，核对 ${checked} 个产物）：\n`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
} else {
  console.log(`\n✅ 对比通过：${baseIds.length} 用例 / ${checked} 个产物逐格一致，输出快照一致`);
}
