from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, utcnow


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(32), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    children: Mapped[list["Child"]] = relationship(back_populates="parent", cascade="all, delete-orphan")


class Child(Base):
    __tablename__ = "children"
    id: Mapped[int] = mapped_column(primary_key=True)
    parent_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    age: Mapped[int] = mapped_column(Integer, default=10)
    grade: Mapped[str] = mapped_column(String(40), default="")
    school: Mapped[str] = mapped_column(String(160), default="")
    student_code: Mapped[str] = mapped_column(String(40), default="")
    device_key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    simulator_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    # device status
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_boot: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    battery: Mapped[float | None] = mapped_column(Float, nullable=True)
    firmware: Mapped[str] = mapped_column(String(40), default="")
    data_source: Mapped[str] = mapped_column(String(16), default="simulator")
    last_thingspeak: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    pending_commands: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    parent: Mapped[User] = relationship(back_populates="children")
    zones: Mapped[list["Zone"]] = relationship(cascade="all, delete-orphan")
    tags: Mapped[list["RfidTag"]] = relationship(cascade="all, delete-orphan")


class RfidTag(Base):
    __tablename__ = "rfid_tags"
    id: Mapped[int] = mapped_column(primary_key=True)
    child_id: Mapped[int] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"), index=True)
    uid: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    label: Mapped[str] = mapped_column(String(80), default="ID card")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Zone(Base):
    __tablename__ = "zones"
    id: Mapped[int] = mapped_column(primary_key=True)
    child_id: Mapped[int] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(20), default="other")  # home | school | route | other
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    # A route corridor is the segment (lat,lon)→(lat2,lon2) widened by radius_m.
    lat2: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon2: Mapped[float | None] = mapped_column(Float, nullable=True)
    radius_m: Mapped[float] = mapped_column(Float, default=200)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Reading(Base):
    """One processed telemetry record (raw audio is never stored — only dB + category)."""
    __tablename__ = "readings"
    id: Mapped[int] = mapped_column(primary_key=True)
    child_id: Mapped[int] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"))
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    source: Mapped[str] = mapped_column(String(16), default="device")
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_fix: Mapped[bool] = mapped_column(Boolean, default=True)
    gps_stale: Mapped[bool] = mapped_column(Boolean, default=False)
    satellites: Mapped[int | None] = mapped_column(Integer, nullable=True)
    steps: Mapped[int] = mapped_column(Integer, default=0)
    movement: Mapped[float] = mapped_column(Float, default=0)
    screen_on: Mapped[bool] = mapped_column(Boolean, default=False)
    activity: Mapped[str] = mapped_column(String(20), default="Idle")
    sound_db: Mapped[float | None] = mapped_column(Float, nullable=True)
    sound_category: Mapped[str | None] = mapped_column(String(16), nullable=True)
    sound_rolling: Mapped[float | None] = mapped_column(Float, nullable=True)
    zone_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    inside_zone: Mapped[bool] = mapped_column(Boolean, default=True)
    distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    location_score: Mapped[float] = mapped_column(Float, default=1.0)
    sos: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (Index("ix_readings_child_ts", "child_id", "ts"),)


class Attendance(Base):
    __tablename__ = "attendance"
    id: Mapped[int] = mapped_column(primary_key=True)
    child_id: Mapped[int | None] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"), index=True, nullable=True)
    device_child_id: Mapped[int] = mapped_column(Integer, index=True)  # reader that saw the scan
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    tag_uid: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16))  # accepted | rejected | duplicate
    direction: Mapped[str | None] = mapped_column(String(8), nullable=True)  # in | out
    zone_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(primary_key=True)
    child_id: Mapped[int] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"))
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    level: Mapped[str] = mapped_column(String(12))  # critical | warning | info
    category: Mapped[str] = mapped_column(String(20))
    key: Mapped[str] = mapped_column(String(60), default="")
    title: Mapped[str] = mapped_column(String(160))
    message: Mapped[str] = mapped_column(String(500))
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (Index("ix_alerts_child_ts", "child_id", "ts"),)


class DeviceUsage(Base):
    __tablename__ = "device_usage"
    id: Mapped[int] = mapped_column(primary_key=True)
    child_id: Mapped[int] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"), index=True)
    date: Mapped[str] = mapped_column(String(10), index=True)
    screen_minutes: Mapped[float] = mapped_column(Float, default=0)
    night_minutes: Mapped[float] = mapped_column(Float, default=0)
    gaming_minutes: Mapped[float] = mapped_column(Float, default=0)
    study_minutes: Mapped[float] = mapped_column(Float, default=0)
    unlocks: Mapped[int] = mapped_column(Integer, default=0)


class DailySummary(Base):
    __tablename__ = "daily_summaries"
    id: Mapped[int] = mapped_column(primary_key=True)
    child_id: Mapped[int] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"), index=True)
    date: Mapped[str] = mapped_column(String(10), index=True)
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    activity_score: Mapped[float] = mapped_column(Float, default=0)
    schedule_score: Mapped[float] = mapped_column(Float, default=0)
    location_score: Mapped[float] = mapped_column(Float, default=0)
    device_score: Mapped[float] = mapped_column(Float, default=0)
    sound_score: Mapped[float] = mapped_column(Float, default=0)
    trust_score: Mapped[float] = mapped_column(Float, default=0)
    steps: Mapped[int] = mapped_column(Integer, default=0)
    avg_db: Mapped[float] = mapped_column(Float, default=0)
    max_db: Mapped[float] = mapped_column(Float, default=0)
    loud_events: Mapped[int] = mapped_column(Integer, default=0)
    very_loud_events: Mapped[int] = mapped_column(Integer, default=0)
    alerts: Mapped[int] = mapped_column(Integer, default=0)
    critical_alerts: Mapped[int] = mapped_column(Integer, default=0)
    in_zone_pct: Mapped[float] = mapped_column(Float, default=100)
    screen_minutes: Mapped[float] = mapped_column(Float, default=0)
    arrival: Mapped[str | None] = mapped_column(String(5), nullable=True)
    activity_mix: Mapped[dict] = mapped_column(JSON, default=dict)
    sound_mix: Mapped[dict] = mapped_column(JSON, default=dict)


class TrustSnapshot(Base):
    __tablename__ = "trust_snapshots"
    id: Mapped[int] = mapped_column(primary_key=True)
    child_id: Mapped[int] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"))
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    score: Mapped[float] = mapped_column(Float)
    activity: Mapped[float] = mapped_column(Float)
    schedule: Mapped[float] = mapped_column(Float)
    location: Mapped[float] = mapped_column(Float)
    device: Mapped[float] = mapped_column(Float)
    sound: Mapped[float] = mapped_column(Float)

    __table_args__ = (Index("ix_trust_child_ts", "child_id", "ts"),)


class ScheduleItem(Base):
    __tablename__ = "schedule_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    child_id: Mapped[int] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"), index=True)
    time: Mapped[str] = mapped_column(String(5))  # HH:MM local
    title: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(20), default="routine")
    priority: Mapped[str] = mapped_column(String(10), default="medium")
