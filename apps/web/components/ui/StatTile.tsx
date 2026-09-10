import Card from "./Card";

const TONE_CLASSES = {
  default: "text-ink-primary",
  accent: "text-accent",
  win: "text-status-win",
  loss: "text-status-loss",
  tie: "text-status-tie",
} as const;

export default function StatTile({
  label,
  value,
  sublabel,
  tone = "default",
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: keyof typeof TONE_CLASSES;
}) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</span>
      <span className={`text-3xl font-bold ${TONE_CLASSES[tone]}`}>{value}</span>
      {sublabel && <span className="text-xs text-ink-faint">{sublabel}</span>}
    </Card>
  );
}
