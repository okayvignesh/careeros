// MinIO-backed storage for verbal-defense recordings.
//
// The shared `StorageService` only knows about resume + export key shapes, so
// the verbal feature owns its own narrowly-scoped store rather than widening
// that common service. Keys are scoped `verbal/{userId}/{sessionId}/{stamp}.{ext}`
// so a presign request can enforce "the requester owns this key" by comparing
// the second segment. The MinIO client is built lazily so merely constructing
// the assessments service does not require MinIO env in tests.
import { Client as MinioClient } from 'minio';

const BUCKET = process.env.MINIO_BUCKET ?? 'careeros';
const PRESIGN_TTL_SECONDS = 300;

/** Browser MediaRecorder + whisper.cpp `--convert` (ffmpeg) accepted types. */
const MIME_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
};

export const VERBAL_AUDIO_MAX_BYTES = 25 * 1024 * 1024;

export class UnsupportedAudioTypeError extends Error {
  constructor(public readonly mime: string) {
    super(`Unsupported audio type: ${mime || '(empty)'}`);
    this.name = 'UnsupportedAudioTypeError';
  }
}

export function audioExtension(mime: string): string {
  const ext = MIME_EXT[mime.toLowerCase().split(';')[0]!.trim()];
  if (!ext) throw new UnsupportedAudioTypeError(mime);
  return ext;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(
      `${name} is required for verbal audio storage (see infra/docker/.env.example).`,
    );
  }
  return v;
}

export class VerbalAudioStore {
  private client: MinioClient | undefined;

  private getClient(): MinioClient {
    if (!this.client) {
      this.client = new MinioClient({
        endPoint: process.env.MINIO_ENDPOINT ?? 'minio',
        port: Number(process.env.MINIO_PORT ?? 9000),
        useSSL: (process.env.MINIO_USE_SSL ?? 'false') === 'true',
        accessKey: requireEnv('MINIO_ACCESS_KEY'),
        secretKey: requireEnv('MINIO_SECRET_KEY'),
      });
    }
    return this.client;
  }

  async put(userId: string, sessionId: string, buffer: Buffer, mime: string): Promise<string> {
    const ext = audioExtension(mime);
    const stamp = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, '')
      .slice(0, 14);
    const key = `verbal/${userId}/${sessionId}/${stamp}.${ext}`;
    await this.getClient().putObject(BUCKET, key, buffer, buffer.length, {
      'Content-Type': mime,
      'x-amz-meta-user-id': userId,
    });
    return key;
  }

  async presign(requestingUserId: string, key: string): Promise<string> {
    if (!key.startsWith(`verbal/${requestingUserId}/`)) {
      throw new Error('Forbidden audio object access');
    }
    return this.getClient().presignedGetObject(BUCKET, key, PRESIGN_TTL_SECONDS);
  }

  async remove(key: string): Promise<void> {
    await this.getClient().removeObject(BUCKET, key);
  }
}
