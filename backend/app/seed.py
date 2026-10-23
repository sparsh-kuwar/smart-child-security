"""Creates a child with sensible defaults and back-fills simulated history so dashboards aren't empty.

Back-filled rows are flagged `simulated=True` and the UI labels them as such.
"""
import random
import secrets
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import DEMO_EMAIL, DEMO_PASSWORD
from .db import local_date, local_day_start_utc, to_local, utcnow
from .ml.schedule_optimizer import DEFAULT_SCHEDULE
from .ml.trust_score import calculate_trust_score
from .models import Alert, Attendance, Child, DailySummary, DeviceUsage, RfidTag, ScheduleItem, TrustSnapshot, User, Zone
from .security import hash_password, new_device_key

# Pune — the coordinates the group's original prototype used.
HOME = (18.5204, 73.8567)
SCHOOL = (18.5300, 73.8500)


def new_tag_uid() -> str:
    return ":".join(f"{b:02X}" for b in secrets.token_bytes(4))


def create_child(db: Session, parent: User, name: str, *, age=10, grade="Grade 5", school="City Public School",
                 home=HOME, school_pos=SCHOOL, history_days=14) -> Child:
    child = Child(parent_id=parent.id, name=name, age=age, grade=grade, school=school,
                  student_code=f"STU-{secrets.randbelow(9000) + 1000}", device_key=new_device_key(),
                  simulator_enabled=True, settings={})
    db.add(child)
    db.flush()
    db.add_all([
        Zone(child_id=child.id, name="Home", kind="home", lat=home[0], lon=home[1], radius_m=200),
        Zone(child_id=child.id, name="School", kind="school", lat=school_pos[0], lon=school_pos[1], radius_m=300),
        Zone(child_id=child.id, name="School bus route", kind="route", lat=home[0], lon=home[1],
             lat2=school_pos[0], lon2=school_pos[1], radius_m=180),
        RfidTag(child_id=child.id, uid=new_tag_uid(), label="School ID card"),
    ])
    for t, title, kind, prio in DEFAULT_SCHEDULE:
        db.add(ScheduleItem(child_id=child.id, time=t, title=title, kind=kind, priority=prio))
    db.flush()
    if history_days:
        backfill_history(db, child, history_days)
    db.commit()
    db.refresh(child)
    return child


def backfill_history(db: Session, child: Child, days: int):
    rng = random.Random(child.id * 31)
    now = utcnow()
    for back in range(days, 0, -1):
        day_ts = now - timedelta(days=back)
        date = local_date(day_ts)
        weekend = to_local(day_ts).weekday() >= 5
        bad_day = rng.random() < 0.18
        screen = rng.uniform(150, 300) + (rng.uniform(80, 160) if bad_day or weekend else 0)
        night = rng.uniform(5, 40) + (rng.uniform(30, 60) if bad_day else 0)
        study = rng.uniform(70, 150) * (0.5 if weekend else 1)
        gaming = rng.uniform(30, 110) + (60 if weekend else 0)
        unlocks = int(screen / 4.5)
        db.add(DeviceUsage(child_id=child.id, date=date, screen_minutes=round(screen), night_minutes=round(night),
                           gaming_minutes=round(gaming), study_minutes=round(study), unlocks=unlocks))
        dev = 1.0 - 0.2 * (screen > 360) - 0.2 * (night > 60) - 0.1 * (unlocks > 80) - 0.2 * (gaming > study)
        comps = {
            "activity": round(rng.uniform(0.78, 0.95) - (0.15 if bad_day else 0), 3),
            "schedule": round(rng.choice([1.0, 0.9, 0.8, 0.7]) - (0.2 if bad_day else 0), 3),
            "location": round(rng.uniform(0.93, 1.0) - (0.25 if bad_day and rng.random() < 0.5 else 0), 3),
            "device": round(max(0.0, dev), 3),
            "sound": round(rng.uniform(0.92, 1.0) - (0.2 if bad_day and rng.random() < 0.5 else 0), 3),
        }
        trust = calculate_trust_score(comps)
        arrival = None
        if not weekend:
            mins = 8 * 60 + 30 + int(rng.gauss(-8, 7))
            arrival = f"{mins // 60:02d}:{mins % 60:02d}"
            arr_ts = local_day_start_utc(day_ts) + timedelta(minutes=mins)
            tag = child.tags[0].uid if child.tags else "00:00:00:00"
            db.add(Attendance(child_id=child.id, device_child_id=child.id, ts=arr_ts, tag_uid=tag,
                              status="accepted", direction="in", zone_name="School", lat=SCHOOL[0], lon=SCHOOL[1]))
            db.add(Attendance(child_id=child.id, device_child_id=child.id, ts=arr_ts + timedelta(hours=6, minutes=rng.randint(0, 20)),
                              tag_uid=tag, status="accepted", direction="out", zone_name="School", lat=SCHOOL[0], lon=SCHOOL[1]))
        n_alerts = rng.randint(1, 4) + (3 if bad_day else 0)
        crit = 1 if bad_day and rng.random() < 0.6 else 0
        steps = int(rng.uniform(6500, 11000) * (0.7 if bad_day else 1))
        db.add(DailySummary(
            child_id=child.id, date=date, simulated=True,
            activity_score=comps["activity"], schedule_score=comps["schedule"], location_score=comps["location"],
            device_score=comps["device"], sound_score=comps["sound"], trust_score=trust, steps=steps,
            avg_db=round(rng.uniform(48, 58), 1), max_db=round(rng.uniform(76, 94 if bad_day else 84), 1),
            loud_events=rng.randint(2, 14), very_loud_events=1 if comps["sound"] < 0.85 else 0,
            alerts=n_alerts, critical_alerts=crit, in_zone_pct=round(comps["location"] * 100, 1),
            screen_minutes=round(screen), arrival=arrival,
            activity_mix={"Sleeping": 520, "Idle": rng.randint(150, 260), "Sitting": rng.randint(300, 420),
                          "Walking": rng.randint(90, 180), "Active": rng.randint(40, 120)},
            sound_mix={"Quiet": rng.randint(500, 700), "Normal": rng.randint(400, 600),
                       "Loud": rng.randint(20, 90), "Very Loud": rng.randint(0, 6)},
        ))
        if bad_day:
            db.add(Alert(child_id=child.id, ts=local_day_start_utc(day_ts) + timedelta(hours=21, minutes=40),
                         level="warning", category="device", key=f"device_night_{date}", title="Late-night usage",
                         message=f"{int(night)} min of device use after 22:00 (limit 60)", acknowledged=True))
        if crit:
            db.add(Alert(child_id=child.id, ts=local_day_start_utc(day_ts) + timedelta(hours=16, minutes=12),
                         level="critical", category="location", key="outside_long",
                         title=f"{child.name} outside safe zones for 10+ min",
                         message="Detected on the walk back from tuition; resolved after 14 minutes.",
                         lat=SCHOOL[0] + 0.006, lon=SCHOOL[1] - 0.004, acknowledged=True))
    # Today's gate entry, if school has already started — so a freshly started demo doesn't look late.
    local_now = to_local(now)
    if local_now.weekday() < 5 and local_now.hour * 60 + local_now.minute > 8 * 60 + 30 and child.tags:
        arr_ts = local_day_start_utc(now) + timedelta(minutes=8 * 60 + 22 + rng.randint(0, 6))
        db.add(Attendance(child_id=child.id, device_child_id=child.id, ts=arr_ts, tag_uid=child.tags[0].uid,
                          status="accepted", direction="in", zone_name="School", lat=SCHOOL[0], lon=SCHOOL[1]))
    # Trust trend for the last 6 hours so the chart has shape before live data arrives.
    for i in range(72, 0, -1):
        ts = now - timedelta(minutes=5 * i)
        wobble = 0.05 * random.Random(i).random()
        comps = {"activity": 0.85 - wobble, "schedule": 0.9, "location": 1.0 if i % 23 else 0.3,
                 "device": 0.8, "sound": 1.0 if i % 17 else 0.8}
        db.add(TrustSnapshot(child_id=child.id, ts=ts, score=calculate_trust_score(comps), **comps))


def ensure_demo(db: Session):
    user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
    if user:
        return
    user = User(email=DEMO_EMAIL, name="Demo Parent", phone="", password_hash=hash_password(DEMO_PASSWORD))
    db.add(user)
    db.flush()
    create_child(db, user, "Aarav", age=10, grade="Grade 5", school="RSCOE Demo School")
