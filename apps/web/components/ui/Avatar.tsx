const PALETTE = [
  { bg: "bg-accent/20", text: "text-accent" },
  { bg: "bg-series-opponent/20", text: "text-series-opponent" },
  { bg: "bg-status-tie/20", text: "text-status-tie" },
  { bg: "bg-violet-400/20", text: "text-violet-300" },
  { bg: "bg-pink-400/20", text: "text-pink-300" },
  { bg: "bg-cyan-400/20", text: "text-cyan-300" },
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
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${dimensions} ${bg} ${text}`}
    >
      {initials(name)}
    </span>
  );
}
