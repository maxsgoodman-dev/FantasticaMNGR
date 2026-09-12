"use client";

import type { GameweekMatchupPlayerRow } from "./GameweekMatchupCard";
import { PlayerTile, Slot, type LineupBoardState, type PlayerMap } from "./lineupBoard";

// Attacking end (FWD) at the top, own goal (GKP) at the back/bottom —
// the conventional "behind the goal" broadcast view.
const POSITION_ROWS: Array<NonNullable<GameweekMatchupPlayerRow["position"]>> = [
  "FWD",
  "MID",
  "DEF",
  "GKP",
];

interface StarterSlot {
  slotId: string;
  player: GameweekMatchupPlayerRow;
}

export default function PitchView({
  board,
  playerMap,
}: {
  board: LineupBoardState;
  playerMap: PlayerMap;
}) {
  const startersWithSlots: StarterSlot[] = board.starters
    .map((pid, idx) => {
      const player = playerMap.get(pid);
      return player ? { slotId: `starters:${idx}`, player } : null;
    })
    .filter((entry): entry is StarterSlot => entry != null);

  const rows = POSITION_ROWS.map((position) => ({
    position,
    entries: startersWithSlots.filter((entry) => entry.player.position === position),
  }));
  const flexEntries = startersWithSlots.filter((entry) => entry.player.position == null);

  return (
    <div className="space-y-3">
      <div
        className="relative w-full overflow-hidden rounded-2xl border border-black/20"
        style={{
          aspectRatio: "4 / 5",
          boxShadow:
            "inset 0 2px 24px rgba(0,0,0,0.35), inset 0 -2px 24px rgba(0,0,0,0.25), 0 12px 30px -14px rgba(0,0,0,0.55)",
          backgroundImage: [
            // mown-stripe banding
            "repeating-linear-gradient(180deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 44px, rgba(0,0,0,0.05) 44px, rgba(0,0,0,0.05) 88px)",
            // soft floodlight falloff from the top
            "radial-gradient(120% 70% at 50% 0%, rgba(255,255,255,0.12), transparent 60%)",
            // base grass gradient
            "linear-gradient(180deg, #237a41 0%, #1a6535 45%, #0f4d27 100%)",
          ].join(", "),
        }}
      >
        {/* subtle turf texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-50 mix-blend-overlay"
          style={{
            backgroundImage: [
              "radial-gradient(circle at 15% 25%, rgba(255,255,255,0.14) 0%, transparent 2.5%)",
              "radial-gradient(circle at 65% 55%, rgba(255,255,255,0.10) 0%, transparent 2.5%)",
              "radial-gradient(circle at 40% 82%, rgba(0,0,0,0.16) 0%, transparent 2.5%)",
              "radial-gradient(circle at 82% 18%, rgba(0,0,0,0.14) 0%, transparent 2.5%)",
              "radial-gradient(circle at 30% 60%, rgba(0,0,0,0.10) 0%, transparent 2%)",
            ].join(", "),
            backgroundSize: "150px 150px, 170px 170px, 130px 130px, 190px 190px, 110px 110px",
          }}
        />

        {/* pitch markings */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 300 400"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <g stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" fill="none">
            <rect x="6" y="6" width="288" height="388" rx="2" />
            <line x1="6" y1="200" x2="294" y2="200" />
            <circle cx="150" cy="200" r="38" />
            <circle cx="150" cy="200" r="1.6" fill="rgba(255,255,255,0.55)" stroke="none" />

            {/* attacking end penalty area */}
            <rect x="70" y="6" width="160" height="60" />
            <rect x="112" y="6" width="76" height="24" />
            <path d="M 112 66 A 38 38 0 0 0 188 66" />
            <circle cx="150" cy="52" r="1.6" fill="rgba(255,255,255,0.55)" stroke="none" />

            {/* own-goal end penalty area */}
            <rect x="70" y="334" width="160" height="60" />
            <rect x="112" y="370" width="76" height="24" />
            <path d="M 112 334 A 38 38 0 0 1 188 334" />
            <circle cx="150" cy="348" r="1.6" fill="rgba(255,255,255,0.55)" stroke="none" />

            {/* corner arcs */}
            <path d="M 6 18 A 12 12 0 0 0 18 6" />
            <path d="M 282 6 A 12 12 0 0 0 294 18" />
            <path d="M 6 382 A 12 12 0 0 1 18 394" />
            <path d="M 294 382 A 12 12 0 0 1 282 394" />
          </g>
        </svg>

        {/* starters */}
        <div className="relative flex h-full flex-col justify-between px-3 py-5 sm:px-6">
          {rows.map((row) => (
            <PitchRow key={row.position} entries={row.entries} />
          ))}
          {flexEntries.length > 0 && <PitchRow entries={flexEntries} />}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Bench</div>
        <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-surface-hover/60 p-2.5">
          {board.bench.map((pid, idx) => {
            const player = playerMap.get(pid);
            if (!player) return null;
            return (
              <Slot key={`bench:${idx}`} id={`bench:${idx}`} className="min-w-[104px] flex-1 sm:flex-none">
                <PlayerTile player={player} onCourt />
              </Slot>
            );
          })}
          {board.bench.length === 0 && <p className="text-xs text-ink-faint">No bench players.</p>}
        </div>
      </div>
    </div>
  );
}

function PitchRow({ entries }: { entries: StarterSlot[] }) {
  if (entries.length === 0) {
    return <div aria-hidden="true" />;
  }
  return (
    <div className="flex flex-wrap items-start justify-evenly gap-x-1 gap-y-2">
      {entries.map(({ slotId, player }) => (
        <Slot key={slotId} id={slotId} className="w-[104px] sm:w-[118px]">
          <PlayerTile player={player} onCourt />
        </Slot>
      ))}
    </div>
  );
}
