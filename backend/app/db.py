from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import DATABASE_URL, TZ

_is_sqlite = DATABASE_URL.startswith("sqlite")
if _is_sqlite:
    Path(DATABASE_URL.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30} if _is_sqlite else {},
    pool_pre_ping=not _is_sqlite,
)

if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(conn, _):
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.close()

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# All timestamps are stored as naive UTC.
def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_local(ts: datetime) -> datetime:
    return ts.replace(tzinfo=timezone.utc).astimezone(TZ)


def local_date(ts: datetime | None = None) -> str:
    return to_local(ts or utcnow()).date().isoformat()


def local_day_start_utc(ts: datetime | None = None) -> datetime:
    local = to_local(ts or utcnow())
    start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc).replace(tzinfo=None)


def iso(ts: datetime | None) -> str | None:
    return ts.isoformat(timespec="seconds") + "Z" if ts else None
