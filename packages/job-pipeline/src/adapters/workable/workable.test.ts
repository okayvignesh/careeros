import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { SsrfBlockedError } from '@careeros/shared/net';
import { RawJobSchema } from '../../types';
import { createWorkableAdapter, mapWorkable } from './index';
import { MalformedResponseError } from '../errors';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', '__fixtures__', 'adapters', 'workable.json'), 'utf8'),
) as { jobs: Array<Record<string, unknown>> };

const BASE = 'https://apply.workable.com/api/v1/widget/accounts';
const BOARD = `${BASE}/acme`;

describe('workable adapter', () => {
  it('maps the full board into schema-valid RawJobs with correct provenance', async () => {
    server.use(http.get(BOARD, () => HttpResponse.json(FIXTURE)));
    const raws = await createWorkableAdapter({ accounts: ['acme'], lookup: fakeLookup }).fetch();
    expect(raws).toHaveLength(2);
    for (const r of raws) expect(() => RawJobSchema.parse(r)).not.toThrow();
    expect(raws[0]?.sourceName).toBe('workable');
    expect(raws[0]?.sourceId).toBe('acme:B2830431EC');
    expect(raws[0]?.company).toBe('Remotely');
    expect(raws[0]?.remote).toBe(true);
    expect(raws[0]?.description).toContain('financial operations');
    expect(raws[1]?.location).toBe('Austin, Texas, United States');
    expect(raws[1]?.remote).toBe(false);
  });

  it('caps emitted rows at maxJobs', async () => {
    server.use(http.get(BOARD, () => HttpResponse.json(FIXTURE)));
    const raws = await createWorkableAdapter({
      accounts: ['acme'],
      lookup: fakeLookup,
      maxJobs: 1,
    }).fetch();
    expect(raws).toHaveLength(1);
  });

  it('throws MalformedResponseError when the board shape is invalid', async () => {
    server.use(http.get(BOARD, () => HttpResponse.json({ name: 'acme' })));
    await expect(
      createWorkableAdapter({ accounts: ['acme'], lookup: fakeLookup, retryAttempts: 1 }).fetch(),
    ).rejects.toBeInstanceOf(MalformedResponseError);
  });

  it('returns [] without hitting the network when no accounts are configured', async () => {
    server.use(http.get(`${BASE}/*`, () => HttpResponse.error()));
    expect(await createWorkableAdapter({ accounts: [], lookup: fakeLookup }).fetch()).toEqual([]);
  });

  it('rejects a non-allowlisted base via SsrfBlockedError', async () => {
    const adapter = createWorkableAdapter({
      accounts: ['acme'],
      baseUrl: 'https://evil.example.com/api/v1/widget/accounts',
      lookup: fakeLookup,
    });
    await expect(adapter.fetch()).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe('mapWorkable', () => {
  it('drops rows missing title/shortcode/url', () => {
    expect(mapWorkable({ title: '', shortcode: 'x' }, 'acme')).toBeNull();
    expect(mapWorkable({ title: 't', shortcode: '' }, 'acme')).toBeNull();
    expect(mapWorkable({ title: 't', shortcode: 'x' }, 'acme')).toBeNull();
  });

  it('uses locations[0] for a composed location string', () => {
    const raw = mapWorkable(
      {
        title: 'Eng',
        shortcode: 'S1',
        url: 'https://apply.workable.com/j/S1',
        locations: [{ city: 'Lisbon', region: 'Lisboa', country: 'Portugal' }],
      },
      'acme',
      'Acme',
    );
    expect(raw!.location).toBe('Lisbon, Lisboa, Portugal');
    expect(raw!.sourceId).toBe('acme:S1');
  });

  it('flags remote from telecommuting or the location text', () => {
    const remote = mapWorkable(
      { title: 'Eng', shortcode: 'S1', url: 'https://apply.workable.com/j/S1', telecommuting: true },
      'acme',
    );
    expect(remote!.remote).toBe(true);
    const onsite = mapWorkable(
      {
        title: 'Eng',
        shortcode: 'S2',
        url: 'https://apply.workable.com/j/S2',
        locations: [{ city: 'Berlin', country: 'Germany' }],
      },
      'acme',
    );
    expect(onsite!.remote).toBe(false);
  });
});
