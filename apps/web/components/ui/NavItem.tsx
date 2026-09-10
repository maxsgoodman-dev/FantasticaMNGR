import Link from "next/link";
import type { ReactNode } from "react";

export default function NavItem({
  href,
  active = false,
  children,
  icon,
  onClick,
}: {
  href: string;
  active?: boolean;
  children: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-accent text-black shadow-card"
          : "text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
      }`}
    >
      {icon}
      {children}
    </Link>
  );
}
