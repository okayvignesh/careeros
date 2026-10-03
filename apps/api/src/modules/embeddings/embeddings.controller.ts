import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { EmbeddingConfigSchema, type EmbeddingConfigInput } from '@careeros/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SessionService } from '../auth/session.service';
import { EmbeddingsService, type TestResult } from './embeddings.service';
import { ResumeService } from '../resume/resume.service';

@Controller('embeddings')
export class EmbeddingsController {
  constructor(
    private readonly embeddings: EmbeddingsService,
    private readonly session: SessionService,
    private readonly resume: ResumeService,
  ) {}

  @Get()
  async get(@Req() req: Request) {
    this.session.requireUserId(req);
    return this.embeddings.getEffectiveConfig();
  }

  @Post()
  @HttpCode(201)
  async save(
    @Body(new ZodValidationPipe(EmbeddingConfigSchema)) body: EmbeddingConfigInput,
    @Req() req: Request,
  ) {
    this.session.requireUserId(req);
    await this.embeddings.saveConfig(body);
    return { ok: true };
  }

  @Post('test')
  @HttpCode(200)
  async test(@Req() req: Request): Promise<TestResult> {
    this.session.requireUserId(req);
    return this.embeddings.test();
  }

  @Post('reembed')
  @HttpCode(202)
  async reembed(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    const enqueued = await this.resume.enqueueEmbeddings(userId);
    return { enqueued };
  }
}
