"""Schedule Optimizer — morning/afternoon/evening/night periods and smart reminders (report §5.1.6)."""
from datetime import datetime

from ..services.activity import period_of_day

DEFAULT_SCHEDULE = [
    ("06:30", "Wake up", "routine", "high"),
    ("07:00", "Breakfast", "meal", "high"),
    ("07:45", "Leave for school", "routine", "high"),
    ("08:30", "School starts", "education", "high"),
    ("13:00", "Lunch break", "meal", "medium"),
    ("14:30", "School ends", "education", "high"),
    ("15:30", "Snack & water", "health", "medium"),
    ("16:00", "Outdoor play", "physical", "medium"),
    ("17:30", "Homework / study", "education", "high"),
    ("19:00", "Dinner with family", "meal", "high"),
    ("20:00", "Reading time", "education", "low"),
    ("21:00", "Screens off", "routine", "high"),
    ("21:30", "Bedtime", "routine", "high"),
]

PERIOD_BOUNDS = {"morning": (6, 12), "afternoon": (12, 17), "evening": (17, 21), "night": (21, 30)}


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def group_by_period(items: list[dict]) -> dict:
    out = {p: [] for p in PERIOD_BOUNDS}
    for it in sorted(items, key=lambda i: i["time"]):
        out[period_of_day(int(it["time"][:2]))].append(it)
    return out


def current_recommendation(items: list[dict], now_local: datetime) -> dict:
    now_min = now_local.hour * 60 + now_local.minute
    ordered = sorted(items, key=lambda i: i["time"])
    current = None
    upcoming = None
    for it in ordered:
        if _minutes(it["time"]) <= now_min:
            current = it
        elif upcoming is None:
            upcoming = it
    if upcoming:
        mins = _minutes(upcoming["time"]) - now_min
    elif ordered:
        upcoming = ordered[0]
        mins = _minutes(upcoming["time"]) + 24 * 60 - now_min
    else:
        mins = None
    return {"period": period_of_day(now_local.hour), "current": current, "next": upcoming, "minutes_until_next": mins}


def smart_reminders(now_local: datetime, device: dict, activity_counts: dict, settings: dict) -> list[dict]:
    """Reminders derived from the observed routine rather than fixed times."""
    reminders = []
    hour = now_local.hour
    period = period_of_day(hour)
    screen_limit = settings["screen_limit_minutes"]
    if device["screen_minutes"] > screen_limit * 0.8:
        reminders.append({"icon": "screen", "text": f"Screen time is at {int(device['screen_minutes'])} min — "
                          f"suggest a break before the {screen_limit} min limit."})
    if device["gaming_minutes"] > device["study_minutes"] and period in ("afternoon", "evening"):
        reminders.append({"icon": "book", "text": "Gaming is ahead of study today — nudge homework time."})
    idle = activity_counts.get("Idle", 0) + activity_counts.get("Sitting", 0)
    moving = activity_counts.get("Walking", 0) + activity_counts.get("Active", 0)
    if period != "night" and idle > 3 * max(moving, 1):
        reminders.append({"icon": "run", "text": "Mostly sedentary in the last hour — a short walk or play break helps."})
    if period == "evening" and hour >= 20:
        reminders.append({"icon": "moon", "text": "Wind-down time: screens off by 21:00 keeps the bedtime check green."})
    if period == "morning" and hour < 8:
        reminders.append({"icon": "bag", "text": "Check the ID card is in the bag — attendance is scanned at the gate."})
    if not reminders:
        reminders.append({"icon": "check", "text": "Routine looks on track right now."})
    return reminders
