"""Read-side endpoints for the parent dashboard: live state, trust, sound, device, schedule, history, SSE."""
import asyncio
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import simulator
from ..analytics import child_settings, evaluate, sound_state, zone_dicts
from ..db import SessionLocal, get_db, iso, local_day_start_utc, to_local, utcnow
from ..ml import schedule_optimizer
from ..ml.behaviour_analysis import compare_with_history
from ..ml.daily_trends import analyze_daily_trend
from ..ml.history_aggregator import aggregate
from ..ml.safe_zone import check_safe_zone
from ..ml.trust_score import calculate_trust_score, explain, trust_band
from ..models import Alert, Attendance, Reading, ScheduleItem, TrustSnapshot, User
from ..pipeline import alert_json
from ..realtime import hub
from ..security import current_user, owned_child
from ..services.behaviour import get_behaviour_record
from ..summaries import recent_days, refresh_today, summary_json
from .children import child_json, zone_json

router = APIRouter(prefix="/api", tags=["insights"])


def reading_json(r: Reading) -> dict:
    return {"ts": iso(r.ts), "lat": r.lat, "lon": r.lon, "fix": r.gps_fix, "stale": r.gps_stale,
            "activity": r.activity, "steps": r.steps, "movement": r.movement, "screen_on": r.screen_on,
            "sound_db": r.sound_db, "sound_category": r.sound_category, "sound_rolling": r.sound_rolling,
            "zone": r.zone_name, "inside": r.inside_zone, "distance_m": r.distance_m,
            "location_score": r.location_score, "sos": r.sos, "source": r.source}


def _latest(db: Session, child_id: int) -> Reading | None:
    return db.scalar(select(Reading).where(Reading.child_id == child_id).order_by(Reading.ts.desc()).limit(1))


@router.get("/children/{child_id}/live")
def live(child_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    now = utcnow()
    r = _latest(db, c.id)
    sound = sound_state(db, c, r)
    ev = evaluate(db, c, r.ts if r else now, r.location_score if r else 1.0, sound)
    trail = db.execute(select(Reading.ts, Reading.lat, Reading.lon).where(
        Reading.child_id == c.id, Reading.ts > now - timedelta(minutes=10), Reading.lat.is_not(None))
        .order_by(Reading.ts)).all()
    sound_series = db.execute(select(Reading.ts, Reading.sound_db, Reading.sound_rolling).where(
        Reading.child_id == c.id, Reading.ts > now - timedelta(minutes=5)).order_by(Reading.ts)).all()
    att = db.scalars(select(Attendance).where(Attendance.child_id == c.id, Attendance.status == "accepted",
                                              Attendance.ts >= local_day_start_utc(now)).order_by(Attendance.ts)).all()
    unacked = db.scalar(select(func.count(Alert.id)).where(Alert.child_id == c.id, Alert.acknowledged.is_(False)))
    recent_alerts = db.scalars(select(Alert).where(Alert.child_id == c.id).order_by(Alert.ts.desc()).limit(6)).all()
    zone = check_safe_zone(r.lat, r.lon, zone_dicts(c)) if r else None
    outside_since = None
    if r and not r.inside_zone:
        outside_since = db.scalar(select(func.max(Reading.ts)).where(Reading.child_id == c.id, Reading.inside_zone.is_(True)))
    return {
        "child": child_json(c),
        "reading": reading_json(r) if r else None,
        "zone": zone,
        "outside_since": iso(outside_since),
        "sound": {k: v for k, v in sound.items() if k != "timestamp"},
        "trust": {k: ev[k] for k in ("trust", "band", "label", "components", "explain")},
        "device": {"usage": ev["device"], **ev["device_eval"]},
        "schedule": ev["schedule"],
        "trail": [{"ts": iso(t), "lat": la, "lon": lo} for t, la, lo in trail],
        "sound_series": [{"ts": iso(t), "db": d, "rolling": ro} for t, d, ro in sound_series],
        "attendance_today": [{"ts": iso(a.ts), "direction": a.direction, "zone": a.zone_name} for a in att],
        "zones": [zone_json(z) for z in c.zones],
        "unacked_alerts": unacked,
        "recent_alerts": [alert_json(a) for a in recent_alerts],
        "simulator": {"enabled": c.simulator_enabled, **simulator.scenario_status(c.id)},
        "server_time": iso(now),
    }


@router.get("/children/{child_id}/readings")
def readings(child_id: int, minutes: int = 60, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    minutes = max(1, min(minutes, 24 * 60))
    rows = db.scalars(select(Reading).where(Reading.child_id == c.id, Reading.ts > utcnow() - timedelta(minutes=minutes))
                      .order_by(Reading.ts)).all()
    step = max(1, len(rows) // 600)  # cap payload size
    return [reading_json(r) for r in rows[::step]]


@router.get("/children/{child_id}/trust")
def trust(child_id: int, hours: int = 24, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    r = _latest(db, c.id)
    sound = sound_state(db, c, r)
    ev = evaluate(db, c, r.ts if r else utcnow(), r.location_score if r else 1.0, sound)
    snaps = db.scalars(select(TrustSnapshot).where(TrustSnapshot.child_id == c.id,
                                                   TrustSnapshot.ts > utcnow() - timedelta(hours=min(hours, 168)))
                       .order_by(TrustSnapshot.ts)).all()
    step = max(1, len(snaps) // 400)
    return {
        "current": {k: ev[k] for k in ("trust", "band", "label", "components", "explain")},
        "history": [{"ts": iso(s.ts), "score": s.score, "activity": s.activity, "schedule": s.schedule,
                     "location": s.location, "device": s.device, "sound": s.sound} for s in snaps[::step]],
        "formula": "T = 100 × (0.25·Sa + 0.20·Ss + 0.25·Sl + 0.15·Sd + 0.15·Sn)",
    }


class WhatIf(BaseModel):
    activity: float = Field(ge=0, le=1)
    schedule: float = Field(ge=0, le=1)
    location: float = Field(ge=0, le=1)
    device: float = Field(ge=0, le=1)
    sound: float = Field(ge=0, le=1)


@router.post("/trust/calculate")
def trust_calculate(body: WhatIf):
    comps = body.model_dump()
    score = calculate_trust_score(comps)
    return {"trust": score, **trust_band(score), "explain": explain(comps)}


@router.get("/children/{child_id}/sound")
def sound(child_id: int, minutes: int = 30, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    minutes = max(1, min(minutes, 24 * 60))
    rows = db.execute(select(Reading.ts, Reading.sound_db, Reading.sound_category, Reading.sound_rolling)
                      .where(Reading.child_id == c.id, Reading.ts > utcnow() - timedelta(minutes=minutes))
                      .order_by(Reading.ts)).all()
    mix: dict[str, int] = {}
    for _, _, cat, _ in rows:
        if cat:
            mix[cat] = mix.get(cat, 0) + 1
    events = db.scalars(select(Alert).where(Alert.child_id == c.id, Alert.category == "sound")
                        .order_by(Alert.ts.desc()).limit(30)).all()
    step = max(1, len(rows) // 600)
    return {
        "current": {k: v for k, v in sound_state(db, c, _latest(db, c.id)).items() if k != "timestamp"},
        "series": [{"ts": iso(t), "db": d, "category": cat, "rolling": ro} for t, d, cat, ro in rows[::step]],
        "mix": mix,
        "events": [alert_json(a) for a in events],
        "thresholds": {"quiet": 50, "normal": 70, "loud": 85,
                       "persist_seconds": child_settings(c)["very_loud_persist_seconds"],
                       "window_seconds": child_settings(c)["sound_window_seconds"]},
    }


@router.get("/children/{child_id}/device")
def device(child_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    r = _latest(db, c.id)
    ev = evaluate(db, c, r.ts if r else utcnow(), r.location_score if r else 1.0, sound_state(db, c, r))
    s = child_settings(c)
    days = recent_days(db, c, 14)
    return {
        "usage": ev["device"], "score": ev["device_eval"]["score"], "violations": ev["device_eval"]["violations"],
        "limits": {"screen": s["screen_limit_minutes"], "night": s["night_limit_minutes"], "unlocks": s["unlock_limit"]},
        "activity_counts": ev["activity_counts"],
        "history": [{"date": d.date, "screen_minutes": d.screen_minutes, "device_score": d.device_score} for d in days],
        "status": child_json(c),
    }


@router.get("/children/{child_id}/schedule")
def schedule(child_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    items = [{"id": i.id, "time": i.time, "title": i.title, "kind": i.kind, "priority": i.priority}
             for i in db.scalars(select(ScheduleItem).where(ScheduleItem.child_id == c.id).order_by(ScheduleItem.time))]
    r = _latest(db, c.id)
    now = utcnow()
    ev = evaluate(db, c, r.ts if r else now, r.location_score if r else 1.0, sound_state(db, c, r))
    local = to_local(now)
    return {
        "items": items,
        "periods": schedule_optimizer.group_by_period(items),
        "now": schedule_optimizer.current_recommendation(items, local),
        "adherence": ev["schedule"],
        "reminders": schedule_optimizer.smart_reminders(local, ev["device"], ev["activity_counts"], child_settings(c)),
        "local_time": local.strftime("%H:%M"),
    }


class ScheduleItemIn(BaseModel):
    time: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    title: str = Field(min_length=1, max_length=120)
    kind: str = Field(default="routine", max_length=20)
    priority: str = Field(default="medium", pattern="^(high|medium|low)$")


@router.put("/children/{child_id}/schedule")
def put_schedule(child_id: int, body: list[ScheduleItemIn], user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    if len(body) > 40:
        raise HTTPException(400, "Up to 40 schedule items")
    for i in db.scalars(select(ScheduleItem).where(ScheduleItem.child_id == c.id)):
        db.delete(i)
    for it in body:
        db.add(ScheduleItem(child_id=c.id, **it.model_dump()))
    db.commit()
    return {"ok": True, "count": len(body)}


@router.get("/children/{child_id}/history")
def history(child_id: int, days: int = 14, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    refresh_today(db, c)
    rows = [summary_json(d) for d in recent_days(db, c, max(2, min(days, 60)))]
    today = rows[-1] if rows else None
    yesterday = rows[-2] if len(rows) > 1 else None
    return {
        "days": rows,
        "aggregate": aggregate(rows),
        "trends": analyze_daily_trend(today, yesterday) if today else [],
        "behaviour": get_behaviour_record(today, yesterday),
        "unusual": compare_with_history(today, rows[:-1]) if today else [],
    }


@router.get("/children/{child_id}/stream")
async def stream(child_id: int, request: Request):
    # Authenticate with a short-lived session; an SSE connection must not pin a DB connection.
    with SessionLocal() as db:
        owned_child(child_id, current_user(request, db), db)
    q = hub.subscribe(child_id)

    async def gen():
        try:
            yield "retry: 3000\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15)
                    yield msg
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            hub.unsubscribe(child_id, q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
