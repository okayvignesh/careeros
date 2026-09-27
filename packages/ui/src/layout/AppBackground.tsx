/** Grain overlay only. Depth comes from composition, not ambient light. */
export function AppBackground() {
  return <div className="ambient-grain" aria-hidden="true" />;
}
