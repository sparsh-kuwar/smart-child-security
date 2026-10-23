"""Virtual Arduino/ESP8266 device.

Plays a compressed school day on a 6-minute loop (home → bus → school with RFID entry → recess →
RFID exit → bus → home) and can inject every failure/edge scenario from report §6.3–6.4.
Its readings go through the same `process_reading` pipeline as real hardware.
"""
import asyncio
import logging
import math
import random
from dataclasses import dataclass, field
from datetime import timedelta

from sqlalchemy import select

from .config import SIM_TICK_SECONDS, SIMULATOR_ENABLED
from .db import SessionLocal, to_local, utcnow
from .models import Child
from .pipeline import process_batch, process_reading

log = logging.getLogger("simulator")
CYCLE = 360
MAX_SIM_CHILDREN = 60

SCENARIOS = {
    "wander": {"label": "Leave safe zone", "seconds": 150,
               "desc": "Child drifts ~700 m away from home/school. Warning after the 60 s grace period."},
    "very_loud": {"label": "Sustained very loud", "seconds": 90,
                  "desc": "Ambient sound ~90 dB for 90 s. Persistence rule fires after 60 s."},
    "critical": {"label": "Critical combo", "seconds": 120,
                 "desc": "Outside every zone + sustained 92 dB (case study #2). Buzzer + red LED."},
    "transient": {"label": "Short loud transient", "seconds": 6,
                  "desc": "One 93 dB spike (door slam). Must NOT raise an alarm."},
    "gps_loss": {"label": "GPS signal loss", "seconds": 90,
                 "desc": "No GPS fix for 90 s. Last known position is held and flagged stale."},
    "unregistered_tag": {"label": "Unregistered RFID", "seconds": 6,
                         "desc": "An unknown card is scanned. It is rejected; no attendance stored."},
    "duplicate_scan": {"label": "Duplicate RFID scan", "seconds": 11,
                       "desc": "Valid card scanned twice within the debounce window."},
    "sos": {"label": "SOS button", "seconds": 6, "desc": "Manual SOS press on the device."},
    "network_loss": {"label": "Network loss", "seconds": 45,
                     "desc": "Wi-Fi drops for 45 s; readings are buffered then synced on reconnect."},
    "restart": {"label": "Controller restart", "seconds": 20,
                "desc": "Device goes silent, then boots and resumes monitoring."},
    "overuse": {"label": "Device overuse", "seconds": 0,
                "desc": "Pushes screen time, night use and unlocks past their thresholds for today."},
    "reset": {"label": "Normal day", "seconds": 0, "desc": "Clears all injected scenarios."},
}


@dataclass
class SimState:
    seed: int
    t0: float = field(default_factory=lambda: utcnow().timestamp())
    scenario: str | None = None
    scenario_until: float = 0
    scenario_started: float = 0
    overuse_date: str | None = None
    buffer: list = field(default_factory=list)
    wander_bearing: float = 0
    scanned_cycle: dict = field(default_factory=dict)


_states: dict[int, SimState] = {}


def state_for(child_id: int) -> SimState:
    if child_id not in _states:
        _states[child_id] = SimState(seed=child_id * 7919)
    return _states[child_id]


def start_scenario(child_id: int, name: str):
    st = state_for(child_id)
    now = utcnow().timestamp()
    if name == "reset":
        st.scenario, st.scenario_until, st.overuse_date = None, 0, None
        return
    if name == "overuse":
        st.overuse_date = to_local(utcnow()).date().isoformat()
        return
    st.scenario = name
    st.scenario_started = now
    st.scenario_until = now + SCENARIOS[name]["seconds"]
    st.wander_bearing = random.uniform(0, 2 * math.pi)


def scenario_status(child_id: int) -> dict:
    st = state_for(child_id)
    now = utcnow().timestamp()
    active = st.scenario if st.scenario and now < st.scenario_until else None
    return {
        "active": active,
        "remaining": max(0, int(st.scenario_until - now)) if active else 0,
        "overuse": st.overuse_date == to_local(utcnow()).date().isoformat(),
        "phase": phase_name((now - st.t0) % CYCLE),
        "cycle_seconds": CYCLE,
        "cycle_position": int((now - st.t0) % CYCLE),
    }


def phase_name(t: float) -> str:
    if t < 50:
        return "At home"
    if t < 110:
        return "Bus to school"
    if t < 260:
        return "Recess" if 180 <= t < 215 else "In class"
    if t < 320:
        return "Bus home"
    return "At home"


def _offset(lat, lon, dist_m, bearing):
    dlat = dist_m * math.cos(bearing) / 111_320
    dlon = dist_m * math.sin(bearing) / (111_320 * math.cos(math.radians(lat)))
    return lat + dlat, lon + dlon


def _usage(rng: random.Random, local, overuse: bool) -> dict:
    mins = local.hour * 60 + local.minute
    awake = max(0, min(mins, 22 * 60) - 6 * 60 - 30)
    school = max(0, min(mins, 14 * 60 + 30) - 8 * 60 - 30)
    free = max(0, awake - school)
    screen = free * 0.42 + rng.uniform(0, 8)
    study = max(0, min(mins, 19 * 60 + 30) - 15 * 60 - 30) * 0.55 + school * 0.05
    gaming = max(0, min(mins, 21 * 60) - 16 * 60) * 0.25
    night = (max(0, mins - 22 * 60) * 0.3) if mins >= 22 * 60 else (rng.uniform(0, 12) if mins < 6 * 60 else rng.uniform(4, 12))
    usage = {"screen_minutes": round(screen + gaming, 1), "night_minutes": round(night, 1),
             "gaming_minutes": round(gaming, 1), "study_minutes": round(study, 1),
             "unlocks": int((screen + gaming) / 5)}
    if overuse:
        usage["screen_minutes"] = max(usage["screen_minutes"] + 150, 390)
        usage["night_minutes"] = max(usage["night_minutes"], 75)
        usage["unlocks"] = max(usage["unlocks"], 96)
        usage["gaming_minutes"] = max(usage["gaming_minutes"], usage["study_minutes"] + 40)
    return usage


def generate(child: Child, st: SimState) -> dict | None:
    """Produce one raw device reading. Returns None while the device is 'offline'."""
    now = utcnow()
    nts = now.timestamp()
    local = to_local(now)
    t = (nts - st.t0) % CYCLE
    cycle_no = int((nts - st.t0) // CYCLE)
    rng = random.Random(f"{st.seed}-{local.date()}-{int(nts // SIM_TICK_SECONDS)}")
    scen = st.scenario if st.scenario and nts < st.scenario_until else None
    if st.scenario and not scen:
        st.scenario = None

    zones = {z.kind: z for z in child.zones if z.active}
    home = zones.get("home") or (child.zones[0] if child.zones else None)
    school = zones.get("school") or home
    hl = (home.lat, home.lon) if home else (18.5204, 73.8567)
    sl = (school.lat, school.lon) if school else hl

    def lerp(a, b, f):
        f = 0.5 - 0.5 * math.cos(math.pi * f)  # ease in/out like a bus pulling away
        bend = math.sin(math.pi * f) * 0.0007  # ~75 m — stays inside the 180 m route corridor
        return a[0] + (b[0] - a[0]) * f + bend, a[1] + (b[1] - a[1]) * f - bend

    night = local.hour >= 22 or local.hour < 6
    raw: dict = {"battery": round(100 - (t / CYCLE) * 12, 1), "fw": "sim-1.2"}

    if t < 50 or t >= 320:
        pos = hl
        if night:
            steps, move, screen, db = 0, rng.uniform(0, 0.05), False, rng.gauss(36, 2)
        else:
            steps, move, screen, db = rng.randint(0, 25), rng.uniform(0.05, 0.35), rng.random() < 0.6, rng.gauss(45, 3)
    elif t < 110:
        pos = lerp(hl, sl, (t - 50) / 60)
        steps, move, screen, db = rng.randint(40, 75), rng.uniform(0.45, 0.7), False, rng.gauss(60, 3)
    elif t < 260:
        pos = sl
        if 180 <= t < 215:
            steps, move, screen = rng.randint(60, 120), rng.uniform(0.6, 0.95), False
            db = rng.choice([rng.gauss(68, 3), rng.gauss(72, 3), rng.uniform(76, 80)])
        else:
            steps, move, screen, db = rng.randint(0, 25), rng.uniform(0.12, 0.35), False, rng.gauss(50, 3)
    else:
        pos = lerp(sl, hl, (t - 260) / 60)
        steps, move, screen, db = rng.randint(40, 75), rng.uniform(0.45, 0.7), False, rng.gauss(61, 3)

    tag = next((tg.uid for tg in child.tags if tg.active), None)
    if tag and 110 <= t < 110 + SIM_TICK_SECONDS * 1.5 and st.scanned_cycle.get("in") != cycle_no:
        raw["rfid_uid"], raw["rfid_dir"] = tag, "in"
        st.scanned_cycle["in"] = cycle_no
    if tag and 255 <= t < 255 + SIM_TICK_SECONDS * 1.5 and st.scanned_cycle.get("out") != cycle_no:
        raw["rfid_uid"], raw["rfid_dir"] = tag, "out"
        st.scanned_cycle["out"] = cycle_no

    lat, lon = pos
    lat, lon = _offset(lat, lon, rng.uniform(0, 12), rng.uniform(0, 2 * math.pi))  # GPS jitter ±3–12 m
    fix = True
    elapsed = nts - st.scenario_started

    if scen in ("wander", "critical"):
        dist = min(750, 120 + elapsed * 9)
        lat, lon = _offset(pos[0], pos[1], dist + 300, st.wander_bearing)
        steps, move = rng.randint(50, 110), rng.uniform(0.5, 0.9)
    if scen in ("very_loud", "critical"):
        db = rng.uniform(88, 95) if scen == "very_loud" else rng.uniform(90, 94)
    if scen == "transient" and elapsed < SIM_TICK_SECONDS:
        db = 93.0
    if scen == "gps_loss":
        fix, lat, lon = False, None, None
    if scen == "unregistered_tag" and elapsed < SIM_TICK_SECONDS:
        raw["rfid_uid"] = "DE:AD:%02X:%02X" % (rng.randint(0, 255), rng.randint(0, 255))
    if scen == "duplicate_scan" and tag:
        raw["rfid_uid"] = tag
    if scen == "sos" and elapsed < SIM_TICK_SECONDS:
        raw["sos"] = True
    if scen == "restart":
        if st.scenario_until - nts > SIM_TICK_SECONDS:
            return None
        raw["event"] = "boot"

    raw.update({
        "lat": round(lat, 6) if lat is not None else None,
        "lon": round(lon, 6) if lon is not None else None,
        "gps_fix": fix, "satellites": rng.randint(6, 11) if fix else 0,
        "steps": steps, "movement": round(max(0, min(1, move)), 3), "screen_on": screen,
        "sound_db": round(max(30, min(110, db)), 1),
        "usage": _usage(random.Random(f"{st.seed}-{local.date()}"), local,
                        st.overuse_date == local.date().isoformat()),
    })
    return raw


def tick_child(child_id: int):
    with SessionLocal() as db:
        child = db.get(Child, child_id)
        if not child or not child.simulator_enabled:
            return
        st = state_for(child_id)
        raw = generate(child, st)
        nts = utcnow().timestamp()
        if st.scenario == "network_loss" and nts < st.scenario_until:
            if raw:
                raw["_t"] = nts
                st.buffer.append(raw)
            return
        if st.buffer:
            batch = st.buffer + ([raw] if raw else [])
            for r in batch:
                r["age_s"] = round(nts - r.pop("_t", nts), 1)
            st.buffer = []
            process_batch(db, child, batch, source="simulator")
            return
        if raw:
            process_reading(db, child, raw, source="simulator")


async def run_simulator():
    if not SIMULATOR_ENABLED:
        log.info("Simulator disabled")
        return
    log.info("Simulator running every %ss", SIM_TICK_SECONDS)
    while True:
        started = utcnow()
        try:
            with SessionLocal() as db:
                ids = list(db.scalars(select(Child.id).where(Child.simulator_enabled.is_(True))
                                      .order_by(Child.id).limit(MAX_SIM_CHILDREN)))
            for cid in ids:
                try:
                    await asyncio.to_thread(tick_child, cid)
                except Exception:
                    log.exception("simulator tick failed for child %s", cid)
        except Exception:
            log.exception("simulator loop error")
        spent = (utcnow() - started).total_seconds()
        await asyncio.sleep(max(0.5, SIM_TICK_SECONDS - spent))


def next_arrival_eta(child_id: int) -> timedelta:
    st = state_for(child_id)
    t = (utcnow().timestamp() - st.t0) % CYCLE
    return timedelta(seconds=(110 - t) % CYCLE)
