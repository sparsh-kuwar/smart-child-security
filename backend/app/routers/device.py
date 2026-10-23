"""Endpoints called by the ESP8266 (or any HTTP-capable device). Auth: X-Device-Key header."""
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Child
from ..pipeline import process_batch, process_reading

router = APIRouter(prefix="/api/device", tags=["device"])
MAX_BATCH = 200


def device_child(db: Session, key: str | None) -> Child:
    if not key:
        raise HTTPException(401, "Missing X-Device-Key")
    child = db.scalar(select(Child).where(Child.device_key == key))
    if not child:
        raise HTTPException(401, "Unknown device key")
    return child


@router.post("/ingest")
async def ingest(request: Request, x_device_key: str | None = Header(default=None), db: Session = Depends(get_db)):
    """Accepts one reading, or {"readings": [...]} for buffered uploads after a network outage.

    Reading fields (all optional): lat, lon, gps_fix, satellites, steps, movement (0–1), screen_on,
    sound_db, rfid_uid, sos, battery, fw, event ("boot"), age_s | ts, usage {screen_minutes, ...}.
    """
    child = device_child(db, x_device_key)
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(400, "Body must be JSON")
    if not isinstance(body, dict):
        raise HTTPException(400, "Body must be a JSON object")

    if child.simulator_enabled:  # real hardware takes over from the simulator automatically
        child.simulator_enabled = False

    if isinstance(body.get("readings"), list):
        batch = [r for r in body["readings"][:MAX_BATCH] if isinstance(r, dict)]
        if not batch:
            raise HTTPException(400, "Empty batch")
        return process_batch(db, child, batch, source="device")
    return process_reading(db, child, body, source="device")


@router.post("/usage")
async def usage(request: Request, x_device_key: str | None = Header(default=None), db: Session = Depends(get_db)):
    """Daily device-usage totals from a companion phone app: screen/night/gaming/study minutes + unlocks."""
    child = device_child(db, x_device_key)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "Body must be a JSON object")
    from ..pipeline import _upsert_usage
    from ..db import utcnow
    _upsert_usage(db, child, utcnow(), body)
    db.commit()
    return {"ok": True}
