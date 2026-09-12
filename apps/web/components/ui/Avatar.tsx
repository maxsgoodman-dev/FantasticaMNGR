const PALETTE = [
  { bg: "bg-gradient-to-b from-accent/30 to-accent/10", text: "text-accent" },
  { bg: "bg-gradient-to-b from-series-opponent/30 to-series-opponent/10", text: "text-series-opponent" },
  { bg: "bg-gradient-to-b from-status-tie/30 to-status-tie/10", text: "text-status-tie" },
  { bg: "bg-gradient-to-b from-violet-400/30 to-violet-400/10", text: "text-violet-300" },
  { bg: "bg-gradient-to-b from-pink-400/30 to-pink-400/10", text: "text-pink-300" },
  { bg: "bg-gradient-to-b from-cyan-400/30 to-cyan-400/10", text: "text-cyan-300" },
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const { bg, text } = PALETTE[hashString(name) % PALETTE.length];
  const dimensions = size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),inset_0_-1px_2px_0_rgba(0,0,0,0.25)] ${dimensions} ${bg} ${text}`}
    >
      {initials(name)}
    </span>
  );
}
