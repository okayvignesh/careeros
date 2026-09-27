import { WizardStep } from '@/components/WizardStep';
import { CapabilityProbe } from '@/components/forms/CapabilityProbe';

export default function Capability() {
  return (
    <WizardStep
      slug="04-capability"
      description="Running 4 real calls against your configured provider: chat, structured output, function tools, streaming."
      ownContinue
    >
      <CapabilityProbe />
    </WizardStep>
  );
}
