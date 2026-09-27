import { Eyebrow } from '@careeros/ui';
import { MarketBriefPanel } from '@/components/brief/MarketBriefPanel';

export default function MarketBriefPage() {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Market brief</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Market brief
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          A weekly synthesis of what your preference-filtered job pool is saying: top skills,
          top companies, remote share, and new listings. Every claim cites a job link so you
          can chase it. Walking-skeleton: on-demand only, cron scheduling lands later.
        </p>
      </header>
      <MarketBriefPanel />
    </main>
  );
}
