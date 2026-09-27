import { WizardStep } from '@/components/WizardStep';
import { GithubForm } from '@/components/forms/GithubForm';

export default function GithubPage() {
  return (
    <WizardStep
      slug="07-github"
      description="Connect a GitHub account so Career OS can analyse your repositories. A fine-grained PAT with read-only repo scope is enough."
      ownContinue
    >
      <GithubForm />
    </WizardStep>
  );
}
