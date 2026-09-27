import { WizardStep } from '@/components/WizardStep';
import { ProviderForm } from '@/components/forms/ProviderForm';

export default function Provider() {
  return (
    <WizardStep
      slug="03-provider"
      description="Configure your primary AI provider. DeepSeek is the default; any OpenAI-compatible endpoint works."
      ownContinue
    >
      <ProviderForm />
    </WizardStep>
  );
}
