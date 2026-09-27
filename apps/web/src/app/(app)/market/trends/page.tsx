import { SectionHeader, Button } from '@careeros/ui';
import { TrendSignalsPanel } from '@/components/market-demand/TrendSignalsPanel';

export default function TrendsPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-12 py-14">
      <SectionHeader
        eyebrow="Market"
        title="Technology signals"
        description="Rising, steady, and declining technologies in your filtered job pool. Each row is one signal; select it to see the gate rules that turn it into a quest."
        trailing={<Button>Refresh signals</Button>}
      />
      <TrendSignalsPanel />
    </main>
  );
}
