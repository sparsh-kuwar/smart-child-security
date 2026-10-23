"""Ambient Sound Service — estimated intensity, category, timestamp and rolling average (report §4.1.2).

Privacy by design: this service only ever accepts a single numeric dB estimate.
There is no code path that accepts, stores or forwards audio samples.
"""
from datetime import datetime

from ..ml.sound_classifier import classify_db, persistence


def parse_db(value) -> float | None:
    try:
        db = float(value)
    except (TypeError, ValueError):
        return None
    if db != db or db < 0 or db > 140:  # NaN / disconnected sensor / out of physical range
        return None
    return round(db, 1)


def get_sound_record(
    db,
    ts: datetime,
    window: list[tuple[datetime, float]],
    very_loud_db: float = 85,
    persist_seconds: float = 60,
) -> dict:
    """window: previous (ts, dB) readings within the rolling window, oldest first."""
    value = parse_db(db)
    series = [(t, d) for t, d in window if d is not None]
    if value is not None:
        series.append((ts, value))
    rolling = round(sum(d for _, d in series) / len(series), 1) if series else None
    run_seconds, transient_suppressed = persistence(series, very_loud_db, persist_seconds)
    return {
        "db": value,
        "category": classify_db(value) if value is not None else None,
        "rolling_avg": rolling,
        "rolling_category": classify_db(rolling) if rolling is not None else None,
        "very_loud_run_seconds": run_seconds,
        "sustained_very_loud": run_seconds >= persist_seconds,
        "transient_suppressed": transient_suppressed,
        "sensor_ok": value is not None,
        "timestamp": ts,
    }
