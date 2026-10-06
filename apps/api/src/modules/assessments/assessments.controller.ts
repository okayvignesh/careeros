import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseFilePipeBuilder,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { AssessmentsService } from './assessments.service';
import { VERBAL_AUDIO_MAX_BYTES } from './verbal-audio.store';

@Controller('assessments')
export class AssessmentsController {
  constructor(
    private readonly assessments: AssessmentsService,
    private readonly session: SessionService,
  ) {}

  @Get('knowledge/next')
  async next(@Query('skillId') skillId: string | undefined, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.assessments.nextKnowledgeQuestion(userId, skillId || undefined);
  }

  @Post('knowledge/generate')
  @HttpCode(201)
  async generate(
    @Body() body: { skillId: string; difficulty?: 'easy' | 'medium' | 'hard' },
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    if (typeof body.skillId !== 'string' || !body.skillId) {
      throw new BadRequestException('skillId is required');
    }
    const difficulty = body.difficulty ?? 'medium';
    if (!['easy', 'medium', 'hard'].includes(difficulty)) {
      throw new BadRequestException('difficulty must be easy | medium | hard');
    }
    const question = await this.assessments.generateKnowledgeQuestion(
      userId,
      body.skillId,
      difficulty,
    );
    if (!question) {
      throw new BadRequestException(
        'Could not generate a question. Configure an AI provider, ensure LLM calls are not paused, and try again.',
      );
    }
    return question;
  }

  @Post('knowledge/grade')
  @HttpCode(200)
  async grade(
    @Body() body: { questionId: string; answer: string; durationMs?: number },
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    if (typeof body.questionId !== 'string' || !body.questionId) {
      throw new BadRequestException('questionId is required');
    }
    const input: { questionId: string; answer: string; durationMs?: number } = {
      questionId: body.questionId,
      answer: body.answer,
    };
    if (typeof body.durationMs === 'number') input.durationMs = body.durationMs;
    return this.assessments.gradeKnowledgeAttempt(userId, input);
  }

  @Get('code-review/next')
  async nextCodeReview(@Query('skillId') skillId: string | undefined, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.assessments.nextCodeReviewTask(userId, skillId || undefined);
  }

  @Post('code-review/generate')
  @HttpCode(201)
  async generateCodeReview(
    @Body() body: { skillId: string; difficulty?: 'easy' | 'medium' | 'hard' },
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    if (typeof body.skillId !== 'string' || !body.skillId) {
      throw new BadRequestException('skillId is required');
    }
    const difficulty = body.difficulty ?? 'medium';
    if (!['easy', 'medium', 'hard'].includes(difficulty)) {
      throw new BadRequestException('difficulty must be easy | medium | hard');
    }
    const task = await this.assessments.generateCodeReviewTask(userId, body.skillId, difficulty);
    if (!task) {
      throw new BadRequestException(
        'Could not generate a code-review task. Configure an AI provider, ensure LLM calls are not paused, and try again.',
      );
    }
    return task;
  }

  @Post('code-review/grade')
  @HttpCode(200)
  async gradeCodeReview(
    @Body() body: { questionId: string; findings: string[]; durationMs?: number },
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    if (typeof body.questionId !== 'string' || !body.questionId) {
      throw new BadRequestException('questionId is required');
    }
    if (!Array.isArray(body.findings)) {
      throw new BadRequestException('findings must be an array of strings');
    }
    const input: { questionId: string; findings: string[]; durationMs?: number } = {
      questionId: body.questionId,
      findings: body.findings,
    };
    if (typeof body.durationMs === 'number') input.durationMs = body.durationMs;
    return this.assessments.gradeCodeReviewAttempt(userId, input);
  }

  @Get('system-design/next')
  async nextSystemDesign(@Query('skillId') skillId: string | undefined, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.assessments.nextSystemDesignTask(userId, skillId || undefined);
  }

  @Post('system-design/generate')
  @HttpCode(201)
  async generateSystemDesign(
    @Body() body: { skillId: string; difficulty?: 'easy' | 'medium' | 'hard' },
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    if (typeof body.skillId !== 'string' || !body.skillId) {
      throw new BadRequestException('skillId is required');
    }
    const difficulty = body.difficulty ?? 'medium';
    if (!['easy', 'medium', 'hard'].includes(difficulty)) {
      throw new BadRequestException('difficulty must be easy | medium | hard');
    }
    const task = await this.assessments.generateSystemDesignTask(userId, body.skillId, difficulty);
    if (!task) {
      throw new BadRequestException(
        'Could not generate a system-design task. Configure an AI provider, ensure LLM calls are not paused, and try again.',
      );
    }
    return task;
  }

  @Post('system-design/grade')
  @HttpCode(200)
  async gradeSystemDesign(
    @Body() body: { questionId: string; design: string; durationMs?: number },
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    if (typeof body.questionId !== 'string' || !body.questionId) {
      throw new BadRequestException('questionId is required');
    }
    if (typeof body.design !== 'string') {
      throw new BadRequestException('design must be a string');
    }
    const input: { questionId: string; design: string; durationMs?: number } = {
      questionId: body.questionId,
      design: body.design,
    };
    if (typeof body.durationMs === 'number') input.durationMs = body.durationMs;
    return this.assessments.gradeSystemDesignAttempt(userId, input);
  }

  @Get('debugging/next')
  async nextDebugging(@Query('skillId') skillId: string | undefined, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.assessments.nextDebuggingTask(userId, skillId || undefined);
  }

  @Post('debugging/generate')
  @HttpCode(201)
  async generateDebugging(
    @Body() body: { skillId: string; difficulty?: 'easy' | 'medium' | 'hard' },
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    if (typeof body.skillId !== 'string' || !body.skillId) {
      throw new BadRequestException('skillId is required');
    }
    const difficulty = body.difficulty ?? 'medium';
    if (!['easy', 'medium', 'hard'].includes(difficulty)) {
      throw new BadRequestException('difficulty must be easy | medium | hard');
    }
    const task = await this.assessments.generateDebuggingTask(userId, body.skillId, difficulty);
    if (!task) {
      throw new BadRequestException(
        'Could not generate a debugging task. Configure an AI provider, ensure LLM calls are not paused, and try again.',
      );
    }
    return task;
  }

  @Post('debugging/grade')
  @HttpCode(200)
  async gradeDebugging(
    @Body() body: { questionId: string; fix: string; durationMs?: number },
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    if (typeof body.questionId !== 'string' || !body.questionId) {
      throw new BadRequestException('questionId is required');
    }
    if (typeof body.fix !== 'string') {
      throw new BadRequestException('fix must be a string');
    }
    const input: { questionId: string; fix: string; durationMs?: number } = {
      questionId: body.questionId,
      fix: body.fix,
    };
    if (typeof body.durationMs === 'number') input.durationMs = body.durationMs;
    return this.assessments.gradeDebuggingAttempt(userId, input);
  }

  @Get('build/next')
  async nextBuild(@Query('skillId') skillId: string | undefined, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.assessments.nextBuildTask(userId, skillId || undefined);
  }

  @Post('build/generate')
  @HttpCode(201)
  async generateBuild(
    @Body() body: { skillId: string; difficulty?: 'easy' | 'medium' | 'hard' },
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    if (typeof body.skillId !== 'string' || !body.skillId) {
      throw new BadRequestException('skillId is required');
    }
    const difficulty = body.difficulty ?? 'medium';
    if (!['easy', 'medium', 'hard'].includes(difficulty)) {
      throw new BadRequestException('difficulty must be easy | medium | hard');
    }
    const task = await this.assessments.generateBuildTask(userId, body.skillId, difficulty);
    if (!task) {
      throw new BadRequestException(
        'Could not generate a build task. Configure an AI provider, ensure LLM calls are not paused, and try again.',
      );
    }
    return task;
  }

  @Post('build/grade')
  @HttpCode(200)
  async gradeBuild(
    @Body() body: { questionId: string; code: string; durationMs?: number },
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    if (typeof body.questionId !== 'string' || !body.questionId) {
      throw new BadRequestException('questionId is required');
    }
    if (typeof body.code !== 'string') {
      throw new BadRequestException('code must be a string');
    }
    const input: { questionId: string; code: string; durationMs?: number } = {
      questionId: body.questionId,
      code: body.code,
    };
    if (typeof body.durationMs === 'number') input.durationMs = body.durationMs;
    return this.assessments.gradeBuildAttempt(userId, input);
  }

  @Get('mock-interview/next')
  async nextMockInterview(@Query('skillId') skillId: string | undefined, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.assessments.nextMockInterview(userId, skillId || undefined);
  }

  @Post('mock-interview/generate')
  @HttpCode(201)
  async generateMockInterview(
    @Body() body: { skillId: string; difficulty?: 'easy' | 'medium' | 'hard' },
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    if (typeof body.skillId !== 'string' || !body.skillId) {
      throw new BadRequestException('skillId is required');
    }
    const difficulty = body.difficulty ?? 'medium';
    if (!['easy', 'medium', 'hard'].includes(difficulty)) {
      throw new BadRequestException('difficulty must be easy | medium | hard');
    }
    const task = await this.assessments.generateMockInterview(userId, body.skillId, difficulty);
    if (!task) {
      throw new BadRequestException(
        'Could not generate a mock interview. Configure an AI provider, ensure LLM calls are not paused, and try again.',
      );
    }
    return task;
  }

  @Post('mock-interview/grade')
  @HttpCode(200)
  async gradeMockInterview(
    @Body() body: { questionId: string; answers: string[]; durationMs?: number },
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    if (typeof body.questionId !== 'string' || !body.questionId) {
      throw new BadRequestException('questionId is required');
    }
    if (!Array.isArray(body.answers)) {
      throw new BadRequestException('answers must be an array of strings');
    }
    const input: { questionId: string; answers: string[]; durationMs?: number } = {
      questionId: body.questionId,
      answers: body.answers,
    };
    if (typeof body.durationMs === 'number') input.durationMs = body.durationMs;
    return this.assessments.gradeMockInterviewAttempt(userId, input);
  }

  @Get('boss/eligible')
  async eligibleBoss(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.assessments.getEligibleBossMilestone(userId);
  }

  @Post('boss/start')
  @HttpCode(201)
  async startBoss(@Body() body: { milestone: number }, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    if (typeof body.milestone !== 'number' || !Number.isInteger(body.milestone)) {
      throw new BadRequestException('milestone must be an integer');
    }
    return this.assessments.startBossBattle(userId, body.milestone);
  }

  @Get('boss/:id')
  async getBoss(@Param('id') id: string, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.assessments.getBossBattle(userId, id);
  }

  @Post('boss/:id/submit')
  @HttpCode(200)
  async submitBoss(
    @Param('id') id: string,
    @Body() body: { answers: string[] },
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    if (!Array.isArray(body.answers)) {
      throw new BadRequestException('answers must be an array of strings');
    }
    return this.assessments.submitBossBattle(userId, id, body.answers);
  }

  @Get('progression')
  async progression(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.assessments.getProgression(userId);
  }

  @Get('progression/timeseries')
  async timeseries(@Query('days') days: string | undefined, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    const parsed = Number(days ?? 30);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BadRequestException('days must be a positive number');
    }
    return this.assessments.getXpTimeseries(userId, parsed);
  }

  @Get('remediation')
  async remediation(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.assessments.listRemediation(userId);
  }

  @Post('remediation/:id/complete')
  @HttpCode(200)
  async completeRemediation(@Param('id') id: string, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    await this.assessments.completeRemediation(userId, id);
    return { ok: true };
  }

  @Get('attempts/:id')
  async getAttempt(@Param('id') id: string, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    const attempt = await this.assessments.getAttempt(userId, id);
    if (!attempt) throw new BadRequestException('Attempt not found');
    return attempt;
  }

  // --- verbal defense (P2 C-P2.5) -------------------------------------------

  @Get('verbal/next')
  async nextVerbal(@Query('skillId') skillId: string | undefined, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.assessments.nextVerbalPrompt(userId, skillId || undefined);
  }

  @Post('verbal/sessions')
  @HttpCode(201)
  async startVerbalSession(
    @Body()
    body: {
      questionId?: string;
      prompt?: string;
      keyPoints?: string[];
      skillIds?: string[];
      difficulty?: 'easy' | 'medium' | 'hard';
      skillId?: string;
    },
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    return this.assessments.startVerbalSession(userId, body ?? {});
  }

  @Get('verbal/sessions')
  async listVerbalSessions(@Query('take') take: string | undefined, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    const parsed = take ? Number(take) : 20;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BadRequestException('take must be a positive number');
    }
    return this.assessments.listVerbalSessions(userId, parsed);
  }

  @Get('verbal/sessions/:id')
  async getVerbalSession(@Param('id') id: string, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.assessments.getVerbalSession(userId, id);
  }

  @Post('verbal/sessions/:id/audio')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: VERBAL_AUDIO_MAX_BYTES } }))
  async uploadVerbalAudio(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /audio\// })
        .addMaxSizeValidator({ maxSize: VERBAL_AUDIO_MAX_BYTES })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    return this.assessments.attachVerbalAudio(userId, id, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      size: file.size,
    });
  }

  @Post('verbal/sessions/:id/grade')
  @HttpCode(200)
  async gradeVerbalSession(
    @Param('id') id: string,
    @Body() body: { transcript?: string; durationMs?: number },
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    const opts: { transcript?: string; durationMs?: number } = {};
    if (typeof body?.transcript === 'string') opts.transcript = body.transcript;
    if (typeof body?.durationMs === 'number') opts.durationMs = body.durationMs;
    return this.assessments.gradeVerbalSession(userId, id, opts);
  }
}
