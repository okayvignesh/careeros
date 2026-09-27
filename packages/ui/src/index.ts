export { Button } from './primitives/Button';
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './primitives/Card';
export { Input } from './primitives/Input';
export { Glass } from './primitives/Glass';
export { Eyebrow } from './primitives/Eyebrow';
export { SectionHeader } from './primitives/SectionHeader';
export { Stat } from './primitives/Stat';
export { SetupProgressBar, type ProgressStep } from './primitives/SetupProgressBar';
export { PageReveal } from './primitives/PageReveal';
export {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
  Tip,
} from './primitives/Tooltip';
export { StepShell } from './layout/StepShell';
export { AppBackground } from './layout/AppBackground';
// CodeEditor lazily loads @monaco-editor/react (~2MB). Do NOT re-export from
// the barrel or every page that imports from @careeros/ui pulls in Monaco.
// Consumers wanting the editor: import { CodeEditor } from '@careeros/ui/CodeEditor';
export type { CodeEditorProps, CodeEditorLanguage, CodeEditorTheme } from './CodeEditor';
export { detectLanguage, type SupportedLanguage } from './detectLanguage';
export { useDrafts, type UseDraftsResult } from './useDrafts';
export { cn } from './utils';
export {
  dur,
  ease,
  spring,
  tMicro,
  tFast,
  tStandard,
  tDeliberate,
  fadeUp,
  staggerList,
  listItem,
  dialog,
  popover,
} from './motion';
