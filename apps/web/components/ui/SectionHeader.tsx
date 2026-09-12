import type { ReactNode } from "react";

export default function SectionHeader({
  title,
  description,
  controls,
  size = "md",
}: {
  title: string;
  description?: string;
  controls?: ReactNode;
  size?: "lg" | "md";
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1
          className={
            size === "lg"
              ? "bg-gradient-to-b from-ink-primary to-ink-primary/80 bg-clip-text text-2xl font-bold leading-tight tracking-tight text-transparent"
              : "text-lg font-semibold text-ink-primary"
          }
        >
          {title}
        </h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {controls && <div className="flex items-center gap-3">{controls}</div>}
    </div>
  );
}
