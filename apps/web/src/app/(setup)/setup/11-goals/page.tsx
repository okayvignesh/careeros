import { WizardStep } from '@/components/WizardStep';
import { GoalsForm } from '@/components/forms/GoalsForm';

export default function Goals() {
  return (
    <WizardStep
      slug="11-goals"
      description="Target roles, locations, and compensation. Used by the market engine and job matcher. You can edit these any time from Settings."
      ownContinue
    >
      <GoalsForm />
    </WizardStep>
  );
}
