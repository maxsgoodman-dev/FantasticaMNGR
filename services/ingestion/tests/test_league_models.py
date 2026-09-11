from fantasy_ingest.league_models import (
    EntryGameweekStat,
    FantasyTeam,
    H2HFixture,
    LeagueSyncResult,
    RosterEntry,
    WeeklyScore,
)


def test_fantasy_team_fields():
    team = FantasyTeam(external_id="1", name="Team Alpha", owner_name="Max", is_mine=True)
    assert team.external_id == "1"
    assert team.name == "Team Alpha"
    assert team.owner_name == "Max"
    assert team.is_mine is True


def test_weekly_score_fields():
    score = WeeklyScore(team_external_id="1", week=3, points=87.5, opponent_external_id="2")
    assert score.team_external_id == "1"
    assert score.week == 3
    assert score.points == 87.5
    assert score.opponent_external_id == "2"


def test_weekly_score_opponent_defaults_to_none():
    score = WeeklyScore(team_external_id="1", week=3, points=87.5)
    assert score.opponent_external_id is None


def test_roster_entry_fields():
    entry = RosterEntry(
        team_external_id="1",
        week=3,
        player_external_id="101",
        player_name="Patrick Mahomes",
        is_starter=True,
        points=24.0,
    )
    assert entry.team_external_id == "1"
    assert entry.player_name == "Patrick Mahomes"
    assert entry.is_starter is True
    assert entry.points == 24.0


def test_h2h_fixture_fields():
    fixture = H2HFixture(team_external_id="1", week=4, opponent_external_id="2")
    assert fixture.team_external_id == "1"
    assert fixture.week == 4
    assert fixture.opponent_external_id == "2"


def test_h2h_fixture_opponent_defaults_to_none():
    fixture = H2HFixture(team_external_id="1", week=4)
    assert fixture.opponent_external_id is None


def test_entry_gameweek_stat_fields():
    stat = EntryGameweekStat(
        team_external_id="1",
        week=4,
        event_transfers=2,
        event_transfers_cost=0,
        points_on_bench=15,
        bank=0.2,
        team_value=100.4,
        overall_rank=2700348,
        active_chip="3xc",
    )
    assert stat.team_external_id == "1"
    assert stat.week == 4
    assert stat.event_transfers == 2
    assert stat.event_transfers_cost == 0
    assert stat.points_on_bench == 15
    assert stat.bank == 0.2
    assert stat.team_value == 100.4
    assert stat.overall_rank == 2700348
    assert stat.active_chip == "3xc"


def test_entry_gameweek_stat_chip_and_rank_default_to_none():
    stat = EntryGameweekStat(
        team_external_id="1",
        week=4,
        event_transfers=0,
        event_transfers_cost=0,
        points_on_bench=0,
        bank=0.0,
        team_value=100.0,
        overall_rank=None,
    )
    assert stat.overall_rank is None
    assert stat.active_chip is None


def test_league_sync_result_bundles_the_five_lists():
    team = FantasyTeam(external_id="1", name="Team Alpha", owner_name="Max", is_mine=True)
    score = WeeklyScore(team_external_id="1", week=1, points=10.0)
    entry = RosterEntry(
        team_external_id="1", week=1, player_external_id="101", player_name="P", is_starter=True, points=5.0
    )
    fixture = H2HFixture(team_external_id="1", week=2, opponent_external_id="2")
    stat = EntryGameweekStat(
        team_external_id="1",
        week=1,
        event_transfers=1,
        event_transfers_cost=0,
        points_on_bench=3,
        bank=0.5,
        team_value=100.5,
        overall_rank=100,
    )

    result = LeagueSyncResult(
        teams=[team],
        weekly_scores=[score],
        roster_players=[entry],
        h2h_fixtures=[fixture],
        entry_gameweek_stats=[stat],
    )

    assert result.teams == [team]
    assert result.weekly_scores == [score]
    assert result.roster_players == [entry]
    assert result.h2h_fixtures == [fixture]
    assert result.entry_gameweek_stats == [stat]


def test_league_sync_result_defaults_to_empty_lists():
    result = LeagueSyncResult()
    assert result.teams == []
    assert result.weekly_scores == []
    assert result.roster_players == []
    assert result.h2h_fixtures == []
    assert result.entry_gameweek_stats == []
