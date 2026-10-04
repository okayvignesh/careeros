import { Eyebrow } from '@careeros/ui';
import { DailyBriefPanel } from '@/components/brief/DailyBriefPanel';

export default function DailyBriefPage() {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Daily assistant · Daily brief</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">Daily brief</h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          One plain-text message each weekday morning: the next action, what changed yesterday, and
          what is waiting on you. No formatting, so every signal survives the channel.
        </p>
      </header>
      <DailyBriefPanel />
    </main>
  );
}
