import { WizardStep } from '@/components/WizardStep';
import { IntegrationsList } from '@/components/forms/IntegrationsList';

export default function Integrations() {
  return (
    <WizardStep
      slug="08-integrations"
      description="Optional integrations you can add or revoke any time from Settings. GitHub, GitLab (public or self-hosted), Slack, and Gmail are all available today."
      ownContinue
    >
      <IntegrationsList />
    </WizardStep>
  );
}
