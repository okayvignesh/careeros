/**
 * Template registry. Adding a template = one entry here + a matching key
 * in `TemplateId` in `../types.ts`. `renderResumeDocx` / `renderResumePdfByTemplate`
 * dispatch on `templates[id]`.
 */
import { classic } from './classic';
import { denseTech } from './dense-tech';
import { modernMinimal } from './modern-minimal';
import { international } from './international';
import type { Template, TemplateId } from '../types';

export const templates: Record<TemplateId, Template> = {
  classic,
  'dense-tech': denseTech,
  'modern-minimal': modernMinimal,
  international,
};

export const templateList: Template[] = [classic, denseTech, modernMinimal, international];
