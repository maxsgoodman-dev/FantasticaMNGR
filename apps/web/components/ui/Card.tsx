import type { HTMLAttributes } from "react";

export default function Card({
  className = "",
  interactive = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={`grain-overlay rounded-xl border border-border bg-panel-gradient p-5 shadow-card transition-all duration-300 ease-out ${
        interactive
          ? "hover:-translate-y-0.5 hover:border-border-hover hover:bg-panel-gradient-hover hover:shadow-card-hover"
          : ""
      } ${className}`}
      {...props}
    />
  );
}
