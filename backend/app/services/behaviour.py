"""Behaviour Service — compares today's observations against the previous day (report §4.1.2)."""

COMPARED = ("activity_score", "schedule_score", "location_score", "device_score", "sound_score",
            "trust_score", "steps", "screen_minutes", "avg_db")


def get_behaviour_record(today: dict | None, yesterday: dict | None) -> dict:
    today = today or {}
    yesterday = yesterday or {}
    deltas = {}
    for key in COMPARED:
        if key in today and key in yesterday and yesterday[key] is not None:
            deltas[key] = round(float(today[key]) - float(yesterday[key]), 3)
    return {"today": today, "yesterday": yesterday, "deltas": deltas, "has_baseline": bool(yesterday)}
