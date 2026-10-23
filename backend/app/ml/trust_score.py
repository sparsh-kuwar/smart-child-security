"""Trust Score — T = 100 × (0.25·Sa + 0.20·Ss + 0.25·Sl + 0.15·Sd + 0.15·Sn)  (report §5.1.7).

A descriptive prioritisation index, not a validated probability of safety.
"""
from ..config import TRUST_WEIGHTS


def _clamp(v) -> float:
    try:
        v = float(v)
    except (TypeError, ValueError):
        return 0.0
    return min(1.0, max(0.0, v))


def calculate_trust_score(components: dict) -> float:
    total = sum(_clamp(components.get(k, 0)) * w for k, w in TRUST_WEIGHTS.items())
    return round(total * 100, 1)


def trust_band(score: float) -> dict:
    if score >= 80:
        return {"band": "safe", "label": "All good"}
    if score >= 60:
        return {"band": "watch", "label": "Keep an eye"}
    if score >= 45:
        return {"band": "concern", "label": "Needs attention"}
    return {"band": "critical", "label": "Act now"}


def explain(components: dict) -> list[dict]:
    """Per-component contribution, sorted by how many points it costs."""
    rows = []
    for k, w in TRUST_WEIGHTS.items():
        v = _clamp(components.get(k, 0))
        rows.append({"component": k, "value": round(v, 3), "weight": w,
                     "points": round(v * w * 100, 1), "lost": round((1 - v) * w * 100, 1)})
    return sorted(rows, key=lambda r: -r["lost"])
