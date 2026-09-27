import { Module } from '@nestjs/common';
import { FactsController } from './facts.controller';
import { FactsService } from './facts.service';

@Module({
  controllers: [FactsController],
  providers: [FactsService],
})
export class FactsModule {}
