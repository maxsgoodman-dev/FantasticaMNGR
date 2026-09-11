"use client";

import { useSidebar } from "@/components/SidebarContext";

export default function MenuButton() {
  const { toggle } = useSidebar();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle navigation"
      className="rounded-md p-2 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface md:hidden"
    >
      <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" d="M3 5h14M3 10h14M3 15h14" />
      </svg>
    </button>
  );
}
