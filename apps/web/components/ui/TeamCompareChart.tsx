interface CompareMetric {
  label: string;
  mine: number;
  opponent: number;
  unit?: string;
}

function Bar({
  value,
  max,
  colorClass,
  title,
}: {
  value: number;
  max: number;
  colorClass: string;
  title: string;
}) {
  const widthPct = max <= 0 ? 0 : Math.max((value / max) * 100, value > 0 ? 3 : 0);
  return (
    <div className="flex items-center gap-2" title={title}>
      <div className="h-2 flex-1 rounded-full bg-surface-hover">
        <div
          className={`h-2 rounded-full ${colorClass}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-muted">
        {Number.isInteger(value) ? value : value.toFixed(1)}
      </span>
    </div>
  );
}

export default function TeamCompareChart({
  myTeamName,
  opponentTeamName,
  metrics,
}: {
  myTeamName: string;
  opponentTeamName: string;
  metrics: CompareMetric[];
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-ink-muted">
          <span className="h-2 w-2 rounded-full bg-accent" />
          {myTeamName}
        </span>
        <span className="flex items-center gap-1.5 text-ink-muted">
          <span className="h-2 w-2 rounded-full bg-series-opponent" />
          {opponentTeamName}
        </span>
      </div>

      <div className="space-y-3">
        {metrics.map((metric) => {
          const max = Math.max(metric.mine, metric.opponent, 1);
          return (
            <div key={metric.label}>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-faint">
                {metric.label}
              </div>
              <Bar
                value={metric.mine}
                max={max}
                colorClass="bg-accent"
                title={`${myTeamName} ${metric.label}: ${metric.mine}${metric.unit ?? ""}`}
              />
              <div className="mt-1">
                <Bar
                  value={metric.opponent}
                  max={max}
                  colorClass="bg-series-opponent"
                  title={`${opponentTeamName} ${metric.label}: ${metric.opponent}${metric.unit ?? ""}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
