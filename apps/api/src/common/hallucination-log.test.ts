import { describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { encryptField, isEncryptedField } from '@careeros/secrets';
import { makeHallucinationLogger } from './hallucination-log';

// A-M4: two contracts.
//   1. The logger writes snippet + snippetHash + snippetOffset when sourceText
//      is provided; raw snippet is omitted unless includeRawSnippet=true.
//   2. When the write flows through the PrismaService encryption middleware
//      (ENCRYPTED_FIELDS: LlmHallucinationLog.snippet), the snippet column
//      leaves the app as ciphertext, never plaintext.

type CreateArgs = { data: Record<string, unknown> };

function fakePrisma() {
  const created: CreateArgs[] = [];
  return {
    created,
    llmHallucinationLog: {
      create: vi.fn(async (args: CreateArgs) => {
        created.push(args);
        return { id: 'row-1', ...args.data };
      }),
    },
  };
}

const META = {
  promptId: 'resume-extract',
  promptVersion: '1.0.0',
  promptHash: 'abc123',
};

const REPORT = {
  suspects: ['Initech Systems'],
  byKind: {
    numbers: [],
    years: [],
    dates: [],
    currency: [],
    properNouns: ['Initech Systems'],
  },
};

describe('A-M4 makeHallucinationLogger', () => {
  it('early-returns on empty suspects and never touches the DB', async () => {
    const prisma = fakePrisma();
    const hook = makeHallucinationLogger(prisma as never, 'user-1');
    await hook({ suspects: [], byKind: REPORT.byKind }, META);
    expect(prisma.llmHallucinationLog.create).not.toHaveBeenCalled();
  });

  it('writes snippetHash + snippetOffset but no raw snippet by default', async () => {
    const prisma = fakePrisma();
    const source = 'Working at Initech Systems on the TPS reports project.';
    const hook = makeHallucinationLogger(prisma as never, 'user-1', undefined, {
      sourceText: source,
    });
    await hook(REPORT, META);
    expect(prisma.llmHallucinationLog.create).toHaveBeenCalledOnce();
    const data = prisma.created[0]!.data;
    expect(data.snippet).toBeNull();
    expect(data.snippetHash).toBe(
      createHash('sha256').update(source, 'utf8').digest('hex').slice(0, 32),
    );
    expect(data.snippetOffset).toEqual({
      start: source.indexOf('Initech Systems'),
      end: source.indexOf('Initech Systems') + 'Initech Systems'.length,
    });
    expect(data.suspectFragments).toEqual(['Initech Systems']);
    expect(data.userId).toBe('user-1');
  });

  it('when includeRawSnippet=true, snippet is the plaintext EXCERPT at the write boundary (encryption is layered above via middleware)', async () => {
    const prisma = fakePrisma();
    const source = 'A'.repeat(200) + 'Initech Systems' + 'B'.repeat(200);
    const hook = makeHallucinationLogger(prisma as never, 'user-1', undefined, {
      sourceText: source,
      includeRawSnippet: true,
    });
    await hook(REPORT, META);
    const data = prisma.created[0]!.data as { snippet: string };
    expect(typeof data.snippet).toBe('string');
    expect(data.snippet).toContain('Initech Systems');
    // Bounded excerpt, not the whole PII payload.
    expect(data.snippet.length).toBeLessThan(source.length);
  });

  it('omits snippet fields entirely when no sourceText is passed (back-compat)', async () => {
    const prisma = fakePrisma();
    const hook = makeHallucinationLogger(prisma as never, 'user-1');
    await hook(REPORT, META);
    const data = prisma.created[0]!.data;
    expect(data.snippet).toBeNull();
    expect(data.snippetHash).toBeNull();
    expect(data.snippetOffset).toBeNull();
  });

  it('encryption boundary: the ENCRYPTED_FIELDS snippet marker converts plaintext to opaque ciphertext', () => {
    // Reproduces the invariant PrismaService.onModuleInit relies on:
    // any value written under `LlmHallucinationLog.snippet` is passed through
    // encryptField('snippet') before hitting Postgres. `enc:v1:snippet:<b64>`.
    const master = randomBytes(32);
    const plain = 'A resume line the model hallucinated from: Initech Systems 2018 $200k';
    const ct = encryptField(plain, master, 'snippet');
    expect(isEncryptedField(ct)).toBe(true);
    expect(ct.startsWith('enc:v1:snippet:')).toBe(true);
    expect(ct).not.toContain('Initech Systems');
    expect(ct).not.toContain(plain);
    expect(ct).not.toContain('2018');
    expect(ct).not.toContain('200k');
  });

  it('swallows DB errors instead of propagating (fire-and-forget contract)', async () => {
    const prisma = {
      llmHallucinationLog: {
        create: vi.fn(async () => {
          throw new Error('db exploded');
        }),
      },
    };
    const warn = vi.fn();
    const info = vi.fn();
    const hook = makeHallucinationLogger(prisma as never, 'user-1', {
      warn,
      info,
    } as unknown as import('nestjs-pino').PinoLogger);
    await expect(hook(REPORT, META)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![1]).toMatch(/hallucination log write failed/);
  });

  // MUTATION SMOKE:
  //   - Drop the `snippet` line from ENCRYPTED_FIELDS in prisma.service.ts →
  //     the encryption-boundary test still passes in isolation, but the
  //     integration path leaks plaintext; add a follow-up assertion in a
  //     prisma.service.test.ts once middleware coverage lands.
  //   - Flip `includeRawSnippet` default to true → the "omits snippet"
  //     assertion in the default-mode test fails and the resume-service caller
  //     starts writing PII by default.
  //   - Remove the hash truncation slice(0, 32) → snippetHash-length
  //     assertion mismatches.
});
