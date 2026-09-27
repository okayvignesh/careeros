import { WizardStep } from '@/components/WizardStep';
import { FactReview } from '@/components/forms/FactReview';

export default function FactReviewPage() {
  return (
    <WizardStep
      slug="10-fact-review"
      description="Toggle each fact off if the model got it wrong. Only accepted facts become evidence in your graph. Nothing is trusted until you say so."
      ownContinue
    >
      <FactReview />
    </WizardStep>
  );
}
