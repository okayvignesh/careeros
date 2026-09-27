import { WizardStep } from '@/components/WizardStep';
import { RecoveryKey } from '@/components/forms/RecoveryKey';

export default function RecoveryPage() {
  return (
    <WizardStep
      slug="13-recovery"
      description="Save your recovery key before continuing. If you lose the master ENCRYPTION_KEY, this is your only way back to your encrypted secrets."
      ownContinue
    >
      <RecoveryKey />
    </WizardStep>
  );
}
