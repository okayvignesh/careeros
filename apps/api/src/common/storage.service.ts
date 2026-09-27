import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Client as MinioClient } from 'minio';

const BUCKET = process.env.MINIO_BUCKET ?? 'careeros';

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
      accessKey: process.env.MINIO_ACCESS_KEY ?? 'careeros',
      secretKey: process.env.MINIO_SECRET_KEY ?? 'careerosminio',
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
   * Put an uploaded resume into MinIO. Key: `resumes/<userId>/<yyyymmdd>_<filename>`.
   * Fire-and-forget from the caller: never blocks the parse response.
   */
  async putResume(userId: string, filename: string, buffer: Buffer, mimetype: string): Promise<string> {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const safeName = filename.replace(/[^\w.\-]/g, '_');
    const key = `resumes/${userId}/${stamp}_${safeName}`;
    await this.minio.putObject(BUCKET, key, buffer, buffer.length, {
      'Content-Type': mimetype,
      'x-amz-meta-original-name': filename,
    });
    return key;
  }
}
