"""Activity Service — movement intensity, step count, screen state and time period (report §4.1.2)."""
from datetime import datetime

from ..db import to_local


def period_of_day(hour: int) -> str:
    if 6 <= hour < 12:
        return "morning"
    if 12 <= hour < 17:
        return "afternoon"
    if 17 <= hour < 21:
        return "evening"
    return "night"


def get_activity_record(raw: dict, ts: datetime) -> dict:
    try:
        steps = max(0, int(raw.get("steps") or 0))
    except (TypeError, ValueError):
        steps = 0
    try:
        movement = float(raw.get("movement") or 0.0)
    except (TypeError, ValueError):
        movement = 0.0
    movement = min(1.0, max(0.0, movement))
    hour = to_local(ts).hour
    return {
        "steps": steps,
        "movement_level": movement,
        "screen_on": bool(raw.get("screen_on", False)),
        "hour": hour,
        "period": period_of_day(hour),
        "timestamp": ts,
    }
