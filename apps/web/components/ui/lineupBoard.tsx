"use client";

// Shared drag-and-drop plumbing for StartingXIBoard.tsx and PitchView.tsx.
//
// This is a pure client-side "what if" lineup sandbox: dragging a player
// only rearranges local component state. There is no write endpoint in
// this codebase for lineup changes (see the adapter docs in
// services/ingestion) — nothing here is saved, submitted, or synced to
// FPL/Sleeper/ESPN.

import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { GameweekMatchupPlayerRow } from "./GameweekMatchupCard";

export type PlayerMap = Map<string, GameweekMatchupPlayerRow>;

export interface LineupBoardState {
  starters: string[];
  bench: string[];
}

export interface LineupTotals {
  points: number | null;
  projectedPoints: number | null;
}

const POSITION_ORDER: Record<string, number> = { GKP: 0, DEF: 1, MID: 2, FWD: 3 };

function positionRank(position: GameweekMatchupPlayerRow["position"]): number {
  return position != null ? POSITION_ORDER[position] ?? 4 : 4;
}

function buildInitialBoard(roster: GameweekMatchupPlayerRow[]): LineupBoardState {
  const sorted = [...roster].sort((a, b) => positionRank(a.position) - positionRank(b.position));
  return {
    starters: sorted.filter((p) => p.isStarter).map((p) => p.playerExternalId),
    bench: sorted.filter((p) => !p.isStarter).map((p) => p.playerExternalId),
  };
}

export function useLineupBoard(roster: GameweekMatchupPlayerRow[]) {
  const playerMap = useMemo<PlayerMap>(
    () => new Map(roster.map((p) => [p.playerExternalId, p])),
    [roster]
  );

  const initialBoard = useMemo(() => buildInitialBoard(roster), [roster]);
  const [board, setBoard] = useState<LineupBoardState>(initialBoard);

  // Reset the sandbox whenever the caller hands us a genuinely different
  // roster (e.g. the page navigated to a different team or week) rather
  // than carrying over stale drag state. Adjusting state during render is
  // the documented React pattern for "reset on prop change".
  const [seenRoster, setSeenRoster] = useState(roster);
  if (seenRoster !== roster) {
    setSeenRoster(roster);
    setBoard(initialBoard);
  }

  const handleDragEnd = useCallback((activeId: string, overId: string) => {
    setBoard((prev) => {
      const starters = [...prev.starters];
      const bench = [...prev.bench];

      const locate = (pid: string): { arr: string[]; idx: number } | null => {
        let idx = starters.indexOf(pid);
        if (idx !== -1) return { arr: starters, idx };
        idx = bench.indexOf(pid);
        if (idx !== -1) return { arr: bench, idx };
        return null;
      };

      const separatorIdx = overId.indexOf(":");
      if (separatorIdx === -1) return prev;
      const toList = overId.slice(0, separatorIdx);
      const toIdx = Number(overId.slice(separatorIdx + 1));
      const toArr = toList === "starters" ? starters : toList === "bench" ? bench : null;
      if (!toArr || Number.isNaN(toIdx) || toIdx < 0 || toIdx >= toArr.length) return prev;

      const from = locate(activeId);
      if (!from) return prev;

      const targetPid = toArr[toIdx];
      if (targetPid === activeId) return prev;

      // Swap: the dragged player takes the target slot, and whoever was
      // occupying that slot takes the dragged player's old slot. Works
      // whether the swap is starter<->bench or within the same list,
      // since fromArr/toArr may reference the same array.
      toArr[toIdx] = activeId;
      from.arr[from.idx] = targetPid;

      return { starters, bench };
    });
  }, []);

  const totals = useMemo<LineupTotals>(() => {
    let points = 0;
    let hasPoints = false;
    let projectedPoints = 0;
    let hasProjected = false;

    for (const pid of board.starters) {
      const player = playerMap.get(pid);
      if (!player) continue;
      if (player.points != null) {
        points += player.points;
        hasPoints = true;
      }
      if (player.projectedPoints != null) {
        projectedPoints += player.projectedPoints;
        hasProjected = true;
      }
    }

    return {
      points: hasPoints ? points : null,
      projectedPoints: hasProjected ? projectedPoints : null,
    };
  }, [board.starters, playerMap]);

  return { board, playerMap, handleDragEnd, totals };
}

const POSITION_BADGE_CLASSES: Record<string, string> = {
  GKP: "border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400",
  DEF: "border-sky-500/30 bg-sky-500/15 text-sky-600 dark:text-sky-400",
  MID: "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  FWD: "border-rose-500/30 bg-rose-500/15 text-rose-600 dark:text-rose-400",
};

export function Slot({
  id,
  children,
  className = "",
  emptyLabel,
}: {
  id: string;
  children?: ReactNode;
  className?: string;
  emptyLabel?: string;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={[
        "rounded-xl transition-colors duration-150",
        isOver ? "bg-accent/10 ring-2 ring-accent/50" : "",
        className,
      ].join(" ")}
    >
      {children ?? (
        <div className="flex h-full min-h-[44px] items-center justify-center rounded-xl border border-dashed border-border text-[10px] text-ink-faint">
          {emptyLabel ?? "Empty"}
        </div>
      )}
    </div>
  );
}

export function PlayerTile({
  player,
  compact = false,
  onCourt = false,
}: {
  player: GameweekMatchupPlayerRow;
  compact?: boolean;
  onCourt?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: player.playerExternalId,
  });

  const style: CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : {};

  const displayValue = player.points ?? player.projectedPoints;
  const valueLabel = player.points != null ? "pts" : "proj";

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, zIndex: isDragging ? 50 : undefined, touchAction: "none" }}
      {...listeners}
      {...attributes}
      className={[
        "group relative flex select-none items-center gap-2 rounded-xl border px-2.5 py-2 text-left",
        "border-border bg-gradient-to-b from-surface to-surface-hover",
        "shadow-[0_1px_2px_rgba(0,0,0,0.08),0_6px_14px_-6px_rgba(0,0,0,0.4)]",
        "transition-[transform,box-shadow] duration-150 will-change-transform",
        "hover:-translate-y-0.5 hover:shadow-[0_2px_5px_rgba(0,0,0,0.1),0_12px_22px_-8px_rgba(0,0,0,0.5)]",
        "cursor-grab active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
        isDragging ? "opacity-40" : "opacity-100",
        onCourt ? "w-[92px] flex-col text-center" : "w-full",
      ].join(" ")}
    >
      {player.position && (
        <span
          className={[
            "inline-flex h-5 shrink-0 items-center justify-center rounded-full border px-1.5 text-[10px] font-semibold",
            POSITION_BADGE_CLASSES[player.position] ?? "border-border bg-surface-hover text-ink-muted",
          ].join(" ")}
        >
          {player.position}
        </span>
      )}
      <div className={onCourt ? "min-w-0" : "min-w-0 flex-1"}>
        <div className="truncate text-xs font-semibold leading-tight text-ink-primary">
          {player.playerName}
        </div>
        {!compact && (
          <div className="text-[10px] leading-tight text-ink-faint">
            {displayValue == null ? "—" : `${displayValue.toFixed(1)} ${valueLabel}`}
          </div>
        )}
      </div>
    </div>
  );
}
