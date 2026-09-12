"use client";

// A self-contained, client-side "what if" lineup sandbox: drag players
// between the starting XI and the bench to explore alternative lineups.
// This is a pure visual simulation — it does not call any FPL/Sleeper/
// ESPN API and nothing it does is persisted anywhere. No such write
// endpoint exists in this codebase (see services/ingestion's adapter
// docs: fetch_matchups() isn't even implemented yet, let alone a lineup
// submission path).
//
// Renders once per team — the caller mounts this twice (once per side of
// a GameweekMatchupCard-style layout) rather than this component
// hardcoding a "my team vs opponent" concept.

import { useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { GameweekMatchupPlayerRow } from "./GameweekMatchupCard";
import { PlayerTile, Slot, useLineupBoard, type LineupBoardState, type PlayerMap } from "./lineupBoard";
import PitchView from "./PitchView";

export type LineupLayout = "table" | "pitch";

export interface StartingXIBoardProps {
  teamName: string;
  roster: GameweekMatchupPlayerRow[];
  /** Which view renders first; the viewer can still toggle either way. Defaults to "pitch". */
  defaultLayout?: LineupLayout;
}

export default function StartingXIBoard({ teamName, roster, defaultLayout = "pitch" }: StartingXIBoardProps) {
  const { board, playerMap, handleDragEnd, totals } = useLineupBoard(roster);
  const [layout, setLayout] = useState<LineupLayout>(defaultLayout);
  const [activeId, setActiveId] = useState<string | null>(null);
  // dnd-kit assigns its screen-reader "described by" ids from a mutable
  // module-level counter, not React's SSR-safe useId — with two boards
  // mounted per page that counter increments in a different order on the
  // server than during client hydration, producing a guaranteed
  // attribute mismatch. Deferring the DnD tree to client-only mount
  // sidesteps it entirely rather than fighting dnd-kit's internals.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor)
  );

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    handleDragEnd(String(active.id), String(over.id));
  }

  function onDragCancel() {
    setActiveId(null);
  }

  const activePlayer = activeId ? playerMap.get(activeId) ?? null : null;

  return (
    <div className="rounded-2xl border border-border bg-gradient-to-b from-surface to-surface-hover/40 p-4 shadow-card sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink-primary">{teamName}</h3>
          <p className="mt-0.5 max-w-sm text-xs text-ink-faint">
            Drag players between the pitch and bench to try lineup ideas — a visual sandbox only, nothing here
            saves or submits anywhere.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TotalsBadge label="Live pts" value={totals.points} />
          <TotalsBadge label="Projected" value={totals.projectedPoints} />
          <LayoutToggle layout={layout} onChange={setLayout} />
        </div>
      </div>

      {mounted ? (
        <DndContext
          id={`lineup-${teamName}`}
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          {layout === "pitch" ? (
            <PitchView board={board} playerMap={playerMap} />
          ) : (
            <TableLayout board={board} playerMap={playerMap} />
          )}
          <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
            {activePlayer ? <PlayerTile player={activePlayer} onCourt /> : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <StaticSkeleton board={board} playerMap={playerMap} />
      )}
    </div>
  );
}

function TotalsBadge({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-border-hover bg-gradient-to-b from-surface-hover to-surface px-3 py-1.5 text-right shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="text-lg font-bold leading-tight text-ink-primary">{value == null ? "—" : value.toFixed(1)}</div>
    </div>
  );
}

function LayoutToggle({ layout, onChange }: { layout: LineupLayout; onChange: (layout: LineupLayout) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface-hover p-0.5 text-xs font-medium">
      {(["pitch", "table"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={layout === option}
          className={[
            "rounded-md px-2.5 py-1 transition-colors",
            layout === option ? "bg-accent/15 text-accent shadow-sm" : "text-ink-muted hover:text-ink-primary",
          ].join(" ")}
        >
          {option === "pitch" ? "Pitch view" : "Table view"}
        </button>
      ))}
    </div>
  );
}

// Pre-mount fallback: same list shape as TableLayout but with plain,
// non-draggable rows (no useDraggable/useDroppable) so the very first
// paint has zero dependency on dnd-kit's id-generation, which is what
// caused the hydration mismatch this is working around. Swapped for the
// real interactive board immediately after mount.
function StaticSkeleton({ board, playerMap }: { board: LineupBoardState; playerMap: PlayerMap }) {
  const row = (pid: string) => {
    const player = playerMap.get(pid);
    if (!player) return null;
    return (
      <div
        key={pid}
        className="flex items-center gap-2 rounded-xl border border-border bg-gradient-to-b from-surface to-surface-hover px-2.5 py-2 opacity-90"
      >
        {player.position && (
          <span className="inline-flex h-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface-hover px-1.5 text-[10px] font-semibold text-ink-muted">
            {player.position}
          </span>
        )}
        <span className="truncate text-xs font-semibold text-ink-primary">{player.playerName}</span>
      </div>
    );
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Starting XI</div>
        <div className="space-y-1.5">{board.starters.map(row)}</div>
      </div>
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Bench</div>
        <div className="space-y-1.5">{board.bench.map(row)}</div>
      </div>
    </div>
  );
}

function TableLayout({ board, playerMap }: { board: LineupBoardState; playerMap: PlayerMap }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Starting XI</div>
        <div className="space-y-1.5">
          {board.starters.map((pid, idx) => {
            const player = playerMap.get(pid);
            if (!player) return null;
            return (
              <Slot key={`starters:${idx}`} id={`starters:${idx}`}>
                <PlayerTile player={player} />
              </Slot>
            );
          })}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Bench</div>
        <div className="space-y-1.5">
          {board.bench.map((pid, idx) => {
            const player = playerMap.get(pid);
            if (!player) return null;
            return (
              <Slot key={`bench:${idx}`} id={`bench:${idx}`}>
                <PlayerTile player={player} />
              </Slot>
            );
          })}
        </div>
      </div>
    </div>
  );
}
