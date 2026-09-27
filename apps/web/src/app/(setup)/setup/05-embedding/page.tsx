import { WizardStep } from '@/components/WizardStep';
import { EmbeddingForm } from '@/components/forms/EmbeddingForm';

export default function Embedding() {
  return (
    <WizardStep
      slug="05-embedding"
      description="Where should text be embedded for search? Local keeps everything on this host; external uses an OpenAI-compatible provider."
      ownContinue
    >
      <EmbeddingForm />
    </WizardStep>
  );
}
