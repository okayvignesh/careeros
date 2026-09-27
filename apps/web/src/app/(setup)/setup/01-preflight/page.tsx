import { CheckCircle2 } from 'lucide-react';
import { WizardStep } from '@/components/WizardStep';

const checks = [
  { name: 'Browser cookies', hint: 'Required for signed session' },
  { name: 'JavaScript', hint: 'Required for wizard interactivity' },
  { name: 'WebSocket support', hint: 'Required for streaming updates' },
  { name: 'Modern browser', hint: 'Chrome, Firefox, Safari, Edge (last 2 versions)' },
];

export default function Preflight() {
  return (
    <WizardStep
      slug="01-preflight"
      description="A quick check that your browser can run the wizard. Any red items mean this instance won't work correctly."
    >
      <div className="panel divide-y divide-[hsl(var(--border))]">
        {checks.map((c) => (
          <div
            key={c.name}
            className="flex items-center justify-between gap-4 px-5 py-4 transition-colors duration-[var(--dur)] hover:bg-[hsl(var(--bg-hover))/0.5]"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-[14px] text-fg">{c.name}</span>
              <span className="text-[12.5px] text-fg-subtle">{c.hint}</span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[hsl(var(--success))]">
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
              OK
            </span>
          </div>
        ))}
      </div>
    </WizardStep>
  );
}
