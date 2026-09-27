import { WizardStep } from '@/components/WizardStep';
import { AccountForm } from '@/components/forms/AccountForm';

export default function Account() {
  return (
    <WizardStep
      slug="02-account"
      description="Create the first administrator account. This user becomes your Career OS owner."
      ownContinue
    >
      <AccountForm />
    </WizardStep>
  );
}
