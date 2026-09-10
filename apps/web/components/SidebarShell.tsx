"use client";

import type { ReactNode } from "react";
import { useSidebar } from "@/components/SidebarContext";

export default function SidebarShell({ children }: { children: ReactNode }) {
  const { isOpen, close } = useSidebar();

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={close} />}
      <aside
        className={`fixed bottom-0 left-0 top-14 z-40 w-64 shrink-0 overflow-y-auto border-r border-border bg-canvas p-6 transition-transform duration-200 md:static md:top-auto md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {children}
      </aside>
    </>
  );
}
