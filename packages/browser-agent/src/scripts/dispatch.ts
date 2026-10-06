/**
 * F.3 script dispatcher.
 *
 * Maps an AgentTaskKind to its form-fill script. The agent task-runner
 * (D.4) imports this to pick the right script after validating the task
 * envelope + looking up the allowlist entry for the task's target domain.
 */

import type { AllowlistEntry } from '../allowlist/loader';
import type { AgentTaskKind } from '../types';
import { runAshbyApply } from './ashby-apply';
import { runGenericApply } from './generic-apply';
import { runGreenhouseApply } from './greenhouse-apply';
import { runIndeedEasyApply } from './indeed-easy-apply';
import { runLeverApply } from './lever-apply';
import { runLinkedinEasyApply } from './linkedin-easy-apply';
import { runNaukriApply } from './naukri-apply';
import { runWorkdayApply } from './workday-apply';
import type { FormFillMode, FormFillPage, FormFillPayload, FormFillResult } from './form-fill';

export type FormFillScript = (
  page: FormFillPage,
  entry: AllowlistEntry,
  payload: FormFillPayload,
  mode: FormFillMode,
  opts?: { screenshotPath?: string },
) => Promise<FormFillResult>;

const SCRIPT_MAP: Partial<Record<AgentTaskKind, FormFillScript>> = {
  'ashby-apply': runAshbyApply,
  'greenhouse-apply': runGreenhouseApply,
  'lever-apply': runLeverApply,
  'workday-apply': runWorkdayApply,
  'linkedin-easy-apply': runLinkedinEasyApply,
  'indeed-easy-apply': runIndeedEasyApply,
  'naukri-apply': runNaukriApply,
  'generic-apply': runGenericApply,
};

export function pickFormFillScript(kind: AgentTaskKind): FormFillScript | undefined {
  return SCRIPT_MAP[kind];
}
