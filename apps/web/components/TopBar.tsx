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
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4 md:px-6">
      <div className="flex items-center gap-2">
        <MenuButton />
        <Link href="/" className="flex items-center gap-2 text-sm font-bold tracking-tight text-ink-primary">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" />
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
