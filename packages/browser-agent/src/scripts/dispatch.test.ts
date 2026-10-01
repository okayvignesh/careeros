import { describe, expect, it } from 'vitest';
import { pickFormFillScript } from './dispatch';

describe('pickFormFillScript', () => {
  it('returns a script for every form-fill kind', () => {
    for (const kind of [
      'ashby-apply',
      'greenhouse-apply',
      'linkedin-easy-apply',
      'indeed-easy-apply',
      'naukri-apply',
      'generic-apply',
    ] as const) {
      expect(pickFormFillScript(kind)).toBeTypeOf('function');
    }
  });

  it('returns undefined for discover kinds (not form-fill)', () => {
    expect(pickFormFillScript('linkedin-discover')).toBeUndefined();
    expect(pickFormFillScript('indeed-discover')).toBeUndefined();
  });
});
