import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import {
  RequestIdMiddleware,
  REQUEST_ID_HEADER,
  REDACTION_PATHS,
  generateRequestId,
} from './request-id.middleware';
import pino from 'pino';

function fakeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function fakeRes(): { res: Response; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    },
  } as unknown as Response;
  return { res, headers };
}

describe('RequestIdMiddleware', () => {
  it('generates a UUID when no client header is present + writes response header', () => {
    const mw = new RequestIdMiddleware();
    const req = fakeReq();
    const { res, headers } = fakeRes();
    let nextCalled = false;
    mw.use(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);

    const id = (req as unknown as { reqId: string }).reqId;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(headers[REQUEST_ID_HEADER]).toBe(id);
  });

  it('honours a client-supplied X-Request-Id and propagates it back', () => {
    const mw = new RequestIdMiddleware();
    const req = fakeReq({ [REQUEST_ID_HEADER]: 'abc-123' });
    const { res, headers } = fakeRes();
    mw.use(req, res, () => {});
    expect((req as unknown as { reqId: string }).reqId).toBe('abc-123');
    expect(headers[REQUEST_ID_HEADER]).toBe('abc-123');
  });

  it('sets `req.id` too so pino-http picks it up', () => {
    const mw = new RequestIdMiddleware();
    const req = fakeReq({ [REQUEST_ID_HEADER]: 'zzz' });
    const { res } = fakeRes();
    mw.use(req, res, () => {});
    expect((req as unknown as { id: string }).id).toBe('zzz');
  });

  it('rejects absurdly long ids (client-side abuse) and rolls a fresh UUID', () => {
    const mw = new RequestIdMiddleware();
    const req = fakeReq({ [REQUEST_ID_HEADER]: 'x'.repeat(500) });
    const { res } = fakeRes();
    mw.use(req, res, () => {});
    const id = (req as unknown as { reqId: string }).reqId;
    expect(id).not.toBe('x'.repeat(500));
    expect(id.length).toBeLessThan(200);
  });

  it('generateRequestId reuses an existing req.reqId when the middleware already ran', () => {
    const req = fakeReq();
    (req as unknown as { reqId: string }).reqId = 'pre-set';
    const { res } = fakeRes();
    const out = generateRequestId(req, res);
    expect(out).toBe('pre-set');
  });
});

describe('pino redaction (Rule 4)', () => {
  it('redacts every ask-listed key from a log record', async () => {
    // Capture emitted lines in-memory so we can grep them.
    const lines: string[] = [];
    const stream = {
      write: (line: string) => {
        lines.push(line);
      },
    };
    const logger = pino(
      {
        level: 'info',
        redact: { paths: REDACTION_PATHS, censor: '[REDACTED]' },
      },
      stream,
    );

    logger.info(
      {
        req: {
          headers: {
            cookie: 'careeros_session=leak',
            authorization: 'Bearer leak',
            'x-api-key': 'sk-leak',
            'x-csrf-token': 'csrf-leak',
          },
          body: {
            password: 'hunter2',
            apiKey: 'sk-leak',
            token: 'tok',
            secret: 'shhh',
            email: 'user@example.com',
          },
        },
        // wildcard-caught nested object
        payload: {
          password: 'x',
          token: 'y',
          secret: 'z',
          email: 'a@b.c',
          cookie: 'c',
          authorization: 'a',
        },
      },
      'test',
    );

    expect(lines.length).toBe(1);
    const record = JSON.parse(lines[0] ?? '{}');
    // Rule 4 keys.
    expect(record.req.headers.cookie).toBe('[REDACTED]');
    expect(record.req.headers.authorization).toBe('[REDACTED]');
    expect(record.req.headers['x-api-key']).toBe('[REDACTED]');
    expect(record.req.headers['x-csrf-token']).toBe('[REDACTED]');
    expect(record.req.body.password).toBe('[REDACTED]');
    expect(record.req.body.apiKey).toBe('[REDACTED]');
    expect(record.req.body.token).toBe('[REDACTED]');
    expect(record.req.body.secret).toBe('[REDACTED]');
    expect(record.req.body.email).toBe('[REDACTED]');
    expect(record.payload.password).toBe('[REDACTED]');
    expect(record.payload.token).toBe('[REDACTED]');
    expect(record.payload.secret).toBe('[REDACTED]');
    expect(record.payload.email).toBe('[REDACTED]');
    expect(record.payload.cookie).toBe('[REDACTED]');
    expect(record.payload.authorization).toBe('[REDACTED]');
  });
});
