import { Module } from '@nestjs/common';
import { WorkersController } from './workers.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [WorkersController],
})
export class WorkersModule {}
