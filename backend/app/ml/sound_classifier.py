"""Ambient Sound-Level Classifier with rolling-window persistence rule (report §5.1.4)."""
from datetime import datetime

CATEGORIES = ("Quiet", "Normal", "Loud", "Very Loud")
MAX_GAP_SECONDS = 20  # a gap longer than this between readings breaks a continuous run


def classify_db(db: float) -> str:
    if db < 50:
        return "Quiet"
    if db < 70:
        return "Normal"
    if db <= 85:
        return "Loud"
    return "Very Loud"


def _run_ending_at(series: list[tuple[datetime, float]], end: int, threshold: float) -> float:
    """Duration (s) of the continuous above-threshold run that ends at index `end`."""
    start = end
    while start > 0:
        prev_t, prev_d = series[start - 1]
        if prev_d <= threshold or (series[start][0] - prev_t).total_seconds() > MAX_GAP_SECONDS:
            break
        start -= 1
    return (series[end][0] - series[start][0]).total_seconds()


def persistence(series: list[tuple[datetime, float]], threshold: float = 85,
                persist_seconds: float = 60) -> tuple[float, bool]:
    """Returns (current very-loud run length in seconds, whether a short transient just ended).

    A Very-Loud event is only flagged when the run length reaches `persist_seconds`; a run that
    ends before that is a suppressed transient (e.g. a door slam) and never raises an alert.
    """
    if not series:
        return 0.0, False
    last = len(series) - 1
    if series[last][1] > threshold:
        return _run_ending_at(series, last, threshold), False
    if last >= 1 and series[last - 1][1] > threshold:
        return 0.0, _run_ending_at(series, last - 1, threshold) < persist_seconds
    return 0.0, False


def sound_safety_score(sound: dict) -> float:
    """Sn component of the Trust Score."""
    if sound.get("sustained_very_loud"):
        return 0.2
    if sound.get("very_loud_run_seconds", 0) > 0 and sound.get("rolling_category") == "Very Loud":
        return 0.6
    if sound.get("rolling_category") == "Loud":
        return 0.8
    return 1.0
