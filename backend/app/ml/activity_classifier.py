"""Activity Classifier — Sleeping / Idle / Sitting / Walking / Active (report §5.1.6).

Rule-based on step count (per reading interval), movement intensity, screen state and hour.
"""

CLASSES = ("Sleeping", "Idle", "Sitting", "Walking", "Active")


def classify_activity(record: dict) -> str:
    steps = record.get("steps", 0)
    movement = record.get("movement_level", 0)
    screen_on = record.get("screen_on", False)
    hour = record.get("hour", 12)

    if steps < 5 and movement < 0.1:
        if (hour >= 22 or hour < 6) and not screen_on:
            return "Sleeping"
        return "Idle"
    if steps < 40 and movement < 0.4:
        return "Sitting"
    if steps < 80:
        return "Walking"
    return "Active"


def activity_appropriateness(activity: str, hour: int) -> float:
    """How well the activity fits the time of day — feeds the Sa component."""
    night = hour >= 22 or hour < 6
    if night:
        return {"Sleeping": 1.0, "Idle": 0.8, "Sitting": 0.6, "Walking": 0.5, "Active": 0.4}.get(activity, 0.7)
    return {"Walking": 1.0, "Active": 1.0, "Sitting": 0.9, "Idle": 0.7, "Sleeping": 0.5}.get(activity, 0.7)


def activity_score(samples: list[tuple[str, int]]) -> float:
    """Mean appropriateness over recent (activity, hour) samples."""
    if not samples:
        return 0.8
    return round(sum(activity_appropriateness(a, h) for a, h in samples) / len(samples), 3)
