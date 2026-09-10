import Link from "next/link";
import type { ReactNode } from "react";

export default function NavItem({
  href,
  active = false,
  children,
  icon,
}: {
  href: string;
  active?: boolean;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 rounded-md border-l-2 px-3 py-2 text-sm transition-colors ${
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-transparent text-ink-muted hover:border-border-hover hover:bg-surface-hover hover:text-ink-primary"
      }`}
    >
      {icon}
      {children}
    </Link>
  );
}
