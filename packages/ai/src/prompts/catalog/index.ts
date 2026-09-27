// C-P0.2: barrel for the versioned prompt catalog (parallel to the runtime
// PromptDef registry in ../registry.ts). Every catalog entry is registered
// into a default PromptRegistry on module load so audit + resolve(id, version)
// works without an explicit bootstrap call.
import { PromptRegistry } from './registry';
import { resumeFactCheck } from './resume-fact-check';
import { coverLetterGeneration } from './cover-letter-generation';
import { skillExtract } from './skill-extract';
import { marketBriefSynthesis } from './market-brief-synthesis';
import { assessmentGraderKnowledge } from './assessment-grader-knowledge';
import { assessmentGraderCodeReview } from './assessment-grader-code-review';

export { PromptRegistry, type Prompt, type PromptInfo } from './registry';
export {
  setPromptUseHook,
  logPromptUse,
  type PromptUseHook,
  type PromptUseEvent,
  type LogPromptUseInput,
} from './hash-log';

export { resumeFactCheck } from './resume-fact-check';
export { coverLetterGeneration } from './cover-letter-generation';
export { skillExtract } from './skill-extract';
export { marketBriefSynthesis } from './market-brief-synthesis';
export { assessmentGraderKnowledge } from './assessment-grader-knowledge';
export { assessmentGraderCodeReview } from './assessment-grader-code-review';

/**
 * Default catalog registry. Composition-root style: the six ticket-scoped
 * prompts land here at import time so consumers don't need a bootstrap call.
 * Tests that need an isolated registry construct their own PromptRegistry.
 */
export const promptCatalog = new PromptRegistry();
promptCatalog.register(resumeFactCheck);
promptCatalog.register(coverLetterGeneration);
promptCatalog.register(skillExtract);
promptCatalog.register(marketBriefSynthesis);
promptCatalog.register(assessmentGraderKnowledge);
promptCatalog.register(assessmentGraderCodeReview);
