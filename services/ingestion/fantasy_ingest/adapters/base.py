from abc import ABC, abstractmethod

from fantasy_ingest.models import Player, PlayerProjection, Team


class FantasySourceAdapter(ABC):
    """Common interface for a single fantasy platform's data source.

    Every adapter is scoped to exactly one sport (e.g. "nfl",
    "premier-league") — a platform never spans sports, so this is a
    class attribute rather than per-Player/Team data. The dashboard uses
    it to group leagues by sport, not just list them flat.
    """

    source: str
    sport: str

    @abstractmethod
    def fetch_players(self) -> list[Player]: ...

    @abstractmethod
    def fetch_teams(self) -> list[Team]: ...

    @abstractmethod
    def fetch_matchups(self) -> list[dict]: ...

    def fetch_projections(self, week: int) -> list[PlayerProjection]:
        """Per-player projected points for one week, platform-wide.

        Not abstract — same reasoning as fetch_matchups: not every
        adapter can support this (ESPN has no per-player projection
        endpoint reachable without a league-scoped call), so the default
        is an explicit opt-out rather than a forced implementation.
        """
        raise NotImplementedError
