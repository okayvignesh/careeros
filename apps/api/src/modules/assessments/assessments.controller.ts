import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { AssessmentsService } from './assessments.service';

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
    const question = await this.assessments.generateKnowledgeQuestion(userId, body.skillId, difficulty);
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
}
