import { Module, type OnModuleInit } from '@nestjs/common';
import { agentRegistry } from '@careeros/ai';
import { AssessmentsController } from './assessments.controller';
import { AssessmentsService } from './assessments.service';
import { AuthModule } from '../auth/auth.module';
import { registerKnowledgeGraderAgent } from './agents/knowledge-grader.agent';
import { registerCodeReviewGraderAgent } from './agents/code-review-grader.agent';
import { registerDebuggingGraderAgent } from './agents/debugging-grader.agent';
import { registerMockInterviewGraderAgent } from './agents/mock-interview-grader.agent';
import { registerSystemDesignGraderAgent } from './agents/system-design-grader.agent';

// UsageModule, UsageCache, and SensitivityGateModule are @Global(), so no
// import is needed here for those providers.

@Module({
  imports: [AuthModule],
  controllers: [AssessmentsController],
  providers: [AssessmentsService],
  exports: [AssessmentsService],
})
export class AssessmentsModule implements OnModuleInit {
  // C-P2.8c + follow-on: register every assessment grader agent into the
  // shared AgentRegistry at Nest boot. Idempotent — a second module-init
  // (test harness re-import) is a no-op because AgentRegistry.register
  // short-circuits on identical shape.
  onModuleInit(): void {
    registerKnowledgeGraderAgent(agentRegistry);
    registerCodeReviewGraderAgent(agentRegistry);
    registerDebuggingGraderAgent(agentRegistry);
    registerMockInterviewGraderAgent(agentRegistry);
    registerSystemDesignGraderAgent(agentRegistry);
  }
}
