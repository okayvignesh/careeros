// Prompt registry entry point. Side-effect: importing this file registers every prompt.
// Every new prompt file must be imported here so the startup check sees it.
import './resume-extract';
import './knowledge-grader';
import './question-generator';
import './code-review-generator';
import './code-review-grader';
import './system-design-generator';
import './system-design-grader';
import './debugging-task-generator';
import './debugging-task-grader';
import './mock-interview-generator';
import './mock-interview-grader';
import './keypoints-extractor';
import './job-skill-extract';
import './market-brief-writer';
import './tailored-resume-writer';
import './resume-bullet-fact-check';
import './cover-letter-writer';

export { allPrompts, getPrompt, promptHash, renderPrompt } from './registry';
export type { PromptDef, RenderedPrompt, PromptExample } from './types';
