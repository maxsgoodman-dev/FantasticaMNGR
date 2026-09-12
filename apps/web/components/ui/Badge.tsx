import type { ReactNode } from "react";

const VARIANT_CLASSES = {
  neutral:
    "border-border bg-gradient-to-b from-surface-hover to-surface text-ink-muted shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]",
  accent:
    "border-accent-dim/40 bg-gradient-to-b from-accent/15 to-accent/5 text-accent shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_0_10px_-2px_var(--accent-glow-soft)]",
  starter:
    "border-accent-dim/40 bg-gradient-to-b from-accent/15 to-accent/5 text-accent shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_0_10px_-2px_var(--accent-glow-soft)]",
  bench:
    "border-border bg-gradient-to-b from-surface-hover to-surface text-ink-faint shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]",
  win: "border-status-win/40 bg-gradient-to-b from-status-win/15 to-status-win/5 text-status-win shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]",
  loss: "border-status-loss/40 bg-gradient-to-b from-status-loss/15 to-status-loss/5 text-status-loss shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]",
  tie: "border-status-tie/40 bg-gradient-to-b from-status-tie/15 to-status-tie/5 text-status-tie shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]",
} as const;

export default function Badge({
  children,
  variant = "neutral",
}: {
  children: ReactNode;
  variant?: keyof typeof VARIANT_CLASSES;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium transition-colors duration-200 ${VARIANT_CLASSES[variant]}`}
    >
      {children}
    </span>
  );
}
