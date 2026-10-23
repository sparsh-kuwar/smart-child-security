"""History Aggregator — multi-day summary of activity, device use, location and sound (report §5.1.6)."""


def aggregate(days: list[dict]) -> dict:
    if not days:
        return {"days": 0}
    n = len(days)

    def avg(k):
        return round(sum(d[k] for d in days) / n, 2)

    activity_mix: dict[str, float] = {}
    sound_mix: dict[str, float] = {}
    for d in days:
        for k, v in (d.get("activity_mix") or {}).items():
            activity_mix[k] = activity_mix.get(k, 0) + v
        for k, v in (d.get("sound_mix") or {}).items():
            sound_mix[k] = sound_mix.get(k, 0) + v

    def norm(mix):
        total = sum(mix.values()) or 1
        return {k: round(v / total, 3) for k, v in mix.items()}

    best = max(days, key=lambda d: d["trust_score"])
    worst = min(days, key=lambda d: d["trust_score"])
    return {
        "days": n,
        "avg_trust": avg("trust_score"),
        "avg_steps": int(avg("steps")),
        "avg_screen_minutes": avg("screen_minutes"),
        "avg_in_zone_pct": avg("in_zone_pct"),
        "avg_db": avg("avg_db"),
        "total_alerts": sum(d["alerts"] for d in days),
        "total_critical": sum(d["critical_alerts"] for d in days),
        "very_loud_events": sum(d["very_loud_events"] for d in days),
        "best_day": {"date": best["date"], "trust_score": best["trust_score"]},
        "worst_day": {"date": worst["date"], "trust_score": worst["trust_score"]},
        "activity_mix": norm(activity_mix),
        "sound_mix": norm(sound_mix),
        "components": {k: avg(k) for k in ("activity_score", "schedule_score", "location_score",
                                             "device_score", "sound_score")},
    }
