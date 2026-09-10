import Card from "./Card";

export default function StatTile({
  label,
  value,
  sublabel,
  accent = false,
}: {
  label: string;
  value: string;
  sublabel?: string;
  accent?: boolean;
}) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</span>
      <span className={`text-3xl font-bold ${accent ? "text-accent" : "text-ink-primary"}`}>{value}</span>
      {sublabel && <span className="text-xs text-ink-faint">{sublabel}</span>}
    </Card>
  );
}
