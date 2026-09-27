import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  everyProgrammerShouldKnowAdapter,
  parseEveryProgrammerShouldKnow,
} from './every-programmer-should-know';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const FIXTURE = `
# Every programmer should know

- [How does the internet work?](path/to/reading)
- Reference: some non-question note
- What every developer should know about memory hierarchies?
- [Explain floating point arithmetic and its edge cases](path/to/reading)
- *
- Too short?
- [Why do we need concurrent programming patterns](path)
- What every developer should know about memory hierarchies?
`;

describe('parseEveryProgrammerShouldKnow', () => {
  it('yields bullets that end with ? or start with a starter word, tagged CC0-1.0', () => {
    const items = parseEveryProgrammerShouldKnow(FIXTURE);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.license).toBe('CC0-1.0');
      expect(item.sourceId).toBe('every-programmer-should-know');
      expect(item.body.endsWith('?') || item.body.endsWith('.')).toBe(true);
    }
    const bodies = items.map((i) => i.body);
    expect(bodies).toContain('How does the internet work?');
    expect(bodies).toContain('Explain floating point arithmetic and its edge cases?');
    expect(bodies).toContain('Why do we need concurrent programming patterns?');
  });

  it('dedupes case-insensitive bodies in one file', () => {
    const items = parseEveryProgrammerShouldKnow(FIXTURE);
    // Two "memory hierarchies" bullets in the fixture → one output.
    const memoryHits = items.filter((i) => i.body.toLowerCase().includes('memory hierarchies'));
    expect(memoryHits).toHaveLength(1);
  });

  it('drops too-short bullets and non-question, non-starter prose', () => {
    const items = parseEveryProgrammerShouldKnow(
      '- Too short?\n- Just a plain reference line without any interrogative shape\n',
    );
    expect(items).toEqual([]);
  });
});

describe('everyProgrammerShouldKnowAdapter.fetch', () => {
  it('yields >0 items with license = CC0-1.0 over MSW', async () => {
    server.use(
      http.get(
        'https://raw.githubusercontent.com/mtdvio/every-programmer-should-know/master/README.md',
        () => HttpResponse.text(FIXTURE),
      ),
    );
    const items = [];
    for await (const item of everyProgrammerShouldKnowAdapter.fetch()) items.push(item);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.license).toBe('CC0-1.0');
  });

  it('throws on 404 so refresh worker records adapter failure', async () => {
    server.use(
      http.get(
        'https://raw.githubusercontent.com/mtdvio/every-programmer-should-know/master/README.md',
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of everyProgrammerShouldKnowAdapter.fetch()) {
        /* drain */
      }
    }).rejects.toThrow(/404/);
  });
});

// MUTATION SMOKE:
//  - Remove STARTERS regex → "How does the internet work?" still passes (ends with ?),
//    but "Explain floating point arithmetic and its edge cases" (no ?) drops.
//  - Change license constant → adapter fetch test license assertion fails.
