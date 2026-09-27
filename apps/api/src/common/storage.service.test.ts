// A-M5: MinIO defaults + MIME trust. Tests cover magic-byte verification,
// per-user object-key scoping, and boot-time env enforcement.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ForbiddenObjectAccessError,
  InvalidFileTypeError,
  StorageService,
  parseResumeKey,
  verifyMagicBytes,
} from './storage.service';

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const pdfBuf = () => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 0x20)]);
const docxBuf = () =>
  Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(256, 0x00)]);
const jpegBuf = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

describe('verifyMagicBytes (A-M5)', () => {
  it('accepts a %PDF-1.4 buffer claiming application/pdf', () => {
    const out = verifyMagicBytes(pdfBuf(), PDF_MIME, 'resume.pdf');
    expect(out.kind).toBe('pdf');
    expect(out.magicMatch).toBe('%PDF');
    // mutation smoke: flip magic to 'XXXX' → must throw
    expect(() => verifyMagicBytes(Buffer.from('XXXXtail'), PDF_MIME, 'resume.pdf')).toThrow(
      InvalidFileTypeError,
    );
  });

  it('rejects arbitrary bytes claiming application/pdf', () => {
    let caught: InvalidFileTypeError | null = null;
    try {
      verifyMagicBytes(Buffer.from('not a pdf'), PDF_MIME, 'evil.pdf');
    } catch (e) {
      caught = e as InvalidFileTypeError;
    }
    expect(caught).toBeInstanceOf(InvalidFileTypeError);
    expect(caught!.reason).toBe('pdf_magic_mismatch');
    expect(caught!.claimedMime).toBe(PDF_MIME);
    expect(caught!.magicMatch).toMatch(/^[0-9a-f]+$/);
  });

  it('accepts a DOCX-shaped ZIP with .docx extension', () => {
    const out = verifyMagicBytes(docxBuf(), DOCX_MIME, 'CV.docx');
    expect(out.kind).toBe('docx');
    // mutation smoke: rename to .txt → must throw (shallow check gates on extension)
    expect(() => verifyMagicBytes(docxBuf(), DOCX_MIME, 'CV.txt')).toThrow(InvalidFileTypeError);
  });

  it('rejects JPEG bytes claiming DOCX mimetype', () => {
    let caught: InvalidFileTypeError | null = null;
    try {
      verifyMagicBytes(jpegBuf(), DOCX_MIME, 'sneaky.docx');
    } catch (e) {
      caught = e as InvalidFileTypeError;
    }
    expect(caught).toBeInstanceOf(InvalidFileTypeError);
    expect(caught!.reason).toBe('docx_magic_mismatch');
  });

  it('rejects an unknown mimetype outright', () => {
    expect(() => verifyMagicBytes(Buffer.from('anything'), 'text/plain', 'a.txt')).toThrow(
      /unsupported_type/,
    );
  });
});

describe('parseResumeKey (A-M5 scoped keys)', () => {
  it('parses a valid resumes/{userId}/{resumeId}/{filename} key', () => {
    const parsed = parseResumeKey('resumes/user-a/resume-1/20260101_cv.pdf');
    expect(parsed).toEqual({ userId: 'user-a', resumeId: 'resume-1' });
    // mutation smoke: strip the resumeId segment → throws
    expect(() => parseResumeKey('resumes/user-a/20260101_cv.pdf')).toThrow(
      ForbiddenObjectAccessError,
    );
  });

  it('rejects a key that escapes the resumes/ namespace', () => {
    expect(() => parseResumeKey('other/user-a/x/y.pdf')).toThrow(ForbiddenObjectAccessError);
  });
});

describe('StorageService constructor env enforcement (A-M5)', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ['MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY']) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of ['MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const logger = { info: () => {}, warn: () => {}, error: () => {} } as never;

  it('throws when MINIO_ACCESS_KEY is missing (no fallback default)', () => {
    delete process.env.MINIO_ACCESS_KEY;
    process.env.MINIO_SECRET_KEY = 'somesecret';
    expect(() => new StorageService(logger)).toThrow(/MINIO_ACCESS_KEY is required/);
    // mutation smoke: restore both → constructor works
    process.env.MINIO_ACCESS_KEY = 'ak';
    expect(() => new StorageService(logger)).not.toThrow();
  });

  it('throws when MINIO_SECRET_KEY is missing (no fallback default)', () => {
    process.env.MINIO_ACCESS_KEY = 'ak';
    delete process.env.MINIO_SECRET_KEY;
    expect(() => new StorageService(logger)).toThrow(/MINIO_SECRET_KEY is required/);
  });
});

describe('StorageService presignResumeDownload cross-user gate (A-M5)', () => {
  it('refuses to presign another user\'s key', async () => {
    process.env.MINIO_ACCESS_KEY = 'ak';
    process.env.MINIO_SECRET_KEY = 'sk';
    const logger = { info: () => {}, warn: () => {}, error: () => {} } as never;
    const svc = new StorageService(logger);
    // Real MinIO isn't running; the guard runs BEFORE the network call so we can
    // assert the throw without any client mock. Mutation smoke: if the userId
    // guard is removed, this would try to hit MinIO instead of throwing.
    await expect(
      svc.presignResumeDownload('user-a', 'resumes/user-b/resume-1/x.pdf'),
    ).rejects.toBeInstanceOf(ForbiddenObjectAccessError);
  });
});
