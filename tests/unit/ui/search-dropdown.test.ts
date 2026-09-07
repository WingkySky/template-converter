// 商社/平台搜索下拉渲染串单测（node 环境，不依赖 DOM）
import { describe, it, expect } from 'vitest';
import { createShangSheSearchHTML } from '../../../src/ui/search-dropdown';

describe('createShangSheSearchHTML', () => {
  it('生成唯一 DOM ID 与 data-action/data-prefix，不再含内联事件', () => {
    const html = createShangSheSearchHTML('batch', '搜索商社...', '某商社', 'SS01');
    expect(html).toContain('id="batch-shangshe-search"');
    expect(html).toContain('id="batch-shangshe-selected-id" value="SS01"');
    expect(html).toContain('id="batch-shangshe-dropdown"');
    expect(html).toContain('data-action="filterShangSheList" data-prefix="batch"');
    expect(html).toContain('placeholder="搜索商社..."');
    expect(html).not.toContain('oninput=');
    expect(html).not.toContain('onfocus=');
    expect(html).not.toContain('onclick=');
  });

  it('输入值经 HTML 转义', () => {
    const html = createShangSheSearchHTML('manual', '搜索...', 'a"b<c>', '');
    expect(html).toContain('value="a&quot;b&lt;c&gt;"');
  });

  it('空值兜底为空串', () => {
    const html = createShangSheSearchHTML('split0', '搜索...', undefined as unknown as string, undefined as unknown as string);
    expect(html).toContain('value="">');
  });
});
