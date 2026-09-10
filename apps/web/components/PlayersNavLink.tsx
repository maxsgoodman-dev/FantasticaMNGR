"use client";

import NavItem from "@/components/ui/NavItem";
import { useSidebar } from "@/components/SidebarContext";

export default function PlayersNavLink() {
  const { close } = useSidebar();

  return (
    <NavItem
      href="/players"
      onClick={close}
      icon={
        <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
          <path d="M1.5 6h13M6 6v8.5" />
        </svg>
      }
    >
      Browse all players
    </NavItem>
  );
}
