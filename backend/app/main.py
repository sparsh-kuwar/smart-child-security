import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import delete, select

from . import simulator
from .config import FRONTEND_DIST
from .db import Base, SessionLocal, engine, iso, utcnow
from .models import Alert, Child, Reading, TrustSnapshot
from .pipeline import add_alert, alert_json
from .realtime import hub
from .routers import auth, children, device, insights
from .seed import ensure_demo
from .summaries import refresh_today

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")


def _housekeeping():
    """Offline detection for real devices, daily summaries and data retention."""
    with SessionLocal() as db:
        now = utcnow()
        for child in db.scalars(select(Child)):
            if child.data_source == "device" and not child.simulator_enabled and child.last_seen:
                gap = (now - child.last_seen).total_seconds()
                limit = (child.settings or {}).get("offline_after_seconds", 120)
                if gap > limit:
                    a = add_alert(db, child, {"key": "offline", "level": "warning", "category": "system",
                                              "title": "Device offline",
                                              "message": f"No data from {child.name}'s device for {gap / 60:.0f} min.",
                                              "cooldown": 3600}, now)
                    if a:
                        db.commit()
                        hub.publish(child.id, "alert", alert_json(a))
            refresh_today(db, child)
        db.execute(delete(Reading).where(Reading.ts < now - timedelta(days=3)))
        db.execute(delete(TrustSnapshot).where(TrustSnapshot.ts < now - timedelta(days=8)))
        db.execute(delete(Alert).where(Alert.ts < now - timedelta(days=60)))
        db.commit()


async def housekeeping_loop():
    while True:
        await asyncio.sleep(120)
        try:
            await asyncio.to_thread(_housekeeping)
        except Exception:
            log.exception("housekeeping failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        ensure_demo(db)
    hub.bind(asyncio.get_running_loop())
    tasks = [asyncio.create_task(simulator.run_simulator()), asyncio.create_task(housekeeping_loop())]
    yield
    for t in tasks:
        t.cancel()


class SelectiveGZip:
    """GZip everything except Server-Sent Events — compressing a stream buffers it until close."""

    def __init__(self, app):
        self.app = app
        self.gzip = GZipMiddleware(app, minimum_size=1024)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].endswith("/stream"):
            return await self.app(scope, receive, send)
        return await self.gzip(scope, receive, send)


app = FastAPI(title="SafeTrack — Smart Child Security System", version="2.0.0", lifespan=lifespan,
              docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(SelectiveGZip)
app.include_router(auth.router)
app.include_router(children.router)
app.include_router(insights.router)
app.include_router(device.router)


@app.get("/api/health")
def health():
    return {"ok": True, "time": iso(utcnow())}


@app.exception_handler(404)
async def spa_fallback(request: Request, exc):
    # Unknown API routes stay JSON 404s; everything else serves the single-page app.
    if request.url.path.startswith("/api/") or not (FRONTEND_DIST / "index.html").exists():
        detail = getattr(exc, "detail", "Not found")
        return JSONResponse({"detail": detail}, status_code=404)
    return FileResponse(FRONTEND_DIST / "index.html")


if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
