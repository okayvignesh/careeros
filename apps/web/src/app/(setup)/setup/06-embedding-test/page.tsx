import { WizardStep } from '@/components/WizardStep';
import { EmbeddingTest } from '@/components/forms/EmbeddingTest';

export default function EmbeddingTestPage() {
  return (
    <WizardStep
      slug="06-embedding-test"
      description="Round-trip a sample vector through Qdrant to confirm the vector store is reachable and writable."
      ownContinue
    >
      <EmbeddingTest />
    </WizardStep>
  );
}
