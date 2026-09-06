from dataclasses import dataclass, field


@dataclass
class FantasyTeam:
    external_id: str
    name: str
    owner_name: str
    is_mine: bool


@dataclass
class WeeklyScore:
    team_external_id: str
    week: int
    points: float
    opponent_external_id: str | None = None


@dataclass
class RosterEntry:
    team_external_id: str
    week: int
    player_external_id: str
    player_name: str
    is_starter: bool
    points: float


@dataclass
class LeagueSyncResult:
    teams: list[FantasyTeam] = field(default_factory=list)
    weekly_scores: list[WeeklyScore] = field(default_factory=list)
    roster_players: list[RosterEntry] = field(default_factory=list)
