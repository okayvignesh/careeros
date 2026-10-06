import { describe, expect, it } from 'vitest';
import { checkSelectorHealth } from './selector-health';

const goldenHtml = `
<html><body>
  <ul class="jobs-list">
    <li class="job-card"><a href="/jobs/view/1">Alpha</a></li>
    <li class="job-card"><a href="/jobs/view/2">Beta</a></li>
    <li class="job-card"><a href="/jobs/view/3">Gamma</a></li>
  </ul>
  <button data-tracking-control-name="apply-now">Apply</button>
</body></html>
`;

describe('checkSelectorHealth', () => {
  it('reports healthy when all selectors match', () => {
    const r = checkSelectorHealth(goldenHtml, [
      'ul.jobs-list',
      'li.job-card',
      'button[data-tracking-control-name=apply-now]',
    ]);
    expect(r).toEqual({ healthy: true, missing: [], drifted: [] });
  });

  it('reports missing selectors', () => {
    const r = checkSelectorHealth(goldenHtml, [
      'ul.jobs-list',
      'div.pagination',
      'button[data-tracking-control-name=save-job]',
    ]);
    expect(r.healthy).toBe(false);
    expect(r.missing).toEqual([
      'div.pagination',
      'button[data-tracking-control-name=save-job]',
    ]);
    expect(r.drifted).toEqual([]);
  });

  it('reports drift when child count deviates from baseline by more than 1', () => {
    const r = checkSelectorHealth(goldenHtml, ['ul.jobs-list'], {
      baselines: { 'ul.jobs-list': { childCount: 10 } },
    });
    expect(r.drifted).toEqual(['ul.jobs-list']);
    expect(r.healthy).toBe(false);
  });

  it('tolerates +/- 1 child-count difference (no false positive)', () => {
    const r = checkSelectorHealth(goldenHtml, ['ul.jobs-list'], {
      baselines: { 'ul.jobs-list': { childCount: 3 } },
    });
    expect(r.drifted).toEqual([]);
    expect(r.healthy).toBe(true);
  });

  it('supports *= substring attribute matcher', () => {
    const r = checkSelectorHealth(goldenHtml, [
      'button[data-tracking-control-name*=apply]',
    ]);
    expect(r.healthy).toBe(true);
  });

  it('reports empty selectors as missing', () => {
    const r = checkSelectorHealth('<html></html>', ['button.primary']);
    expect(r.missing).toEqual(['button.primary']);
  });

  it('supports quoted attribute values, including a ] inside the quotes', () => {
    const html = '<div data-x="a]b" title="hello world"></div>';
    const r = checkSelectorHealth(html, ['div[title="hello world"]', 'div[data-x="a]b"]']);
    expect(r).toEqual({ healthy: true, missing: [], drifted: [] });
  });

  it('parses ~= and |= attribute operators as presence checks', () => {
    const html = '<div data-x="en-US"></div>';
    const r = checkSelectorHealth(html, ['div[data-x~=en]', 'div[data-x|=en]']);
    expect(r.healthy).toBe(true);
  });
});
