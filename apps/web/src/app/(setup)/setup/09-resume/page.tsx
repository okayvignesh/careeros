import { WizardStep } from '@/components/WizardStep';
import { ResumeParse } from '@/components/forms/ResumeParse';

export default function Resume() {
  return (
    <WizardStep
      slug="09-resume"
      description="Upload your resume (PDF or DOCX). Career OS parses the file, extracts structured facts using your configured AI provider, and lets you review each fact before it becomes evidence."
      ownContinue
    >
      <ResumeParse />
    </WizardStep>
  );
}
