import type { ReactNode } from "react";

const VARIANT_CLASSES = {
  neutral: "border-border bg-surface-hover text-ink-muted",
  accent: "border-accent-dim/40 bg-accent/10 text-accent",
  starter: "border-accent-dim/40 bg-accent/10 text-accent",
  bench: "border-border bg-surface-hover text-ink-faint",
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
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${VARIANT_CLASSES[variant]}`}
    >
      {children}
    </span>
  );
}
