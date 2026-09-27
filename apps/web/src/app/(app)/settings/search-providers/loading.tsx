import { ThinkingOrb } from 'thinking-orbs';

export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid min-h-[60vh] w-full place-items-center"
    >
      <ThinkingOrb state="working" size={64} />
    </div>
  );
}
