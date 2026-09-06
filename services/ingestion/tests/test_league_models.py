from fantasy_ingest.league_models import FantasyTeam, LeagueSyncResult, RosterEntry, WeeklyScore


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


def test_league_sync_result_bundles_the_three_lists():
    team = FantasyTeam(external_id="1", name="Team Alpha", owner_name="Max", is_mine=True)
    score = WeeklyScore(team_external_id="1", week=1, points=10.0)
    entry = RosterEntry(
        team_external_id="1", week=1, player_external_id="101", player_name="P", is_starter=True, points=5.0
    )

    result = LeagueSyncResult(teams=[team], weekly_scores=[score], roster_players=[entry])

    assert result.teams == [team]
    assert result.weekly_scores == [score]
    assert result.roster_players == [entry]
