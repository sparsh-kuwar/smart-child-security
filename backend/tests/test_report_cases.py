"""Unit tests mirroring the test cases in Chapter 6 of the project report."""
from datetime import datetime, timedelta

import pytest

from app.ml.activity_classifier import classify_activity
from app.ml.device_behaviour import analyze_device_behaviour
from app.ml.safe_zone import check_safe_zone, haversine
from app.ml.sound_classifier import classify_db, persistence
from app.ml.trust_score import calculate_trust_score
from app.services.device import get_device_record
from app.services.location import get_location_record
from app.services.sound import get_sound_record

HOME = {"name": "Home", "lat": 18.5204, "lon": 73.8567, "radius_m": 200}
SCHOOL = {"name": "School", "lat": 18.5300, "lon": 73.8500, "radius_m": 300}
T0 = datetime(2026, 10, 20, 9, 0, 0)


# 6.2.2 Safe-zone detection --------------------------------------------------------------
def test_haversine_known_distance():
    # 0.001° latitude ≈ 111 m
    assert haversine(18.5204, 73.8567, 18.5214, 73.8567) == pytest.approx(111.2, abs=0.5)


def test_inside_zone_scores_one():
    r = check_safe_zone(18.5210, 73.8570, [HOME, SCHOOL])
    assert r["inside"] and r["zone"] == "Home" and r["safety_score"] == 1.0


def test_outside_all_zones_scores_point_three():
    r = check_safe_zone(18.5500, 73.9000, [HOME, SCHOOL])
    assert not r["inside"] and r["safety_score"] == 0.3 and r["distance_m"] > 0


def test_route_corridor_covers_commute_but_not_detours():
    route = {"name": "Route", "lat": HOME["lat"], "lon": HOME["lon"], "lat2": SCHOOL["lat"],
             "lon2": SCHOOL["lon"], "radius_m": 150}
    mid = ((HOME["lat"] + SCHOOL["lat"]) / 2, (HOME["lon"] + SCHOOL["lon"]) / 2)
    assert check_safe_zone(*mid, [route])["inside"]
    assert not check_safe_zone(mid[0] + 0.005, mid[1] + 0.005, [route])["inside"]


# 6.2.3 Sound classification and persistence rule --------------------------------------------
@pytest.mark.parametrize("db,cat", [(40, "Quiet"), (49.9, "Quiet"), (60, "Normal"), (78, "Loud"),
                                    (85, "Loud"), (85.1, "Very Loud"), (100, "Very Loud")])
def test_sound_categories(db, cat):
    assert classify_db(db) == cat


def _series(values, step=5):
    return [(T0 + timedelta(seconds=i * step), v) for i, v in enumerate(values)]


def test_short_transient_does_not_trigger():
    series = _series([55, 55, 93, 55])
    run, transient = persistence(series, 85, 60)
    assert run == 0 and transient
    rec = get_sound_record(93, T0 + timedelta(seconds=10), _series([55, 55]))
    assert not rec["sustained_very_loud"]


def test_sustained_very_loud_triggers_after_60s():
    window = _series([90] * 12)  # 0..55 s
    rec = get_sound_record(91, T0 + timedelta(seconds=60), window)
    assert rec["very_loud_run_seconds"] == 60 and rec["sustained_very_loud"]


def test_gap_in_readings_breaks_the_run():
    series = [(T0, 90), (T0 + timedelta(seconds=30), 90), (T0 + timedelta(seconds=65), 90)]
    run, _ = persistence(series, 85, 60)
    assert run < 60


def test_sound_service_rejects_bad_sensor_values():
    for bad in (None, "abc", -5, 200, float("nan")):
        rec = get_sound_record(bad, T0, [])
        assert rec["db"] is None and not rec["sensor_ok"]


# 6.2.4 Device behaviour scoring -------------------------------------------------------------
def _usage(**kw):
    base = {"screen_minutes": 100, "night_minutes": 10, "gaming_minutes": 20, "study_minutes": 60, "unlocks": 30}
    return get_device_record({**base, **kw})


def test_device_no_violation():
    assert analyze_device_behaviour(_usage())["score"] == 1.0


@pytest.mark.parametrize("kw,expected", [({"screen_minutes": 361}, 0.8), ({"night_minutes": 61}, 0.8),
                                         ({"unlocks": 81}, 0.9)])
def test_device_each_threshold(kw, expected):
    assert analyze_device_behaviour(_usage(**kw))["score"] == expected


def test_case_study_device_score():
    # §5.3: 380 min screen + 75 min night → 0.6
    assert analyze_device_behaviour(_usage(screen_minutes=380, night_minutes=75))["score"] == 0.6


# 6.2.5 Trust score -------------------------------------------------------------------------
def test_trust_all_perfect():
    assert calculate_trust_score(dict(activity=1, schedule=1, location=1, device=1, sound=1)) == 100.0


def test_trust_case_study():
    # §5.3 inputs. NB: the report prints 84%, but the formula evaluates to 83%.
    t = calculate_trust_score(dict(activity=0.8, schedule=0.7, location=1.0, device=0.6, sound=1.0))
    assert t == 83.0


def test_trust_clamps_out_of_range():
    assert calculate_trust_score(dict(activity=5, schedule=-1, location=1, device=1, sound=1)) == 80.0


# Activity classifier ------------------------------------------------------------------------
@pytest.mark.parametrize("rec,label", [
    ({"steps": 0, "movement_level": 0.0, "hour": 23}, "Sleeping"),
    ({"steps": 0, "movement_level": 0.0, "hour": 14}, "Idle"),
    ({"steps": 15, "movement_level": 0.2, "hour": 10}, "Sitting"),
    ({"steps": 60, "movement_level": 0.6, "hour": 10}, "Walking"),
    ({"steps": 110, "movement_level": 0.9, "hour": 10}, "Active"),
])
def test_activity_classes(rec, label):
    assert classify_activity(rec) == label


# 6.3 GPS loss -------------------------------------------------------------------------------
def test_gps_loss_holds_last_position():
    last = {"latitude": 18.52, "longitude": 73.85, "timestamp": T0}
    rec = get_location_record({"lat": None, "lon": None, "gps_fix": False}, T0 + timedelta(seconds=90), last)
    assert rec["stale"] and rec["latitude"] == 18.52 and rec["stale_seconds"] == 90


def test_zero_zero_is_not_a_fix():
    rec = get_location_record({"lat": 0.0, "lon": 0.0}, T0, None)
    assert not rec["fix"] and rec["latitude"] is None
