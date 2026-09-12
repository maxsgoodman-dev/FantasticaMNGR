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
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium leading-snug transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
        active
          ? "bg-accent-gradient text-black shadow-[inset_0_1px_0_0_rgba(255,255,255,0.3),0_2px_8px_-2px_var(--accent-glow)]"
          : "text-ink-muted hover:translate-x-0.5 hover:bg-gradient-to-r hover:from-surface-hover hover:to-transparent hover:text-ink-primary"
      }`}
    >
      {icon}
      {children}
    </Link>
  );
}
