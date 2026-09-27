import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  parseTechInterviewHandbook,
  techInterviewHandbookAdapter,
} from './tech-interview-handbook';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const FIXTURE = `
# Questions to ask

Some intro prose that ends with a question? Should not count.

## Section

### What are the trade-offs between eventual and strong consistency?

- CAP theorem
- Depends on read-heavy vs write-heavy workload

### Design a URL shortener like TinyURL

Prose explaining the design.

### Empty heading

### How would you scale a chat application to 10 million users?

Discuss sharding, presence, and fan-out.
`;

describe('parseTechInterviewHandbook', () => {
  it('extracts one item per H3 heading with license = MIT and non-empty body', () => {
    const items = parseTechInterviewHandbook(FIXTURE);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.license).toBe('MIT');
      expect(item.body.length).toBeGreaterThan(0);
      expect(item.promptHash).toMatch(/^[0-9a-f]{32}$/);
      expect(item.sourceId).toBe('tech-interview-handbook');
    }
    const titles = items.map((i) => i.title);
    expect(titles).toContain('What are the trade-offs between eventual and strong consistency?');
    expect(titles).toContain('Design a URL shortener like TinyURL');
  });

  it('dedupes case-insensitive titles inside one file', () => {
    const md = '### Duplicate heading\n\nbody\n\n### DUPLICATE heading\n\nother\n';
    const items = parseTechInterviewHandbook(md);
    expect(items.length).toBe(1);
  });

  it('drops empty headings (body-length filter)', () => {
    const md = '### tiny\n### another tiny\n';
    const items = parseTechInterviewHandbook(md);
    expect(items).toEqual([]);
  });
});

describe('techInterviewHandbookAdapter.fetch', () => {
  it('yields >0 items over MSW with license = MIT', async () => {
    server.use(
      http.get(
        'https://raw.githubusercontent.com/yangshun/tech-interview-handbook/main/contents/en/questions-to-ask.md',
        () => HttpResponse.text(FIXTURE),
      ),
    );
    const items = [];
    for await (const item of techInterviewHandbookAdapter.fetch()) items.push(item);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.license).toBe('MIT');
  });

  it('throws on non-200 so the refresh worker records a per-adapter failure', async () => {
    server.use(
      http.get(
        'https://raw.githubusercontent.com/yangshun/tech-interview-handbook/main/contents/en/questions-to-ask.md',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of techInterviewHandbookAdapter.fetch()) {
        /* drain */
      }
    }).rejects.toThrow(/500/);
  });
});

// MUTATION SMOKE:
//  - Flip H3 check to H2 → titles come from wrong level, first test breaks.
//  - Remove length filter → "empty heading" test picks up 1 item.
//  - Drop license = 'MIT' → adapter test's license assertion fails.
