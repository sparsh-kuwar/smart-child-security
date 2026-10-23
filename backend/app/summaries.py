"""Builds the per-day summary rows consumed by the History Aggregator and Daily Trend Analyzer."""
from collections import Counter
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .db import local_date, local_day_start_utc, to_local, utcnow
from .models import Alert, Attendance, Child, DailySummary, DeviceUsage, Reading, TrustSnapshot


def summary_json(d: DailySummary) -> dict:
    return {c: getattr(d, c) for c in (
        "date", "simulated", "activity_score", "schedule_score", "location_score", "device_score", "sound_score",
        "trust_score", "steps", "avg_db", "max_db", "loud_events", "very_loud_events", "alerts", "critical_alerts",
        "in_zone_pct", "screen_minutes", "arrival", "activity_mix", "sound_mix")}


def refresh_today(db: Session, child: Child) -> DailySummary | None:
    now = utcnow()
    start = local_day_start_utc(now)
    date = local_date(now)
    readings = db.execute(select(Reading.steps, Reading.sound_db, Reading.sound_category, Reading.inside_zone,
                                 Reading.activity, Reading.source)
                          .where(Reading.child_id == child.id, Reading.ts >= start)).all()
    if not readings:
        return None
    snaps = db.execute(select(func.avg(TrustSnapshot.score), func.avg(TrustSnapshot.activity),
                              func.avg(TrustSnapshot.schedule), func.avg(TrustSnapshot.location),
                              func.avg(TrustSnapshot.device), func.avg(TrustSnapshot.sound))
                       .where(TrustSnapshot.child_id == child.id, TrustSnapshot.ts >= start)).first()
    alerts = db.execute(select(Alert.level, Alert.key).where(Alert.child_id == child.id, Alert.ts >= start)).all()
    usage = db.scalar(select(DeviceUsage).where(DeviceUsage.child_id == child.id, DeviceUsage.date == date))
    arrival = db.scalar(select(Attendance.ts).where(
        Attendance.child_id == child.id, Attendance.status == "accepted", Attendance.direction == "in",
        Attendance.ts >= start).order_by(Attendance.ts).limit(1))

    dbs = [r.sound_db for r in readings if r.sound_db is not None]
    row = db.scalar(select(DailySummary).where(DailySummary.child_id == child.id, DailySummary.date == date))
    if not row:
        row = DailySummary(child_id=child.id, date=date)
        db.add(row)
    row.simulated = Counter(r.source for r in readings).most_common(1)[0][0] == "simulator"
    if snaps and snaps[0] is not None:
        row.trust_score, row.activity_score, row.schedule_score, row.location_score, row.device_score, row.sound_score = (
            round(float(v), 3) for v in snaps)
        row.trust_score = round(row.trust_score, 1)
    row.steps = int(sum(r.steps for r in readings))
    row.avg_db = round(sum(dbs) / len(dbs), 1) if dbs else 0
    row.max_db = max(dbs) if dbs else 0
    row.loud_events = sum(1 for r in readings if r.sound_category == "Loud")
    row.very_loud_events = sum(1 for a in alerts if a.key in ("very_loud", "critical_combo"))
    row.alerts = len(alerts)
    row.critical_alerts = sum(1 for a in alerts if a.level == "critical")
    row.in_zone_pct = round(100 * sum(1 for r in readings if r.inside_zone) / len(readings), 1)
    row.screen_minutes = usage.screen_minutes if usage else 0
    row.arrival = to_local(arrival).strftime("%H:%M") if arrival else None
    row.activity_mix = dict(Counter(r.activity for r in readings))
    row.sound_mix = dict(Counter(r.sound_category for r in readings if r.sound_category))
    db.commit()
    return row


def recent_days(db: Session, child: Child, days: int) -> list[DailySummary]:
    cutoff = local_date(utcnow() - timedelta(days=days - 1))
    return list(db.scalars(select(DailySummary).where(DailySummary.child_id == child.id,
                                                      DailySummary.date >= cutoff).order_by(DailySummary.date)))
