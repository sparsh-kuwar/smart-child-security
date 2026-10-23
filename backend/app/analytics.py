"""Shared evaluation used both when a reading is ingested and when the dashboard asks for state."""
from collections import Counter
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import DEFAULT_SETTINGS
from .db import local_date, local_day_start_utc, to_local, utcnow
from .ml.activity_classifier import activity_score
from .ml.device_behaviour import analyze_device_behaviour
from .ml.sound_classifier import sound_safety_score
from .ml.trust_score import calculate_trust_score, explain, trust_band
from .models import Attendance, Child, DeviceUsage, Reading
from .services.device import get_device_record
from .services.schedule import get_schedule_record
from .services.sound import get_sound_record


def child_settings(child: Child) -> dict:
    return {**DEFAULT_SETTINGS, **(child.settings or {})}


def zone_dicts(child: Child) -> list[dict]:
    return [{"id": z.id, "name": z.name, "kind": z.kind, "lat": z.lat, "lon": z.lon, "radius_m": z.radius_m,
             "lat2": z.lat2, "lon2": z.lon2}
            for z in child.zones if z.active]


def sound_window(db: Session, child_id: int, before: datetime, seconds: float) -> list[tuple[datetime, float]]:
    rows = db.execute(
        select(Reading.ts, Reading.sound_db)
        .where(Reading.child_id == child_id, Reading.ts < before,
               Reading.ts > before - timedelta(seconds=seconds))
        .order_by(Reading.ts)
    ).all()
    return [(t, d) for t, d in rows]


def sound_state(db: Session, child: Child, reading: Reading | None) -> dict:
    s = child_settings(child)
    if reading is None:
        return get_sound_record(None, utcnow(), [], s["very_loud_db"], s["very_loud_persist_seconds"])
    window = sound_window(db, child.id, reading.ts, s["sound_window_seconds"])
    return get_sound_record(reading.sound_db, reading.ts, window, s["very_loud_db"], s["very_loud_persist_seconds"])


def usage_today(db: Session, child: Child, ts: datetime) -> dict:
    row = db.scalar(select(DeviceUsage).where(DeviceUsage.child_id == child.id,
                                              DeviceUsage.date == local_date(ts)))
    return get_device_record({
        "screen_minutes": row.screen_minutes, "night_minutes": row.night_minutes,
        "gaming_minutes": row.gaming_minutes, "study_minutes": row.study_minutes, "unlocks": row.unlocks,
    } if row else None)


def arrival_today(db: Session, child: Child, ts: datetime) -> datetime | None:
    return db.scalar(
        select(Attendance.ts)
        .where(Attendance.child_id == child.id, Attendance.status == "accepted", Attendance.direction == "in",
               Attendance.ts >= local_day_start_utc(ts))
        .order_by(Attendance.ts).limit(1)
    )


def recent_activity(db: Session, child_id: int, ts: datetime, minutes: int = 30) -> list[str]:
    return list(db.scalars(
        select(Reading.activity).where(Reading.child_id == child_id, Reading.ts <= ts,
                                       Reading.ts > ts - timedelta(minutes=minutes))
    ))


def evaluate(db: Session, child: Child, ts: datetime, location_score: float, sound: dict) -> dict:
    """Computes all five Trust Score components (Sa, Ss, Sl, Sd, Sn) plus supporting detail."""
    s = child_settings(child)
    hour = to_local(ts).hour
    acts = recent_activity(db, child.id, ts)
    sa = activity_score([(a, hour) for a in acts])

    device = usage_today(db, child, ts)
    dev_eval = analyze_device_behaviour(device, s["screen_limit_minutes"], s["night_limit_minutes"], s["unlock_limit"])

    schedule = get_schedule_record(
        now=ts, school_start=s["school_start"], arrival_ts=arrival_today(db, child, ts),
        study_minutes=device["study_minutes"], study_target_hours=s["study_target_hours"],
        night_minutes=device["night_minutes"], night_limit=s["night_limit_minutes"],
        weekday=to_local(ts).weekday() < 5,
    )
    comps = {
        "activity": sa,
        "schedule": schedule["adherence"],
        "location": round(location_score, 3),
        "device": dev_eval["score"],
        "sound": sound_safety_score(sound),
    }
    trust = calculate_trust_score(comps)
    return {
        "components": comps,
        "trust": trust,
        **trust_band(trust),
        "explain": explain(comps),
        "device": device,
        "device_eval": dev_eval,
        "schedule": schedule,
        "activity_counts": dict(Counter(acts)),
    }
