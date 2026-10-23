"""Daily Trend Analyzer — compares today's component scores with the previous day (report §5.1.6)."""

LABELS = {
    "activity_score": "Activity",
    "schedule_score": "Schedule adherence",
    "sound_score": "Sound safety",
    "location_score": "Location safety",
    "device_score": "Device behaviour",
}


def analyze_daily_trend(today: dict, yesterday: dict | None, threshold: float = 0.2) -> list[dict]:
    if not yesterday:
        return []
    trends = []
    for key, label in LABELS.items():
        if key not in today or key not in yesterday:
            continue
        delta = today[key] - yesterday[key]
        if abs(delta) >= threshold:
            trends.append({
                "metric": key,
                "direction": "up" if delta > 0 else "down",
                "delta": round(delta, 2),
                "level": "info" if delta > 0 else "warning",
                "title": f"{label} {'improved' if delta > 0 else 'dropped'}",
                "message": f"{label} {'rose' if delta > 0 else 'fell'} from {yesterday[key]:.2f} to {today[key]:.2f} versus yesterday",
            })
    return trends
