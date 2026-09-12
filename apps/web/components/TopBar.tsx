import Link from "next/link";
import Avatar from "@/components/ui/Avatar";
import MenuButton from "@/components/MenuButton";

export default function TopBar() {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <header className="grain-overlay relative flex h-14 shrink-0 items-center justify-between border-b border-border bg-topbar-gradient px-4 shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.03),0_1px_0_0_rgba(0,0,0,0.4)] md:px-6">
      <div className="flex items-center gap-2">
        <MenuButton />
        <Link href="/" className="flex items-center gap-2 text-sm font-bold tracking-tight text-ink-primary">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent-gradient shadow-[0_0_8px_-1px_var(--accent-glow)]" />
          Fantasy Analytics
        </Link>
      </div>

      <div className="flex items-center gap-4">
        <span className="hidden text-xs text-ink-faint sm:inline">{today}</span>
        <Avatar name="Max" />
      </div>
    </header>
  );
}
