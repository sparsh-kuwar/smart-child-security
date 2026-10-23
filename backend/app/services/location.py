"""Location Service — validated latitude/longitude, GPS fix status and timestamp (report §4.1.2).

Tolerates missing fixes: when the current reading has no valid fix, the last valid
position is carried forward and marked stale so downstream modules never see (0, 0).
"""
from datetime import datetime


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v


def is_valid_fix(lat, lon, fix_flag=True) -> bool:
    if not fix_flag or not (_num(lat) and _num(lon)):
        return False
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return False
    return not (abs(lat) < 1e-6 and abs(lon) < 1e-6)  # (0,0) is what a Neo-6M reports with no fix


def get_location_record(raw: dict, ts: datetime, last_valid: dict | None = None) -> dict:
    lat, lon = raw.get("lat"), raw.get("lon")
    fix_flag = raw.get("gps_fix", True)
    if is_valid_fix(lat, lon, fix_flag):
        return {
            "latitude": float(lat),
            "longitude": float(lon),
            "fix": True,
            "stale": False,
            "stale_seconds": 0,
            "satellites": raw.get("satellites"),
            "timestamp": ts,
        }
    if last_valid:
        return {
            "latitude": last_valid["latitude"],
            "longitude": last_valid["longitude"],
            "fix": False,
            "stale": True,
            "stale_seconds": max(0, int((ts - last_valid["timestamp"]).total_seconds())),
            "satellites": raw.get("satellites"),
            "timestamp": ts,
        }
    return {
        "latitude": None,
        "longitude": None,
        "fix": False,
        "stale": True,
        "stale_seconds": None,
        "satellites": raw.get("satellites"),
        "timestamp": ts,
    }
