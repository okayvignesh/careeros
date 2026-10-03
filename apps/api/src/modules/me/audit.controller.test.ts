import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { AuditController } from './audit.controller';

const req = { headers: {}, ip: '127.0.0.1' } as unknown as Request;

function fakeSession() {
  return { requireUserId: vi.fn(() => 'user-1') };
}

describe('AuditController', () => {
  it('scopes to the session user and redacts secret payload keys', async () => {
    const row = {
      id: 'r1',
      userId: 'user-1',
      actor: 'user',
      action: 'security.master_key.rotated',
      resourceType: 'user',
      resourceId: 'user-1',
      payload: { token: 'super-secret', nested: { api_key: 'sk-abc' }, plain: 'ok' },
      ip: '127.0.0.1',
      userAgent: 'vitest',
      timestamp: new Date('2026-09-18T08:02:00.000Z'),
    };
    const prisma = {
      auditEvent: {
        findMany: vi.fn(async () => [row]),
        count: vi.fn(async () => 1),
      },
    };
    const controller = new AuditController(prisma as never, fakeSession() as never);

    const page = await controller.list(req, 50, 0);

    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1' }) }),
    );
    expect(page.total).toBe(1);
    expect(page.rows[0]?.payload).toEqual({
      token: '[REDACTED]',
      nested: { api_key: '[REDACTED]' },
      plain: 'ok',
    });
    expect(page.rows[0]?.timestamp).toBe('2026-09-18T08:02:00.000Z');
  });

  it('rejects an out-of-range limit before querying', async () => {
    const prisma = { auditEvent: { findMany: vi.fn(), count: vi.fn() } };
    const controller = new AuditController(prisma as never, fakeSession() as never);
    await expect(controller.list(req, 0, 0)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.list(req, 500, 0)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });
});
