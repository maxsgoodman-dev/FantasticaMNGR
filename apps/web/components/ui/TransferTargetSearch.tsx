"use client";

import { useEffect, useMemo, useState } from "react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import type { WarehousePlayer } from "@/lib/players";

// Deliberately a local, minimal shape rather than importing
// RosterPlayerRow from lib/leagues.ts — this component is meant to work
// from any starting XI (FPL roster rows, Sleeper roster rows, a
// hand-built array in a test/story) without dragging in that file's much
// larger League/Roster type graph.
export interface StartingXIPlayer {
  playerExternalId: string;
  playerName: string;
  position: string;
  points: number;
  /** Null when no trade-value model has been computed for this player yet. */
  tradeValue: number | null;
}

export interface TransferTargetSearchProps {
  /** The user's current starting XI to compare search results against. */
  startingXI: StartingXIPlayer[];
  /** Which platform's players to search (e.g. "fpl", "sleeper", "espn"). */
  sourceId: string;
  /** Which sport's player pool to search ("nfl" or "premier-league"). */
  sportId: string;
  /** Debounce delay for the search input, in ms. Defaults to 300. */
  debounceMs?: number;
}

const DEBOUNCE_DEFAULT_MS = 300;
const RESULT_LIMIT = 15;

// Sleeper/ESPN adapters leave price/total_points/form at a literal 0
// rather than faking a value, because those platforms have no
// per-player salary/points endpoint reachable without a league ID (see
// CLAUDE.md's adapter notes). That makes 0 indistinguishable from
// "unavailable" for any non-FPL source, so those stats are rendered as
// "—" there instead of a misleading zero.
function isStatTrustworthy(sourceId: string, value: number | null): value is number {
  if (value === null) return false;
  if (value === 0 && sourceId !== "fpl") return false;
  return true;
}

function formatPrice(sourceId: string, price: number | null): string {
  return isStatTrustworthy(sourceId, price) ? `£${price.toFixed(1)}m` : "—";
}

function formatPoints(sourceId: string, points: number | null): string {
  return isStatTrustworthy(sourceId, points) ? String(points) : "—";
}

function formatForm(sourceId: string, form: number | null): string {
  return isStatTrustworthy(sourceId, form) ? form.toFixed(1) : "—";
}

function comparisonBadge(
  candidateValue: number | null,
  starterValue: number,
  sourceId: string
): React.ReactNode {
  if (!isStatTrustworthy(sourceId, candidateValue)) return null;
  if (candidateValue > starterValue) return <Badge variant="win">Upgrade</Badge>;
  if (candidateValue < starterValue) return <Badge variant="loss">Downgrade</Badge>;
  return <Badge variant="tie">Even</Badge>;
}

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; results: WarehousePlayer[] };

export default function TransferTargetSearch({
  startingXI,
  sourceId,
  sportId,
  debounceMs = DEBOUNCE_DEFAULT_MS,
}: TransferTargetSearchProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [state, setState] = useState<FetchState>({ status: "idle" });
  const [selected, setSelected] = useState<WarehousePlayer | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), debounceMs);
    return () => clearTimeout(handle);
  }, [query, debounceMs]);

  useEffect(() => {
    if (debouncedQuery.length === 0) {
      setState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    const params = new URLSearchParams({
      sport: sportId,
      source: sourceId,
      search: debouncedQuery,
      limit: String(RESULT_LIMIT),
    });

    fetch(`/api/players/search?${params.toString()}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error ?? `search request failed with status ${response.status}`);
        }
        return body.players as WarehousePlayer[];
      })
      .then((players) => {
        if (!cancelled) setState({ status: "ready", results: players });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unknown error searching players",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, sourceId, sportId]);

  const comparablePlayers = useMemo(() => {
    if (!selected || !selected.position) return [];
    return startingXI.filter(
      (player) => player.position.toLowerCase() === selected.position?.toLowerCase()
    );
  }, [selected, startingXI]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <label htmlFor="transfer-target-search" className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          Search for a transfer target
        </label>
        <input
          id="transfer-target-search"
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(null);
          }}
          placeholder="Player name…"
          className="mt-2 w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-ink-primary placeholder:text-ink-faint focus:border-accent-dim focus:outline-none"
        />

        <div className="mt-3">
          {state.status === "idle" && (
            <p className="text-sm text-ink-faint">Start typing a player&apos;s name to search.</p>
          )}
          {state.status === "loading" && <p className="text-sm text-ink-muted">Searching…</p>}
          {state.status === "error" && (
            <p className="text-sm text-red-400">Couldn&apos;t search players: {state.message}</p>
          )}
          {state.status === "ready" && state.results.length === 0 && (
            <p className="text-sm text-ink-faint">No players found for &ldquo;{debouncedQuery}&rdquo;.</p>
          )}
          {state.status === "ready" && state.results.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Player</Th>
                    <Th>Team</Th>
                    <Th>Pos</Th>
                    <Th>Price</Th>
                    <Th>Points</Th>
                    <Th>Form</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {state.results.map((player) => (
                    <Tr
                      key={`${player.sourceId}-${player.externalId}`}
                      className={`cursor-pointer ${
                        selected?.externalId === player.externalId ? "bg-surface-hover" : ""
                      }`}
                      onClick={() => setSelected(player)}
                    >
                      <Td className="font-medium">{player.name}</Td>
                      <Td className="text-ink-muted">{player.team ?? "—"}</Td>
                      <Td>{player.position ? <Badge>{player.position}</Badge> : "—"}</Td>
                      <Td className="text-ink-muted">{formatPrice(player.sourceId, player.price)}</Td>
                      <Td>{formatPoints(player.sourceId, player.totalPoints)}</Td>
                      <Td className="text-ink-muted">{formatForm(player.sourceId, player.form)}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          )}
        </div>
      </Card>

      {selected && (
        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink-primary">
              Compare {selected.name} {selected.position ? <Badge variant="accent">{selected.position}</Badge> : null}
            </h3>
          </div>

          {comparablePlayers.length === 0 ? (
            <p className="mt-3 text-sm text-ink-faint">
              No starting-XI player in the same position ({selected.position ?? "unknown"}) to compare against.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Starting XI player</Th>
                    <Th>Points</Th>
                    <Th>Trade value</Th>
                    <Th>{selected.name} price</Th>
                    <Th>{selected.name} points</Th>
                    <Th>{selected.name} form</Th>
                    <Th>Verdict</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {comparablePlayers.map((starter) => (
                    <Tr key={starter.playerExternalId}>
                      <Td className="font-medium">{starter.playerName}</Td>
                      <Td>{starter.points}</Td>
                      <Td className="text-ink-muted">{starter.tradeValue ?? "—"}</Td>
                      <Td className="text-ink-muted">{formatPrice(selected.sourceId, selected.price)}</Td>
                      <Td>{formatPoints(selected.sourceId, selected.totalPoints)}</Td>
                      <Td className="text-ink-muted">{formatForm(selected.sourceId, selected.form)}</Td>
                      <Td>{comparisonBadge(selected.totalPoints, starter.points, selected.sourceId)}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
