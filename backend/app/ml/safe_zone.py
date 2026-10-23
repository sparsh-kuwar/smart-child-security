"""Safe Zone Model — Haversine geofencing (report §5.1.3).

Circular zones use the Haversine distance to the centre. Route corridors (a school-bus path)
use the distance to the nearest point on the segment, so a normal commute isn't flagged.
"""
import math

EARTH_RADIUS_M = 6371000
INSIDE_SCORE = 1.0
OUTSIDE_SCORE = 0.3
STALE_SCORE = 0.6


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def distance_to_zone(lat: float, lon: float, z: dict) -> float:
    if z.get("lat2") is None or z.get("lon2") is None:
        return haversine(lat, lon, z["lat"], z["lon"])
    # Project onto the segment in a local flat frame (fine for corridors of a few km).
    kx = math.cos(math.radians(z["lat"])) * 111_320
    ky = 111_320
    ax, ay = 0.0, 0.0
    bx, by = (z["lon2"] - z["lon"]) * kx, (z["lat2"] - z["lat"]) * ky
    px, py = (lon - z["lon"]) * kx, (lat - z["lat"]) * ky
    seg = bx * bx + by * by
    f = 0.0 if seg == 0 else max(0.0, min(1.0, (px * bx + py * by) / seg))
    cx, cy = ax + f * bx, ay + f * by
    return haversine(lat, lon, z["lat"] + cy / ky, z["lon"] + cx / kx)


def check_safe_zone(lat: float | None, lon: float | None, zones: list[dict]) -> dict:
    """zones: [{name, lat, lon, radius_m, lat2?, lon2?}]. Returns inside flag, zone, nearest zone and score."""
    if lat is None or lon is None or not zones:
        return {"inside": False, "zone": None, "nearest": None, "distance_m": None,
                "safety_score": OUTSIDE_SCORE if zones else INSIDE_SCORE, "unknown": lat is None}
    best = None
    for z in zones:
        d = distance_to_zone(lat, lon, z)
        edge = d - z["radius_m"]
        if d <= z["radius_m"]:
            return {"inside": True, "zone": z["name"], "nearest": z["name"], "distance_m": round(d, 1),
                    "safety_score": INSIDE_SCORE, "unknown": False}
        if best is None or edge < best[1]:
            best = (z, edge)
    zone, edge = best
    return {"inside": False, "zone": None, "nearest": zone["name"], "distance_m": round(edge, 1),
            "safety_score": OUTSIDE_SCORE, "unknown": False}
