import { Module } from '@nestjs/common';
import { RepositoryAnalysisController } from './repository-analysis.controller';
import { RepositoryAnalysisService } from './repository-analysis.service';

@Module({
  controllers: [RepositoryAnalysisController],
  providers: [RepositoryAnalysisService],
})
export class RepositoryAnalysisModule {}
