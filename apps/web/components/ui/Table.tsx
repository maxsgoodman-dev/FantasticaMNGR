import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

export function Table({ className = "", ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={`w-full text-left text-sm ${className}`} {...props} />;
}

export function Thead({ className = "", ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={`bg-gradient-to-b from-surface-raised/60 to-transparent text-xs font-medium uppercase tracking-wide text-ink-muted ${className}`}
      {...props}
    />
  );
}

export function Tbody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function Tr({ className = "", ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={`border-t border-border transition-colors duration-150 first:border-t-0 hover:bg-gradient-to-r hover:from-surface-hover hover:to-transparent ${className}`}
      {...props}
    />
  );
}

export function Th({ className = "", ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`border-b border-border px-4 py-2.5 font-medium shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.03)] ${className}`}
      {...props}
    />
  );
}

export function Td({ className = "", ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`px-4 py-2.5 text-ink-primary ${className}`} {...props} />;
}
