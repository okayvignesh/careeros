import { WizardStep } from '@/components/WizardStep';
import { HealthMatrix } from '@/components/forms/HealthMatrix';

export default function HealthPage() {
  return (
    <WizardStep
      slug="12-health"
      description="Every service Career OS depends on. All rows must be green before setup can complete."
      ownContinue
    >
      <HealthMatrix />
    </WizardStep>
  );
}
