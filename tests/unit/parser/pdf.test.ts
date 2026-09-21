// PDF 数据源解析集成测试：合成夹具（tests/tools/make-pdf-fixture.mjs 生成，
// 数据全部虚构）经生产入口 parsePdfSource（pdf.js 主线程 fake worker）走完整管线。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePdfSource } from '../../../src/core/parser/pdf';

const fixturePath = fileURLToPath(new URL('../../fixtures/服务结算明细-测试样例.pdf', import.meta.url));

async function parseFixture() {
  const buf = readFileSync(fixturePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return parsePdfSource(ab, '服务结算明细-测试样例.pdf');
}

const EXPECT_HEADER = ['序号', '服务人员姓名', '身份证号', '手机号码', '银行卡开户行名称', '银行账号', '工作岗位', '结算金额', '支友谊外服手续费'];

describe('parsePdfSource（合成夹具，2 页 5 人，全部虚构数据）', () => {
  it('返回单个 pdf 数据源且默认选中', async () => {
    const items = await parseFixture();
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('pdf');
    expect(items[0].sheetName).toBe('PDF');
    expect(items[0].fileName).toBe('服务结算明细-测试样例.pdf');
    expect(items[0].selected).toBe(true);
  });

  it('表头完整重建（折行片段拼回原词，两页表头一致）', async () => {
    const { rows } = (await parseFixture())[0];
    expect(rows[2]).toEqual(EXPECT_HEADER);
    // 第 2 页的重复表头也在（跨页拼接）
    expect(rows[10]).toEqual(EXPECT_HEADER);
  });

  it('两页共 5 行人员数据，合计/总计行保留在 rows 但不计入 dataRows', async () => {
    const src = (await parseFixture())[0];
    expect(src.analysis?.dataRowsCount).toBe(5);
    expect(src.rows.some(r => r[0] === '合计')).toBe(true);
    expect(src.rows.some(r => r[0] === '总计')).toBe(true);
  });

  it('卡号去排版空格、正文行值正确', async () => {
    const { rows } = (await parseFixture())[0];
    expect(rows[3]).toEqual(['1', '张三', '110101199001010011', '13800000001', '工商银行北京测试支行', '6222000012345678', '数据录入', '1500.00', '82.50']);
    expect(rows[11]).toEqual(['4', '赵六', '110101199004040044', '13800000004', '中国银行深圳测试支行', '6222000012345681', '仓储分拣', '2000.00', '110.00']);
  });

  it('自动列映射：姓名/身份证/手机号/开户行/卡号/金额全中', async () => {
    const src = (await parseFixture())[0];
    const cols = src.analysis?.autoMap.cols || {};
    expect(cols['1'].type).toBe('name');
    expect(cols['2'].type).toBe('idCard');
    expect(cols['3'].type).toBe('phone');
    expect(cols['4'].type).toBe('bankName');
    expect(cols['5'].type).toBe('bankCard');
    expect(cols['7'].type).toBe('amount');
    expect(src.analysis?.autoMap.amountCol).toBe(7);
    expect(src.analysis?.autoMap.nameCol).toBe(1);
  });

  it('无文字 PDF（扫描件场景）抛出可读错误', async () => {
    // 最小空白 PDF（无任何文本项，pdf.js 会自动重建 xref）
    const blank = new Uint8Array(Array.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >> endobj\ntrailer << /Root 1 0 R /Size 4 >>\n%%EOF', ch => ch.charCodeAt(0)));
    await expect(parsePdfSource(blank.buffer, 'blank.pdf')).rejects.toThrow(/扫描件/);
  });
});
