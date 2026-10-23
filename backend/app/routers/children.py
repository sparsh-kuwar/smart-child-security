"""Children, safe zones, RFID tags, attendance, alerts, device commands and simulator controls."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from .. import notify, simulator
from ..analytics import child_settings
from ..config import DEFAULT_SETTINGS
from ..db import get_db, iso, utcnow
from ..models import Alert, Attendance, Child, RfidTag, User, Zone
from ..pipeline import alert_json
from ..security import current_user, new_device_key, owned_child
from ..seed import create_child, new_tag_uid

router = APIRouter(prefix="/api", tags=["children"])


def child_json(c: Child) -> dict:
    s = child_settings(c)
    online = bool(c.last_seen and (utcnow() - c.last_seen).total_seconds() < s["offline_after_seconds"])
    return {
        "id": c.id, "name": c.name, "age": c.age, "grade": c.grade, "school": c.school,
        "student_code": c.student_code, "device_key": c.device_key, "simulator_enabled": c.simulator_enabled,
        "data_source": c.data_source, "online": online, "last_seen": iso(c.last_seen), "last_boot": iso(c.last_boot),
        "battery": c.battery, "firmware": c.firmware, "settings": s,
    }


def zone_json(z: Zone) -> dict:
    return {"id": z.id, "name": z.name, "kind": z.kind, "lat": z.lat, "lon": z.lon, "lat2": z.lat2, "lon2": z.lon2,
            "radius_m": z.radius_m, "active": z.active}


# ---------------------------------------------------------------- children
class ChildIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    age: int = Field(default=10, ge=1, le=19)
    grade: str = Field(default="", max_length=40)
    school: str = Field(default="", max_length=160)


class ChildPatch(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    age: int | None = Field(default=None, ge=1, le=19)
    grade: str | None = Field(default=None, max_length=40)
    school: str | None = Field(default=None, max_length=160)
    settings: dict | None = None


@router.get("/children")
def list_children(user: User = Depends(current_user)):
    return [child_json(c) for c in user.children]


@router.post("/children")
def add_child(body: ChildIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if len(user.children) >= 5:
        raise HTTPException(400, "A parent account can monitor up to 5 children")
    c = create_child(db, user, body.name, age=body.age, grade=body.grade or "", school=body.school or "")
    return child_json(c)


@router.get("/children/{child_id}")
def get_child(child_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return child_json(owned_child(child_id, user, db))


@router.patch("/children/{child_id}")
def patch_child(child_id: int, body: ChildPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    for f in ("name", "age", "grade", "school"):
        v = getattr(body, f)
        if v is not None:
            setattr(c, f, v)
    if body.settings is not None:
        merged = dict(c.settings or {})
        for k, v in body.settings.items():
            if k not in DEFAULT_SETTINGS:
                continue
            default = DEFAULT_SETTINGS[k]
            try:
                merged[k] = type(default)(v) if not isinstance(default, str) else str(v)[:300]
            except (TypeError, ValueError):
                raise HTTPException(422, f"Invalid value for {k}")
        c.settings = merged
    db.commit()
    return child_json(c)


@router.delete("/children/{child_id}")
def delete_child(child_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    if len(user.children) <= 1:
        raise HTTPException(400, "Keep at least one child profile")
    db.delete(c)
    db.commit()
    return {"ok": True}


@router.post("/children/{child_id}/rotate-key")
def rotate_key(child_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    c.device_key = new_device_key()
    db.commit()
    return {"device_key": c.device_key}


@router.post("/children/{child_id}/commands")
def queue_command(child_id: int, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Parent → device commands, delivered in the next ingest response (e.g. ring the buzzer)."""
    c = owned_child(child_id, user, db)
    kind = body.get("type")
    if kind not in ("buzz", "locate"):
        raise HTTPException(422, "Unknown command")
    c.pending_commands = [*(c.pending_commands or []), {"type": kind, "at": iso(utcnow())}][-10:]
    db.commit()
    return {"queued": kind}


@router.post("/children/{child_id}/thingspeak/test")
def thingspeak_test(child_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    key = child_settings(c)["thingspeak_write_key"]
    if not key:
        raise HTTPException(400, "Add a ThingSpeak write API key first")
    ok = notify.publish_thingspeak(key, {"field5": 100, "field6": 1})
    return {"ok": ok}


# ---------------------------------------------------------------- zones
class ZoneIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    kind: str = Field(default="other", pattern="^(home|school|route|other)$")
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    lat2: float | None = Field(default=None, ge=-90, le=90)
    lon2: float | None = Field(default=None, ge=-180, le=180)
    radius_m: float = Field(default=200, ge=20, le=5000)
    active: bool = True


@router.get("/children/{child_id}/zones")
def list_zones(child_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [zone_json(z) for z in owned_child(child_id, user, db).zones]


@router.post("/children/{child_id}/zones")
def add_zone(child_id: int, body: ZoneIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    if len(c.zones) >= 20:
        raise HTTPException(400, "Up to 20 zones per child")
    z = Zone(child_id=c.id, **body.model_dump())
    db.add(z)
    db.commit()
    return zone_json(z)


@router.put("/children/{child_id}/zones/{zone_id}")
def edit_zone(child_id: int, zone_id: int, body: ZoneIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    z = db.get(Zone, zone_id)
    if not z or z.child_id != c.id:
        raise HTTPException(404, "Zone not found")
    for k, v in body.model_dump().items():
        setattr(z, k, v)
    db.commit()
    return zone_json(z)


@router.delete("/children/{child_id}/zones/{zone_id}")
def delete_zone(child_id: int, zone_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    z = db.get(Zone, zone_id)
    if not z or z.child_id != c.id:
        raise HTTPException(404, "Zone not found")
    db.delete(z)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- RFID tags + attendance
class TagIn(BaseModel):
    uid: str | None = Field(default=None, max_length=32)
    label: str = Field(default="ID card", max_length=80)


@router.get("/children/{child_id}/tags")
def list_tags(child_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    return [{"id": t.id, "uid": t.uid, "label": t.label, "active": t.active, "created_at": iso(t.created_at)} for t in c.tags]


@router.post("/children/{child_id}/tags")
def add_tag(child_id: int, body: TagIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    uid = (body.uid or new_tag_uid()).strip().upper()
    if db.scalar(select(RfidTag).where(RfidTag.uid == uid)):
        raise HTTPException(409, "This tag is already registered")
    t = RfidTag(child_id=c.id, uid=uid, label=body.label)
    db.add(t)
    db.commit()
    return {"id": t.id, "uid": t.uid, "label": t.label, "active": t.active, "created_at": iso(t.created_at)}


@router.patch("/children/{child_id}/tags/{tag_id}")
def toggle_tag(child_id: int, tag_id: int, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    t = db.get(RfidTag, tag_id)
    if not t or t.child_id != c.id:
        raise HTTPException(404, "Tag not found")
    t.active = bool(body.get("active", t.active))
    db.commit()
    return {"id": t.id, "active": t.active}


@router.delete("/children/{child_id}/tags/{tag_id}")
def delete_tag(child_id: int, tag_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    t = db.get(RfidTag, tag_id)
    if not t or t.child_id != c.id:
        raise HTTPException(404, "Tag not found")
    db.delete(t)
    db.commit()
    return {"ok": True}


@router.get("/children/{child_id}/attendance")
def attendance(child_id: int, days: int = 14, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    rows = db.scalars(select(Attendance).where(
        or_(Attendance.child_id == c.id, Attendance.device_child_id == c.id),
        Attendance.ts >= utcnow() - timedelta(days=min(days, 60))).order_by(Attendance.ts.desc()).limit(300))
    return [{"id": a.id, "ts": iso(a.ts), "uid": a.tag_uid, "status": a.status, "direction": a.direction,
             "zone": a.zone_name, "lat": a.lat, "lon": a.lon} for a in rows]


# ---------------------------------------------------------------- alerts
@router.get("/children/{child_id}/alerts")
def list_alerts(child_id: int, level: str | None = None, category: str | None = None, limit: int = 100,
                unacked: bool = False, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    q = select(Alert).where(Alert.child_id == c.id)
    if level:
        q = q.where(Alert.level == level)
    if category:
        q = q.where(Alert.category == category)
    if unacked:
        q = q.where(Alert.acknowledged.is_(False))
    return [alert_json(a) for a in db.scalars(q.order_by(Alert.ts.desc()).limit(min(limit, 500)))]


@router.post("/children/{child_id}/alerts/{alert_id}/ack")
def ack_alert(child_id: int, alert_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    a = db.get(Alert, alert_id)
    if not a or a.child_id != c.id:
        raise HTTPException(404, "Alert not found")
    a.acknowledged = True
    db.commit()
    return alert_json(a)


@router.post("/children/{child_id}/alerts/ack-all")
def ack_all(child_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    res = db.execute(update(Alert).where(Alert.child_id == c.id, Alert.acknowledged.is_(False)).values(acknowledged=True))
    db.commit()
    return {"acknowledged": res.rowcount}


# ---------------------------------------------------------------- simulator
@router.get("/children/{child_id}/simulator")
def sim_status(child_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    return {"enabled": c.simulator_enabled, **simulator.scenario_status(c.id),
            "scenarios": [{"name": k, **v} for k, v in simulator.SCENARIOS.items()]}


@router.post("/children/{child_id}/simulator")
def sim_toggle(child_id: int, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    c.simulator_enabled = bool(body.get("enabled"))
    db.commit()
    return {"enabled": c.simulator_enabled}


@router.post("/children/{child_id}/simulator/scenario")
def sim_scenario(child_id: int, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_child(child_id, user, db)
    name = body.get("name")
    if name not in simulator.SCENARIOS:
        raise HTTPException(422, "Unknown scenario")
    if not c.simulator_enabled:
        c.simulator_enabled = True
        db.commit()
    simulator.start_scenario(c.id, name)
    return simulator.scenario_status(c.id)
