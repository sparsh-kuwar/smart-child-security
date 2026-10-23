"""Alert Analyzer — combines analytical outputs into Critical / Warning / Info alerts (report §5.1.6).

Each candidate carries a `key` and `cooldown` so the pipeline can de-duplicate repeats.
"""


def _alert(key, level, category, title, message, cooldown=300, **data):
    return {"key": key, "level": level, "category": category, "title": title,
            "message": message, "cooldown": cooldown, "data": data}


def analyze(ctx: dict) -> list[dict]:
    """ctx keys: child, location, zone, outside_seconds, sound, sos, trust, settings, place."""
    s = ctx["settings"]
    name = ctx["child"]
    loc = ctx["location"]
    zone = ctx["zone"]
    sound = ctx["sound"]
    alerts = []

    if ctx.get("sos"):
        alerts.append(_alert("sos", "critical", "sos", f"SOS from {name}",
                             f"{name} pressed the SOS button. Last position {ctx['place']}.", cooldown=30))

    outside = not zone["inside"] and not zone.get("unknown")
    outside_s = ctx.get("outside_seconds", 0)
    sustained = sound.get("sustained_very_loud")

    # Case study scenario 2: outside every zone AND sustained Very-Loud sound → critical
    if outside and sustained:
        alerts.append(_alert(
            "critical_combo", "critical", "location",
            "Critical: outside safe zones with sustained very loud noise",
            f"{name} is {zone['distance_m']:.0f} m outside {zone['nearest']} and ambient sound has stayed "
            f"Very Loud (~{sound['db']:.0f} dB) for {sound['very_loud_run_seconds']:.0f}s. Buzzer activated.",
            cooldown=180, db=sound["db"]))
    elif outside and outside_s >= 600:
        alerts.append(_alert("outside_long", "critical", "location", f"{name} outside safe zones for 10+ min",
                             f"{name} has been outside all safe zones for {outside_s // 60:.0f} minutes, "
                             f"{zone['distance_m']:.0f} m from {zone['nearest']}.", cooldown=600))
    elif outside and outside_s >= s["outside_grace_seconds"]:
        alerts.append(_alert("outside", "warning", "location", f"{name} left the safe zones",
                             f"{name} is {zone['distance_m']:.0f} m outside {zone['nearest']} "
                             f"({int(outside_s)}s).", cooldown=600))
    elif sustained:
        alerts.append(_alert("very_loud", "warning", "sound", "Sustained very loud environment",
                             f"Ambient sound near {name} has stayed above {s['very_loud_db']} dB for "
                             f"{sound['very_loud_run_seconds']:.0f}s (~{sound['db']:.0f} dB).",
                             cooldown=300, db=sound["db"]))

    if sound.get("category") == "Loud" and not sustained:
        alerts.append(_alert("loud_peak", "info", "sound", "Loud sound logged",
                             f"A {sound['db']:.0f} dB peak was logged for observation (Loud, not Very Loud).",
                             cooldown=900, db=sound["db"]))
    if sound.get("transient_suppressed"):
        alerts.append(_alert("transient", "info", "sound", "Short noise transient ignored",
                             "A brief very-loud spike ended before the 60 s persistence rule — no alarm raised.",
                             cooldown=600))
    if not sound.get("sensor_ok", True):
        alerts.append(_alert("sound_sensor", "warning", "system", "Sound sensor not reporting",
                             "The ambient sound reading was missing or out of range.", cooldown=1800))

    if loc["stale"] and (loc["stale_seconds"] or 0) >= s["gps_stale_seconds"]:
        alerts.append(_alert("gps_lost", "warning", "gps", "GPS signal lost",
                             f"No GPS fix for {loc['stale_seconds']}s. Showing last known position.",
                             cooldown=900))

    trust = ctx.get("trust")
    if trust is not None and trust < 45:
        alerts.append(_alert("trust_low", "critical", "trust", f"Trust Score dropped to {trust:.0f}%",
                             "Several safety signals are poor at the same time.", cooldown=900))
    elif trust is not None and trust < 60:
        alerts.append(_alert("trust_watch", "warning", "trust", f"Trust Score at {trust:.0f}%",
                             "Safety indicators need attention.", cooldown=1800))

    for v in ctx.get("device_violations", []):
        alerts.append(_alert(f"device_{v['key']}", "warning", "device", v["title"], v["detail"], cooldown=86400))

    return alerts


def should_actuate(level: str) -> bool:
    """Critical alerts drive the local buzzer + red LED on the device."""
    return level == "critical"
