"""Behaviour Analysis — routine adherence and activity/gaming vs history (report §5.1.6)."""


def analyze_study_hours(expected_hours: float, actual_hours: float) -> dict:
    if actual_hours >= expected_hours:
        score, status = 1.0, "On Track"
    elif actual_hours >= expected_hours * 0.7:
        score, status = 0.7, "Slightly Off"
    else:
        score, status = 0.4, "Poor Routine"
    return {"schedule_score": score, "status": status,
            "expected_hours": round(expected_hours, 2), "actual_hours": round(actual_hours, 2)}


def compare_with_history(today: dict, history: list[dict]) -> list[dict]:
    """Flags gaming / step / screen values that deviate strongly from the child's own average."""
    if not history:
        return []
    findings = []
    for key, label, higher_is_bad in (("screen_minutes", "Screen time", True), ("steps", "Physical activity", False)):
        vals = [h[key] for h in history if h.get(key) is not None]
        if not vals or key not in today:
            continue
        avg = sum(vals) / len(vals)
        if avg <= 0:
            continue
        change = (today[key] - avg) / avg
        if (higher_is_bad and change > 0.4) or (not higher_is_bad and change < -0.4):
            findings.append({
                "metric": key,
                "title": f"{label} unusual",
                "message": f"{label} is {abs(change) * 100:.0f}% {'above' if change > 0 else 'below'} the {len(vals)}-day average",
                "change": round(change, 2),
            })
    return findings
