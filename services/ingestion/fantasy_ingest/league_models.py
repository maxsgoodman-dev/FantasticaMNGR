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
class H2HFixture:
    team_external_id: str
    week: int
    opponent_external_id: str | None = None


@dataclass
class EntryGameweekStat:
    team_external_id: str
    week: int
    event_transfers: int
    event_transfers_cost: int
    points_on_bench: int
    bank: float
    team_value: float
    overall_rank: int | None
    active_chip: str | None = None


@dataclass
class LeagueSyncResult:
    teams: list[FantasyTeam] = field(default_factory=list)
    weekly_scores: list[WeeklyScore] = field(default_factory=list)
    roster_players: list[RosterEntry] = field(default_factory=list)
    h2h_fixtures: list[H2HFixture] = field(default_factory=list)
    entry_gameweek_stats: list[EntryGameweekStat] = field(default_factory=list)
    # The platform's own display name for this league (e.g. Sleeper's
    # league.name, FPL standings' league.name), when the fetch could get
    # one. `league_config.py` only ever has the numeric external ID to
    # build a placeholder from at job-construction time — this lets
    # sync_league_data replace that placeholder with the real name once
    # the fetch actually happens, without changing what league_config.py
    # itself knows.
    league_name: str | None = None
