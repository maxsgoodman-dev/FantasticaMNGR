"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import NavItem from "@/components/ui/NavItem";
import { useSidebar } from "@/components/SidebarContext";
import type { League } from "@/lib/leagues";

const SPORT_LABELS: Record<string, string> = {
  nfl: "NFL",
  "premier-league": "Premier League",
};

function groupBySport(leagues: League[]): Map<string, League[]> {
  const grouped = new Map<string, League[]>();
  for (const league of leagues) {
    const group = grouped.get(league.sportId) ?? [];
    group.push(league);
    grouped.set(league.sportId, group);
  }
  return grouped;
}

export default function SidebarNav({ leagues }: { leagues: League[] }) {
  const pathname = usePathname();
  const { close } = useSidebar();
  const grouped = groupBySport(leagues);
  const sportIds = Array.from(grouped.keys());
  const currentLeagueSport = leagues.find((league) => pathname === `/leagues/${league.id}`)?.sportId;
  const [activeSport, setActiveSport] = useState<string | undefined>(undefined);
  const visibleSportId = activeSport ?? currentLeagueSport ?? sportIds[0];
  const visibleLeagues = visibleSportId ? grouped.get(visibleSportId) ?? [] : [];

  return (
    <>
      {sportIds.length > 1 && (
        <div className="mb-4 flex rounded-md border border-border bg-surface-hover p-0.5 text-xs font-medium">
          {sportIds.map((sportId) => (
            <button
              key={sportId}
              type="button"
              onClick={() => setActiveSport(sportId)}
              className={`flex-1 rounded px-2 py-1.5 transition-colors ${
                sportId === visibleSportId ? "bg-accent text-black" : "text-ink-muted hover:text-ink-primary"
              }`}
            >
              {SPORT_LABELS[sportId] ?? sportId}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1">
        {visibleLeagues.map((league) => (
          <NavItem
            key={league.id}
            href={`/leagues/${league.id}`}
            active={pathname === `/leagues/${league.id}`}
            onClick={close}
          >
            {league.name}
          </NavItem>
        ))}
      </div>
    </>
  );
}
