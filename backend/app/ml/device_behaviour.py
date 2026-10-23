"""Device Behaviour Model — threshold-based scoring starting at 1.0 (report §5.1.6)."""


def analyze_device_behaviour(record: dict, screen_limit=360, night_limit=60, unlock_limit=80) -> dict:
    score = 1.0
    violations = []

    if record["screen_minutes"] > screen_limit:
        score -= 0.2
        violations.append({"key": "screen", "title": "High screen time",
                           "detail": f"{int(record['screen_minutes'])} min (limit {screen_limit})"})
    if record["night_minutes"] > night_limit:
        score -= 0.2
        violations.append({"key": "night", "title": "Late-night usage",
                           "detail": f"{int(record['night_minutes'])} min (limit {night_limit})"})
    if record["unlocks"] > unlock_limit:
        score -= 0.1
        violations.append({"key": "unlocks", "title": "Excessive unlocks",
                           "detail": f"{record['unlocks']} unlocks (limit {unlock_limit})"})
    if record["gaming_minutes"] > record["study_minutes"] and record["gaming_minutes"] > 30:
        score -= 0.2
        violations.append({"key": "gaming", "title": "Gaming exceeds study",
                           "detail": f"{int(record['gaming_minutes'])} vs {int(record['study_minutes'])} min"})

    return {"score": round(max(score, 0.0), 2), "violations": violations}
