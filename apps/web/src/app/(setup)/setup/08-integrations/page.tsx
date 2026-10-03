import { WizardStep } from '@/components/WizardStep';
import { IntegrationsList } from '@/components/forms/IntegrationsList';

export default function Integrations() {
  return (
    <WizardStep
      slug="08-integrations"
      description="Optional integrations you can add or revoke any time from Settings. GitHub and GitLab (public or self-hosted) are available today; Slack and Gmail land in P5."
      ownContinue
    >
      <IntegrationsList />
    </WizardStep>
  );
}
