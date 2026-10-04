import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { SessionController } from './session.controller';

// @nestjs/throttler v6 does not re-export its constants from the barrel (see
// passkey.controller.test.ts) so the metadata key prefixes are hard-coded.
const THROTTLER_LIMIT_KEY = 'THROTTLER:LIMIT';
const THROTTLER_TTL_KEY = 'THROTTLER:TTL';

function hasThrottleMeta(target: object, methodName: string): boolean {
  const proto = (target as { prototype: Record<string, unknown> }).prototype;
  const method = proto[methodName];
  const candidates: unknown[] = [method];
  const desc = Object.getOwnPropertyDescriptor(proto, methodName);
  if (desc?.value && desc.value !== method) candidates.push(desc.value);
  for (const c of candidates) {
    if (!c) continue;
    const keys = Reflect.getMetadataKeys(c as object) as string[];
    const hasLimit = keys.some((k) => k.startsWith(THROTTLER_LIMIT_KEY));
    const hasTtl = keys.some((k) => k.startsWith(THROTTLER_TTL_KEY));
    if (hasLimit && hasTtl) return true;
  }
  return false;
}

function build(opts: { userId?: string; sessionId?: string | null } = {}) {
  const userId = opts.userId ?? 'user-1';
  const sessionId = opts.sessionId === undefined ? 'sid-current' : opts.sessionId;
  const sessions = {
    requireUserId: vi.fn(() => userId),
    read: vi.fn(() => (sessionId ? { userId, sessionId, createdAt: 0, expiresAt: 0 } : null)),
    listForUser: vi.fn(async () => []),
    revokeForUser: vi.fn(async () => undefined),
    revokeOthersForUser: vi.fn(async () => 2),
  };
  const prisma = { auditEvent: { create: vi.fn(async () => ({})) } };
  const controller = new SessionController(sessions as never, prisma as never);
  const req = { headers: { 'user-agent': 'vitest' }, ip: '203.0.113.7' } as unknown as Request;
  return { controller, sessions, prisma, req };
}

describe('SessionController scoping (A-H3)', () => {
  it('list scopes to the caller and marks the current session', async () => {
    const { controller, sessions, req } = build();
    await controller.list(req);
    expect(sessions.requireUserId).toHaveBeenCalledWith(req);
    expect(sessions.listForUser).toHaveBeenCalledWith('user-1', 'sid-current');
  });

  it('list passes a null current id for a session-less (mobile) caller', async () => {
    const { controller, sessions, req } = build({ sessionId: null });
    await controller.list(req);
    expect(sessions.listForUser).toHaveBeenCalledWith('user-1', null);
  });

  it('revoke refuses to delete the current session before hitting the DB', async () => {
    const current = '11111111-1111-4111-8111-111111111111';
    const { controller, sessions, req } = build({ sessionId: current });
    await expect(controller.revoke(req, current)).rejects.toBeInstanceOf(BadRequestException);
    expect(sessions.revokeForUser).not.toHaveBeenCalled();
  });

  it('revoke passes the caller userId so the service scopes the delete', async () => {
    const { controller, sessions, req } = build();
    await controller.revoke(req, '11111111-1111-4111-8111-111111111111');
    expect(sessions.revokeForUser).toHaveBeenCalledWith(
      'user-1',
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('revoke rejects a non-UUID id as 404 (no Prisma uuid error)', async () => {
    const { controller, sessions, req } = build();
    await expect(controller.revoke(req, 'not-a-uuid')).rejects.toBeInstanceOf(NotFoundException);
    expect(sessions.revokeForUser).not.toHaveBeenCalled();
  });

  it('revokeOthers keeps the current session and returns the count', async () => {
    const { controller, sessions, req } = build();
    await expect(controller.revokeOthers(req)).resolves.toEqual({ revoked: 2 });
    expect(sessions.revokeOthersForUser).toHaveBeenCalledWith('user-1', 'sid-current');
  });

  it('writes an audit row for both revoke paths', async () => {
    const one = build();
    await one.controller.revoke(one.req, '11111111-1111-4111-8111-111111111111');
    expect(one.prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    const many = build();
    await many.controller.revokeOthers(many.req);
    expect(many.prisma.auditEvent.create).toHaveBeenCalledTimes(1);
  });
});

describe('SessionController rate-limit metadata', () => {
  it('revoke + revoke-others carry @RateLimitSessions metadata; list stays on the global cap', () => {
    expect(hasThrottleMeta(SessionController, 'revoke')).toBe(true);
    expect(hasThrottleMeta(SessionController, 'revokeOthers')).toBe(true);
    expect(hasThrottleMeta(SessionController, 'list')).toBe(false);
    // MUTATION-SMOKE: strip @RateLimitSessions() from a mutation and this flips red.
  });
});
