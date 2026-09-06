from abc import ABC, abstractmethod

from fantasy_ingest.models import Player, Team


class FantasySourceAdapter(ABC):
    """Common interface for a single fantasy platform's data source."""

    source: str

    @abstractmethod
    def fetch_players(self) -> list[Player]: ...

    @abstractmethod
    def fetch_teams(self) -> list[Team]: ...

    @abstractmethod
    def fetch_matchups(self) -> list[dict]: ...
