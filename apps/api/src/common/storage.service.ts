import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Client as MinioClient } from 'minio';

const BUCKET = process.env.MINIO_BUCKET ?? 'careeros';

// A-M5: presigned GET expiry. 5 min is enough for the browser to fetch the object
// once (typical resume < 2 MB) and short enough that a leaked URL is worthless.
const PRESIGN_TTL_SECONDS = 300;

// A-M5: verified magic-byte signatures for the two upload types we accept.
// Trusting `file.mimetype` from multer is client-controlled and cannot gate uploads.
const PDF_MAGIC = Buffer.from('%PDF');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"

export class InvalidFileTypeError extends Error {
  constructor(
    public readonly reason: string,
    public readonly claimedMime: string,
    public readonly magicMatch: string | null,
  ) {
    super(`Rejected upload: ${reason}`);
    this.name = 'InvalidFileTypeError';
  }
}

export class ForbiddenObjectAccessError extends Error {
  constructor(public readonly key: string, public readonly requestingUserId: string) {
    super('Forbidden object access');
    this.name = 'ForbiddenObjectAccessError';
  }
}

// ponytail: shallow docx check — verifies the outer ZIP magic + .docx extension
// + reasonable size. A crafted .docx-named ZIP without [Content_Types].xml would
// pass this. Upgrade path: parse the central directory with `unzipper` or `jszip`
// and require the entry `[Content_Types].xml`. Left shallow because adding a zip
// lib for a 4-byte check is not worth the dep, and the file is only ever read back
// as an opaque archive (mammoth already does content-shape validation at parse
// time in resume.service.extractText).
export function verifyMagicBytes(
  buffer: Buffer,
  claimedMime: string,
  filename: string,
): { kind: 'pdf' | 'docx'; magicMatch: string } {
  const head = buffer.subarray(0, 4);
  const name = filename.toLowerCase();

  const claimsPdf = claimedMime === 'application/pdf' || name.endsWith('.pdf');
  const claimsDocx =
    claimedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx');

  if (claimsPdf) {
    if (head.equals(PDF_MAGIC)) return { kind: 'pdf', magicMatch: '%PDF' };
    throw new InvalidFileTypeError('pdf_magic_mismatch', claimedMime, head.toString('hex'));
  }
  if (claimsDocx) {
    if (head.equals(ZIP_MAGIC) && name.endsWith('.docx') && buffer.length < 25 * 1024 * 1024) {
      return { kind: 'docx', magicMatch: 'PK\\x03\\x04' };
    }
    throw new InvalidFileTypeError('docx_magic_mismatch', claimedMime, head.toString('hex'));
  }
  throw new InvalidFileTypeError('unsupported_type', claimedMime, head.toString('hex'));
}

// A-M5: object keys are scoped `resumes/{userId}/{resumeId}/{filename}` so a
// presign request can enforce "does the requester own this key" by comparing the
// second segment. Any presign for a key that doesn't match this shape or belongs
// to a different user is refused.
const KEY_RE = /^resumes\/([^/]+)\/([^/]+)\/[^/]+$/;

export function parseResumeKey(key: string): { userId: string; resumeId: string } {
  const m = KEY_RE.exec(key);
  if (!m) throw new ForbiddenObjectAccessError(key, '');
  return { userId: m[1], resumeId: m[2] };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(
      `${name} is required (A-M5: MinIO defaults removed). See infra/docker/.env.example.`,
    );
  }
  return v;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly minio: MinioClient;

  constructor(
    @InjectPinoLogger(StorageService.name) private readonly logger: PinoLogger,
  ) {
    this.minio = new MinioClient({
      endPoint: process.env.MINIO_ENDPOINT ?? 'minio',
      port: Number(process.env.MINIO_PORT ?? 9000),
      useSSL: (process.env.MINIO_USE_SSL ?? 'false') === 'true',
      accessKey: requireEnv('MINIO_ACCESS_KEY'),
      secretKey: requireEnv('MINIO_SECRET_KEY'),
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      const exists = await this.minio.bucketExists(BUCKET);
      if (!exists) await this.minio.makeBucket(BUCKET);
      this.logger.info({ bucket: BUCKET }, 'storage ready');
    } catch (err) {
      // Non-fatal: uploads will error later with a clear message.
      this.logger.error({ err: (err as Error).message }, 'storage init failed');
    }
  }

  /**
   * Observability: ping used by HealthService to include MinIO in /health.
   * Does a cheap bucketExists call; returns false on any error so the
   * caller can downgrade status to `degraded` without crashing.
   */
  async ping(): Promise<boolean> {
    try {
      await this.minio.bucketExists(BUCKET);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Put an uploaded resume into MinIO. Key: `resumes/<userId>/<resumeId>/<yyyymmdd>_<filename>`.
   * Verifies magic bytes server-side (A-M5) — client-supplied mimetype is not trusted.
   * Throws {@link InvalidFileTypeError} on magic-byte mismatch; caller is responsible for
   * auditing the reject.
   */
  async putResume(
    userId: string,
    resumeId: string,
    filename: string,
    buffer: Buffer,
    mimetype: string,
  ): Promise<string> {
    const verified = verifyMagicBytes(buffer, mimetype, filename);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const safeName = filename.replace(/[^\w.\-]/g, '_');
    const key = `resumes/${userId}/${resumeId}/${stamp}_${safeName}`;
    // Store the verified content-type, not the client's claim.
    const storedMime = verified.kind === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    await this.minio.putObject(BUCKET, key, buffer, buffer.length, {
      'Content-Type': storedMime,
      'x-amz-meta-original-name': filename,
    });
    return key;
  }

  /**
   * Mint a short-lived presigned GET URL for a resume object. Enforces that the
   * requesting user owns the key namespace (A-M5): user A cannot presign user B's
   * object. Throws {@link ForbiddenObjectAccessError} on mismatch; caller audits.
   */
  async presignResumeDownload(requestingUserId: string, key: string): Promise<string> {
    const { userId: keyUserId } = parseResumeKey(key);
    if (keyUserId !== requestingUserId) {
      throw new ForbiddenObjectAccessError(key, requestingUserId);
    }
    return this.minio.presignedGetObject(BUCKET, key, PRESIGN_TTL_SECONDS);
  }
}
