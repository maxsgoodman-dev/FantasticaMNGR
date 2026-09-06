from abc import ABC, abstractmethod

from fantasy_ingest.models import Player, Team


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
