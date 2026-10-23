import os
from pathlib import Path
from zoneinfo import ZoneInfo

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv("SECRET_KEY", "dev-insecure-secret-change-me")
TOKEN_TTL_HOURS = int(os.getenv("TOKEN_TTL_HOURS", "168"))

_db_url = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'data' / 'safekid.db'}")
# Render/Heroku hand out postgres:// URLs; SQLAlchemy needs the driver spelled out.
if _db_url.startswith("postgres://"):
    _db_url = "postgresql+psycopg://" + _db_url[len("postgres://"):]
elif _db_url.startswith("postgresql://"):
    _db_url = "postgresql+psycopg://" + _db_url[len("postgresql://"):]
DATABASE_URL = _db_url

TZ = ZoneInfo(os.getenv("APP_TIMEZONE", "Asia/Kolkata"))

SIMULATOR_ENABLED = os.getenv("SIMULATOR_ENABLED", "1") == "1"
SIM_TICK_SECONDS = float(os.getenv("SIM_TICK_SECONDS", "5"))

DEMO_EMAIL = os.getenv("DEMO_EMAIL", "demo@safetrack.app")
DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "demo1234")

FRONTEND_DIST = Path(os.getenv("FRONTEND_DIST", BASE_DIR / "static"))

# Optional outbound notification channels
TWILIO_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM = os.getenv("TWILIO_FROM_NUMBER", "")

# Report §5.1.7 — Trust Score weights
TRUST_WEIGHTS = {
    "activity": 0.25,
    "schedule": 0.20,
    "location": 0.25,
    "device": 0.15,
    "sound": 0.15,
}

# Report §5.1.4 / §5.1.6 defaults; each child can override in settings.
DEFAULT_SETTINGS = {
    "screen_limit_minutes": 360,
    "night_limit_minutes": 60,
    "unlock_limit": 80,
    "rfid_debounce_seconds": 60,
    "sound_window_seconds": 300,
    "very_loud_db": 85,
    "very_loud_persist_seconds": 60,
    "outside_grace_seconds": 60,
    "gps_stale_seconds": 60,
    "offline_after_seconds": 120,
    "school_start": "08:30",
    "study_target_hours": 2.0,
    "notify_sms_phone": "",
    "notify_webhook_url": "",
    "thingspeak_write_key": "",
    "thingspeak_channel_id": "",
}
