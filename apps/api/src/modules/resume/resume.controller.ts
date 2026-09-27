import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  ParseFilePipeBuilder,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Request } from 'express';
import {
  ResumeConfirmSchema,
  type ResumeConfirmInput,
  type ExtractedFacts,
} from '@careeros/shared';
import { randomUUID } from 'node:crypto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SessionService } from '../auth/session.service';
import { SetupService } from '../setup/setup.service';
import { ResumeService } from './resume.service';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

@Controller('resume')
export class ResumeController {
  constructor(
    private readonly resume: ResumeService,
    private readonly session: SessionService,
    private readonly setup: SetupService,
    @InjectPinoLogger(ResumeController.name) private readonly logger: PinoLogger,
  ) {}

  @Post('parse')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async parse(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /(pdf|officedocument\.wordprocessingml\.document)$/ })
        .addMaxSizeValidator({ maxSize: MAX_BYTES })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ): Promise<ExtractedFacts> {
    const userId = this.session.requireUserId(req);
    const text = await this.resume.extractText(file);
    if (text.trim().length < 50) {
      throw new BadRequestException('Resume text too short. The file may be scanned or empty.');
    }
    const facts = await this.resume.parse(userId, text);
    await this.setup.advance(userId, 'resume_uploaded');
    // A-M5: archive is fire-and-forget; magic-byte gate inside archiveUpload rejects
    // (audit + throw) before storage.putResume is ever called. Object key scopes to
    // resumes/{userId}/{resumeId}/... so downloads can be presigned per-user.
    const resumeId = randomUUID();
    void this.resume
      .archiveUpload(userId, resumeId, file)
      .then((key) => this.logger.info({ userId, key, bytes: file.size }, 'resume archived'))
      .catch((err) =>
        this.logger.warn(
          { err: (err as Error).message, userId, filename: file.originalname, bytes: file.size },
          'resume archive failed',
        ),
      );
    return facts;
  }

  @Post('confirm')
  @HttpCode(200)
  async confirm(
    @Body(new ZodValidationPipe(ResumeConfirmSchema)) body: ResumeConfirmInput,
    @Req() req: Request,
  ): Promise<{ inserted: number }> {
    const userId = this.session.requireUserId(req);
    return this.resume.commit(userId, body.facts);
  }
}
