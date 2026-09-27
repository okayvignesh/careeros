import { BadRequestException, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { QUEUE_EMBEDDING, QUEUE_GITHUB } from '@careeros/shared';
import { QueueService } from '../../common/queue.service';
import { SessionService } from '../auth/session.service';

const KNOWN_QUEUES = new Set<string>([QUEUE_GITHUB, QUEUE_EMBEDDING]);

function assertQueueName(name: string): void {
  if (!KNOWN_QUEUES.has(name)) {
    throw new BadRequestException(`Unknown queue: ${name}. Known: ${[...KNOWN_QUEUES].join(', ')}`);
  }
}

@Controller('system/workers')
export class WorkersController {
  constructor(
    private readonly queue: QueueService,
    private readonly session: SessionService,
  ) {}

  @Get()
  async stats(@Req() req: Request) {
    this.session.requireUserId(req);
    return this.queue.stats();
  }

  @Get(':name/failed')
  async failed(
    @Param('name') name: string,
    @Query('limit') limit: string | undefined,
    @Req() req: Request,
  ) {
    this.session.requireUserId(req);
    assertQueueName(name);
    const parsed = Number(limit ?? 20);
    return this.queue.listFailed(name, Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 20);
  }

  @Post(':name/retry')
  @HttpCode(202)
  async retry(@Param('name') name: string, @Req() req: Request) {
    this.session.requireUserId(req);
    assertQueueName(name);
    const retried = await this.queue.retryAllFailed(name);
    return { retried };
  }

  @Post(':name/pause')
  @HttpCode(200)
  async pause(@Param('name') name: string, @Req() req: Request) {
    this.session.requireUserId(req);
    assertQueueName(name);
    await this.queue.setPaused(name, true);
    return { paused: true };
  }

  @Post(':name/resume')
  @HttpCode(200)
  async resume(@Param('name') name: string, @Req() req: Request) {
    this.session.requireUserId(req);
    assertQueueName(name);
    await this.queue.setPaused(name, false);
    return { paused: false };
  }
}
