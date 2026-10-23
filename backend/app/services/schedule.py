"""Schedule Service — compares planned activities against observed timing (report §4.1.2)."""
from datetime import datetime

from ..db import to_local
from ..ml.behaviour_analysis import analyze_study_hours


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def get_schedule_record(
    now: datetime,
    school_start: str,
    arrival_ts: datetime | None,
    study_minutes: float,
    study_target_hours: float,
    night_minutes: float,
    night_limit: float,
    weekday: bool,
) -> dict:
    local_now = to_local(now)
    now_min = local_now.hour * 60 + local_now.minute
    checks = []

    # 1. Reached school on time (weekdays, once the start time has passed)
    if weekday and now_min >= _minutes(school_start):
        if arrival_ts is None:
            late = now_min - _minutes(school_start)
            score = 1.0 if late <= 15 else 0.4
            checks.append({
                "name": "School arrival",
                "planned": school_start,
                "observed": "not yet scanned",
                "ok": late <= 15,
                "score": score,
            })
        else:
            arr = to_local(arrival_ts)
            arr_min = arr.hour * 60 + arr.minute
            late = arr_min - _minutes(school_start)
            score = 1.0 if late <= 5 else 0.7 if late <= 20 else 0.4
            checks.append({
                "name": "School arrival",
                "planned": school_start,
                "observed": arr.strftime("%H:%M"),
                "ok": late <= 5,
                "score": score,
            })

    # 2. Home study vs target — prorated over the after-school window (15:00–21:00) so the
    #    check only applies once there has been time to study.
    if now_min >= 15 * 60:
        fraction = min(1.0, (now_min - 15 * 60) / (6 * 60))
        expected_hours = max(0.25, study_target_hours * fraction)
        study = analyze_study_hours(expected_hours, study_minutes / 60)
        checks.append({
            "name": "Study time",
            "planned": f"{expected_hours:.1f} h by now",
            "observed": f"{study_minutes / 60:.1f} h",
            "ok": study["schedule_score"] >= 1.0,
            "score": study["schedule_score"],
        })

    # 3. Bedtime respected (night-time device use)
    ok = night_minutes <= night_limit
    checks.append({
        "name": "Bedtime routine",
        "planned": f"≤ {int(night_limit)} min device use after 22:00",
        "observed": f"{int(night_minutes)} min",
        "ok": ok,
        "score": 1.0 if ok else 0.5,
    })

    score = sum(c["score"] for c in checks) / len(checks)
    return {"checks": checks, "adherence": round(score, 3), "timestamp": now}
