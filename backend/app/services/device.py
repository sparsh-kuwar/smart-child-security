"""Device Service — screen duration, night-time use, gaming, study and unlock count (report §4.1.2)."""

FIELDS = ("screen_minutes", "night_minutes", "gaming_minutes", "study_minutes", "unlocks")


def get_device_record(usage: dict | None) -> dict:
    usage = usage or {}
    record = {}
    for f in FIELDS:
        try:
            v = float(usage.get(f) or 0)
        except (TypeError, ValueError):
            v = 0.0
        record[f] = max(0.0, v)
    record["unlocks"] = int(record["unlocks"])
    record["other_minutes"] = max(0.0, record["screen_minutes"] - record["gaming_minutes"] - record["study_minutes"])
    return record
