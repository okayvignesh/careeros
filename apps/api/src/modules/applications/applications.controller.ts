import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { ApplicationsService } from './applications.service';

@Controller('me/applications')
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly session: SessionService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.applications.listForUser(userId);
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.applications.getById(userId, id);
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: { jobId: string }, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    if (typeof body.jobId !== 'string' || !body.jobId) {
      throw new BadRequestException('jobId is required');
    }
    return this.applications.create(userId, body.jobId);
  }

  @Patch(':id/transition')
  @HttpCode(200)
  async transition(
    @Param('id') id: string,
    @Body() body: { toState: string; notes?: string },
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    if (typeof body.toState !== 'string' || !body.toState) {
      throw new BadRequestException('toState is required');
    }
    return this.applications.transition(userId, id, body.toState, body.notes);
  }

  @Patch(':id/attach')
  @HttpCode(200)
  async attach(
    @Param('id') id: string,
    @Body()
    body: {
      resumeVariantId?: string | null;
      coverLetterId?: string | null;
      notes?: string | null;
    },
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    return this.applications.attach(userId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    await this.applications.remove(userId, id);
  }
}
