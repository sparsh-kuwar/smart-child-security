"""Ingestion pipeline: sensor record → six services → ML/analytics layer → alerts → cloud → device response.

Mirrors the four-layer architecture of report §4.1. Both the real ESP8266 device and the
built-in simulator call `process_reading`, so they exercise exactly the same code path.
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import notify
from .analytics import child_settings, evaluate, sound_window, zone_dicts
from .db import iso, local_date, local_day_start_utc, to_local, utcnow
from .ml import alert_analyzer
from .ml.activity_classifier import classify_activity
from .ml.safe_zone import STALE_SCORE, check_safe_zone
from .models import Alert, Attendance, Child, DeviceUsage, Reading, RfidTag, TrustSnapshot
from .realtime import hub
from .services.activity import get_activity_record
from .services.device import get_device_record
from .services.location import get_location_record
from .services.sound import get_sound_record

log = logging.getLogger("pipeline")
THINGSPEAK_MIN_INTERVAL = 16  # free ThingSpeak channels accept one update every 15 s


def _parse_ts(raw: dict, now: datetime) -> datetime:
    """Device may send `ts` (epoch seconds / ISO) or `age_s` (seconds ago, for buffered readings)."""
    ts = None
    if raw.get("age_s") is not None:
        try:
            ts = now - timedelta(seconds=float(raw["age_s"]))
        except (TypeError, ValueError):
            ts = None
    elif raw.get("ts") is not None:
        v = raw["ts"]
        try:
            if isinstance(v, (int, float)):
                ts = datetime.fromtimestamp(float(v), tz=timezone.utc).replace(tzinfo=None)
            else:
                parsed = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
                ts = parsed.astimezone(timezone.utc).replace(tzinfo=None) if parsed.tzinfo else parsed
        except (ValueError, OSError, OverflowError):
            ts = None
    if ts is None or ts > now + timedelta(seconds=60) or ts < now - timedelta(hours=24):
        return now
    return ts


def add_alert(db: Session, child: Child, cand: dict, ts: datetime, lat=None, lon=None) -> Alert | None:
    """Persist an alert unless the same key fired within its cooldown."""
    key = cand["key"][:60]
    recent = db.scalar(select(Alert.id).where(
        Alert.child_id == child.id, Alert.key == key,
        Alert.ts > ts - timedelta(seconds=cand.get("cooldown", 300)), Alert.ts <= ts + timedelta(seconds=5),
    ).limit(1))
    if recent:
        return None
    alert = Alert(child_id=child.id, ts=ts, level=cand["level"], category=cand["category"], key=key,
                  title=cand["title"], message=cand["message"], lat=lat, lon=lon, data=cand.get("data") or {})
    db.add(alert)
    db.flush()
    return alert


def alert_json(a: Alert) -> dict:
    return {"id": a.id, "ts": iso(a.ts), "level": a.level, "category": a.category, "title": a.title,
            "message": a.message, "lat": a.lat, "lon": a.lon, "acknowledged": a.acknowledged, "data": a.data}


def _fan_out(child: Child, alert: Alert):
    s = child_settings(child)
    payload = {"child": child.name, **alert_json(alert)}
    if alert.lat is not None:
        payload["map"] = f"https://maps.google.com/?q={alert.lat:.6f},{alert.lon:.6f}"
    notify.dispatch(notify.send_webhook, s["notify_webhook_url"], payload)
    if alert.level == "critical":
        phone = s["notify_sms_phone"] or child.parent.phone
        text = f"[SafeTrack] {alert.title}: {alert.message}"
        if "map" in payload:
            text += f" {payload['map']}"
        notify.dispatch(notify.send_sms, phone, text)


def process_rfid(db: Session, reader: Child, uid: str, ts: datetime, zone_name, lat, lon,
                 direction_hint: str | None = None) -> tuple[Attendance, dict | None]:
    """RFID attendance (report §5.1.2): reject unregistered tags, debounce duplicates.

    Gates with separate entry/exit readers send `rfid_dir`; otherwise scans alternate in/out per day.
    """
    uid = uid.strip().upper()[:32]
    tag = db.scalar(select(RfidTag).where(RfidTag.uid == uid))
    if not tag or not tag.active:
        att = Attendance(child_id=None, device_child_id=reader.id, ts=ts, tag_uid=uid, status="rejected",
                         zone_name=zone_name, lat=lat, lon=lon)
        db.add(att)
        return att, {"key": f"rfid_reject_{uid}", "level": "warning", "category": "attendance",
                     "title": "Unregistered RFID tag rejected",
                     "message": f"Tag {uid} is not registered — no attendance recorded.", "cooldown": 60}
    owner = db.get(Child, tag.child_id)
    debounce = child_settings(owner)["rfid_debounce_seconds"]
    last = db.scalar(select(Attendance).where(Attendance.tag_uid == uid, Attendance.status == "accepted")
                     .order_by(Attendance.ts.desc()).limit(1))
    if last and abs((ts - last.ts).total_seconds()) < debounce:
        att = Attendance(child_id=owner.id, device_child_id=reader.id, ts=ts, tag_uid=uid, status="duplicate",
                         zone_name=zone_name, lat=lat, lon=lon)
        db.add(att)
        return att, None
    today_last = last if last and last.ts >= local_day_start_utc(ts) else None
    if direction_hint in ("in", "out"):
        direction = direction_hint
    else:
        direction = "out" if today_last and today_last.direction == "in" else "in"
    att = Attendance(child_id=owner.id, device_child_id=reader.id, ts=ts, tag_uid=uid, status="accepted",
                     direction=direction, zone_name=zone_name, lat=lat, lon=lon)
    db.add(att)
    where = zone_name or "the reader"
    verb = "arrived at" if direction == "in" else "left"
    return att, {"key": f"rfid_{direction}_{att.ts:%H%M%S}", "level": "info", "category": "attendance",
                 "title": f"{owner.name} {verb} {where}",
                 "message": f"RFID attendance recorded at {to_local(ts):%H:%M} ({'entry' if direction == 'in' else 'exit'}).",
                 "cooldown": 1}


def _upsert_usage(db: Session, child: Child, ts: datetime, usage: dict):
    rec = get_device_record(usage)
    date = local_date(ts)
    row = db.scalar(select(DeviceUsage).where(DeviceUsage.child_id == child.id, DeviceUsage.date == date))
    if not row:
        row = DeviceUsage(child_id=child.id, date=date)
        db.add(row)
    row.screen_minutes = rec["screen_minutes"]
    row.night_minutes = rec["night_minutes"]
    row.gaming_minutes = rec["gaming_minutes"]
    row.study_minutes = rec["study_minutes"]
    row.unlocks = rec["unlocks"]


def process_reading(db: Session, child: Child, raw: dict, source: str = "device") -> dict:
    now = utcnow()
    ts = _parse_ts(raw, now)
    s = child_settings(child)
    new_alerts: list[Alert] = []

    def raise_alert(cand, lat=None, lon=None):
        a = add_alert(db, child, cand, ts, lat, lon)
        if a:
            new_alerts.append(a)

    # ---- device status -------------------------------------------------------------
    if source == "device" and child.last_seen and (now - child.last_seen).total_seconds() > s["offline_after_seconds"]:
        gap = (now - child.last_seen).total_seconds() / 60
        raise_alert({"key": "online", "level": "info", "category": "system", "title": "Device back online",
                     "message": f"Connection restored after {gap:.0f} min.", "cooldown": 60})
    if raw.get("event") == "boot":
        child.last_boot = ts
        raise_alert({"key": "boot", "level": "info", "category": "system", "title": "Device restarted",
                     "message": "Controller rebooted and resumed monitoring.", "cooldown": 30})
    child.last_seen = max(child.last_seen or ts, ts) if source == "device" else now
    child.data_source = source
    if raw.get("battery") is not None:
        try:
            child.battery = max(0.0, min(100.0, float(raw["battery"])))
        except (TypeError, ValueError):
            pass
    if raw.get("fw"):
        child.firmware = str(raw["fw"])[:40]

    # ---- service layer ---------------------------------------------------------------
    last = db.execute(
        select(Reading.lat, Reading.lon, Reading.ts)
        .where(Reading.child_id == child.id, Reading.gps_fix.is_(True), Reading.ts <= ts)
        .order_by(Reading.ts.desc()).limit(1)
    ).first()
    last_valid = {"latitude": last[0], "longitude": last[1], "timestamp": last[2]} if last else None
    loc = get_location_record(raw, ts, last_valid)
    act = get_activity_record(raw, ts)
    sound = get_sound_record(raw.get("sound_db"), ts, sound_window(db, child.id, ts, s["sound_window_seconds"]),
                             s["very_loud_db"], s["very_loud_persist_seconds"])
    if isinstance(raw.get("usage"), dict):
        _upsert_usage(db, child, ts, raw["usage"])

    # ---- ML / analytics layer ----------------------------------------------------------
    activity = classify_activity(act)
    zone = check_safe_zone(loc["latitude"], loc["longitude"], zone_dicts(child))
    loc_score = zone["safety_score"]
    if loc["stale"] and (loc["stale_seconds"] or 0) >= s["gps_stale_seconds"]:
        loc_score = min(loc_score, STALE_SCORE)

    outside_seconds = 0
    if not zone["inside"] and not zone["unknown"]:
        last_in = db.scalar(select(func.max(Reading.ts)).where(
            Reading.child_id == child.id, Reading.inside_zone.is_(True), Reading.ts < ts))
        since = last_in or db.scalar(select(func.min(Reading.ts)).where(Reading.child_id == child.id)) or ts
        outside_seconds = max(0, (ts - since).total_seconds())

    reading = Reading(
        child_id=child.id, ts=ts, source=source, lat=loc["latitude"], lon=loc["longitude"],
        gps_fix=loc["fix"], gps_stale=loc["stale"], satellites=loc["satellites"],
        steps=act["steps"], movement=act["movement_level"], screen_on=act["screen_on"], activity=activity,
        sound_db=sound["db"], sound_category=sound["category"], sound_rolling=sound["rolling_avg"],
        zone_name=zone["zone"], inside_zone=zone["inside"] or zone["unknown"], distance_m=zone["distance_m"],
        location_score=loc_score, sos=bool(raw.get("sos")),
    )
    db.add(reading)
    db.flush()

    attendance = None
    if raw.get("rfid_uid"):
        attendance, cand = process_rfid(db, child, str(raw["rfid_uid"]), ts, zone["zone"], loc["latitude"],
                                        loc["longitude"], raw.get("rfid_dir"))
        if cand:
            target = db.get(Child, attendance.child_id) if attendance.child_id else child
            a = add_alert(db, target, cand, ts, loc["latitude"], loc["longitude"])
            if a and target.id == child.id:
                new_alerts.append(a)
            elif a:
                _fan_out(target, a)
                hub.publish(target.id, "alert", alert_json(a))
        db.flush()

    ev = evaluate(db, child, ts, loc_score, sound)

    last_snap = db.scalar(select(func.max(TrustSnapshot.ts)).where(TrustSnapshot.child_id == child.id))
    if not last_snap or (ts - last_snap).total_seconds() >= 60:
        c = ev["components"]
        db.add(TrustSnapshot(child_id=child.id, ts=ts, score=ev["trust"], activity=c["activity"],
                             schedule=c["schedule"], location=c["location"], device=c["device"], sound=c["sound"]))

    place = (f"{loc['latitude']:.5f}, {loc['longitude']:.5f}" if loc["latitude"] is not None else "unknown")
    candidates = alert_analyzer.analyze({
        "child": child.name, "location": loc, "zone": zone, "outside_seconds": outside_seconds,
        "sound": sound, "sos": reading.sos, "trust": ev["trust"], "settings": s, "place": place,
        "device_violations": ev["device_eval"]["violations"],
    })
    date = local_date(ts)
    for cand in candidates:
        if cand["category"] == "device":
            cand["key"] = f"{cand['key']}_{date}"
        raise_alert(cand, loc["latitude"], loc["longitude"])

    # ---- response / actuation ---------------------------------------------------------
    recent_critical = db.scalar(select(func.count(Alert.id)).where(
        Alert.child_id == child.id, Alert.level == "critical", Alert.acknowledged.is_(False),
        Alert.ts > now - timedelta(seconds=120)))
    commands = list(child.pending_commands or [])
    child.pending_commands = []
    buzzer = bool(recent_critical) or reading.sos or any(c.get("type") == "buzz" for c in commands)
    if recent_critical or reading.sos:
        led = "red"
    elif not zone["inside"] or loc["stale"] or any(a.level == "warning" for a in new_alerts):
        led = "amber"
    else:
        led = "green"

    worst = max((a.level for a in new_alerts), key=lambda l: {"info": 1, "warning": 2, "critical": 3}[l], default=None)
    if s["thingspeak_write_key"] and (not child.last_thingspeak or (now - child.last_thingspeak).total_seconds() >= THINGSPEAK_MIN_INTERVAL):
        child.last_thingspeak = now
        notify.dispatch(notify.publish_thingspeak, s["thingspeak_write_key"], notify.thingspeak_fields(
            loc["latitude"], loc["longitude"], sound["db"], sound["category"], ev["trust"], worst))

    db.commit()

    live = {
        "ts": iso(ts), "source": source, "lat": loc["latitude"], "lon": loc["longitude"], "fix": loc["fix"],
        "stale": loc["stale"], "stale_seconds": loc["stale_seconds"], "activity": activity,
        "steps": act["steps"], "movement": act["movement_level"], "screen_on": act["screen_on"],
        "sound_db": sound["db"], "sound_category": sound["category"], "sound_rolling": sound["rolling_avg"],
        "very_loud_run": sound["very_loud_run_seconds"], "sustained": sound["sustained_very_loud"],
        "zone": zone["zone"], "inside": zone["inside"], "nearest": zone["nearest"], "distance_m": zone["distance_m"],
        "outside_seconds": outside_seconds, "trust": ev["trust"], "band": ev["band"], "components": ev["components"],
        "actuate": {"buzzer": buzzer, "led": led}, "sos": reading.sos, "battery": child.battery,
    }
    hub.publish(child.id, "reading", live)
    for a in new_alerts:
        hub.publish(child.id, "alert", alert_json(a))
        _fan_out(child, a)
    if attendance is not None:
        hub.publish(child.id, "attendance", {"ts": iso(attendance.ts), "status": attendance.status,
                                             "uid": attendance.tag_uid, "direction": attendance.direction})

    return {
        "ok": True, "reading_id": reading.id, "activity": activity, "zone": zone["zone"],
        "sound": sound["category"], "trust": ev["trust"], "actuate": {"buzzer": buzzer, "led": led},
        "commands": commands, "alerts": [a.title for a in new_alerts],
    }


def process_batch(db: Session, child: Child, readings: list[dict], source: str = "device") -> dict:
    """Buffered upload after a network outage: readings carry their original timestamps."""
    readings = sorted(readings, key=lambda r: -(r.get("age_s") or 0))
    results = [process_reading(db, child, r, source) for r in readings]
    if len(readings) > 1:
        oldest = max(float(r.get("age_s") or 0) for r in readings)
        if oldest >= 20:
            a = add_alert(db, child, {"key": "sync", "level": "info", "category": "system",
                                      "title": "Device reconnected",
                                      "message": f"Network restored — {len(readings)} buffered readings "
                                                 f"from the last {oldest:.0f}s were synced.", "cooldown": 30}, utcnow())
            db.commit()
            if a:
                hub.publish(child.id, "alert", alert_json(a))
    last = results[-1] if results else {"ok": True, "actuate": {"buzzer": False, "led": "green"}, "commands": []}
    return {**last, "processed": len(results)}
