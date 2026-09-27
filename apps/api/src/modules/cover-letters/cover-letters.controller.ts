import { Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SessionService } from '../auth/session.service';
import { CoverLettersService } from './cover-letters.service';

@Controller('me/cover-letters')
export class CoverLettersController {
  constructor(
    private readonly letters: CoverLettersService,
    private readonly session: SessionService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.letters.listForUser(userId);
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.letters.getById(userId, id);
  }

  @Post('for-job/:jobId')
  @HttpCode(201)
  async generateForJob(@Param('jobId') jobId: string, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.letters.generateForJob(userId, jobId);
  }

  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const userId = this.session.requireUserId(req);
    const { buffer, filename } = await this.letters.renderPdf(userId, id);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
