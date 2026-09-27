import { describe, expect, it } from 'vitest';
import {
  AGENT_TASK_KINDS,
  AgentResult,
  AgentTask,
  DeviceInfo,
  EvidenceBundle,
  PairingComplete,
  PairingRequest,
} from './types';

const validSha = 'a'.repeat(64);

const validTask = {
  id: '11111111-2222-4333-8444-555555555555',
  kind: 'linkedin-discover' as const,
  params: { query: 'senior swe', location: 'remote' },
  createdAt: '2026-09-27T10:00:00.000Z',
  expiresAt: '2026-09-27T10:15:00.000Z',
};

describe('AgentTask', () => {
  it('round-trips every registered kind', () => {
    for (const kind of AGENT_TASK_KINDS) {
      const parsed = AgentTask.parse({ ...validTask, kind });
      expect(parsed.kind).toBe(kind);
    }
  });

  it('rejects unknown kinds', () => {
    expect(() => AgentTask.parse({ ...validTask, kind: 'zip-recruiter-apply' })).toThrow();
  });

  it('rejects non-uuid id', () => {
    expect(() => AgentTask.parse({ ...validTask, id: 'not-a-uuid' })).toThrow();
  });

  it('rejects malformed timestamps', () => {
    expect(() => AgentTask.parse({ ...validTask, createdAt: '2026-13-40 25:99' })).toThrow();
  });

  it('accepts an empty params object', () => {
    const p = AgentTask.parse({ ...validTask, params: {} });
    expect(p.params).toEqual({});
  });
});

describe('EvidenceBundle', () => {
  it('accepts a well-formed bundle', () => {
    const p = EvidenceBundle.parse({
      screenshotShas: [validSha],
      harShas: [],
      domSnapshotSha: validSha,
      urlsVisited: ['https://linkedin.com/jobs/view/123'],
    });
    expect(p.screenshotShas).toHaveLength(1);
  });

  it('rejects non-sha256 hashes', () => {
    expect(() =>
      EvidenceBundle.parse({
        screenshotShas: ['abc'],
        harShas: [],
        urlsVisited: [],
      }),
    ).toThrow();
  });

  it('rejects non-URL urlsVisited entries', () => {
    expect(() =>
      EvidenceBundle.parse({
        screenshotShas: [],
        harShas: [],
        urlsVisited: ['linkedin.com/jobs'],
      }),
    ).toThrow();
  });
});

describe('AgentResult', () => {
  const base = {
    taskId: validTask.id,
    status: 'ok' as const,
    completedAt: '2026-09-27T10:03:00.000Z',
  };

  it('accepts ok / error / timeout / blocked', () => {
    for (const status of ['ok', 'error', 'timeout', 'blocked'] as const) {
      const p = AgentResult.parse({ ...base, status });
      expect(p.status).toBe(status);
    }
  });

  it('accepts error results with a message', () => {
    const p = AgentResult.parse({ ...base, status: 'error', error: 'blocked by CAPTCHA' });
    expect(p.error).toBe('blocked by CAPTCHA');
  });
});

describe('DeviceInfo / Pairing', () => {
  const dev = { name: 'Vignesh MBP', os: 'macos' as const, agentVersion: '0.1.0' };

  it('accepts each supported OS', () => {
    for (const os of ['macos', 'windows', 'linux'] as const) {
      expect(() => DeviceInfo.parse({ ...dev, os })).not.toThrow();
    }
  });

  it('rejects malformed semver', () => {
    expect(() => DeviceInfo.parse({ ...dev, agentVersion: 'v1' })).toThrow();
  });

  it('PairingRequest enforces 8-char code', () => {
    expect(() => PairingRequest.parse({ code: 'ABCD1234', device: dev })).not.toThrow();
    expect(() => PairingRequest.parse({ code: 'SHORT', device: dev })).toThrow();
  });

  it('PairingComplete requires a URL wssUrl', () => {
    expect(() =>
      PairingComplete.parse({
        agentId: validTask.id,
        jwt: 'j.w.t',
        refreshToken: 'r',
        wssUrl: 'wss://api.careeros.example/agent/ws',
      }),
    ).not.toThrow();
    expect(() =>
      PairingComplete.parse({
        agentId: validTask.id,
        jwt: 'j.w.t',
        refreshToken: 'r',
        wssUrl: 'not-a-url',
      }),
    ).toThrow();
  });
});
