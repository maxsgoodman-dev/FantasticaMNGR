import type { HTMLAttributes } from "react";

export default function Card({
  className = "",
  interactive = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={`rounded-xl border border-border bg-surface p-5 shadow-card transition-all duration-200 ${
        interactive ? "hover:-translate-y-0.5 hover:border-border-hover hover:shadow-card-hover" : ""
      } ${className}`}
      {...props}
    />
  );
}
