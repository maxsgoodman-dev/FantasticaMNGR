from dataclasses import dataclass


@dataclass
class Player:
    id: str
    name: str
    team: str
    position: str
    price: float
    total_points: int
    form: float


@dataclass
class Team:
    id: str
    name: str
    short_name: str


@dataclass
class PlayerProjection:
    player_external_id: str
    projected_points: float
