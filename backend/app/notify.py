"""Outbound channels: ThingSpeak cloud publishing, SMS (Twilio) and generic webhooks.

All calls run on a small thread pool so a slow network never blocks sensor ingestion.
"""
import logging
from concurrent.futures import ThreadPoolExecutor

import httpx

from .config import TWILIO_FROM, TWILIO_SID, TWILIO_TOKEN

log = logging.getLogger("notify")
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="notify")

SOUND_INDEX = {"Quiet": 1, "Normal": 2, "Loud": 3, "Very Loud": 4}
LEVEL_INDEX = {"info": 1, "warning": 2, "critical": 3}


def thingspeak_fields(lat, lon, sound_db, sound_category, trust, alert_level) -> dict:
    """Field mapping published to the ThingSpeak channel (report §4.1.4)."""
    fields = {
        "field1": lat,
        "field2": lon,
        "field3": sound_db,
        "field4": SOUND_INDEX.get(sound_category or "", 0),
        "field5": trust,
        "field6": LEVEL_INDEX.get(alert_level or "", 0),
    }
    return {k: v for k, v in fields.items() if v is not None}


def publish_thingspeak(write_key: str, fields: dict) -> bool:
    try:
        r = httpx.post("https://api.thingspeak.com/update", data={"api_key": write_key, **fields}, timeout=8)
        ok = r.status_code == 200 and r.text.strip() not in ("", "0")
        if not ok:
            log.warning("ThingSpeak rejected update: %s %s", r.status_code, r.text[:100])
        return ok
    except httpx.HTTPError as e:
        log.warning("ThingSpeak publish failed: %s", e)
        return False


def send_sms(to: str, body: str):
    if not (TWILIO_SID and TWILIO_TOKEN and TWILIO_FROM and to):
        return
    try:
        httpx.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json",
            data={"To": to, "From": TWILIO_FROM, "Body": body[:300]},
            auth=(TWILIO_SID, TWILIO_TOKEN),
            timeout=10,
        )
    except httpx.HTTPError as e:
        log.warning("SMS failed: %s", e)


def send_webhook(url: str, payload: dict):
    if not url:
        return
    try:
        httpx.post(url, json=payload, timeout=8)
    except httpx.HTTPError as e:
        log.warning("Webhook failed: %s", e)


def dispatch(fn, *args):
    _pool.submit(fn, *args)
