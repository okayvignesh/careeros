import { Module } from '@nestjs/common';
import { ResumeVariantsController } from './resume-variants.controller';
import { ResumeVariantsService } from './resume-variants.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ResumeVariantsController],
  providers: [ResumeVariantsService],
})
export class ResumeVariantsModule {}
