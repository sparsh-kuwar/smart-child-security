# SafeTrack — Smart Child Security System

**IoT · Machine Learning · Privacy-aware ambient sound sensing**

B.Tech project, Department of Computer Engineering, JSPM's Rajarshi Shahu College of Engineering, Pune (2026–27).

SafeTrack combines RFID attendance, GPS geofencing, ambient sound-level sensing, device-usage analytics and a weighted
**Trust Score** into one live dashboard for parents. **Raw audio is never recorded, stored or transmitted.** Only an
estimated dB level and its category are kept.

> **Try it:** open the deployed app and click **"Try the live demo"**. A virtual device plays a compressed school day
> on a loop. Open **Device lab** to inject any of the report's test scenarios (SOS, leaving a safe zone, sustained loud
> noise, GPS loss, unregistered RFID, network loss, and more) and watch the dashboard react live.

---

## Architecture (report §4.1)

```
 ┌──────────── Hardware layer ────────────┐      ┌──────────────── Server (FastAPI) ────────────────┐
 │ Arduino Uno                            │      │ Service layer (app/services)                     │
 │  RC522 RFID · Neo-6M GPS · sound (A0)  │ JSON │  Location · Activity · Device · Behaviour ·      │
 │  buzzer · LEDs · SOS button            ├─────►│  Schedule · Ambient Sound                        │
 │ ESP8266 Wi-Fi bridge (buffers offline) │◄─────┤ ML / analytics layer (app/ml)                    │
 └────────────────────────────────────────┘ act. │  Activity classifier · Safe-zone (Haversine) ·   │
                 ▲                               │  Device behaviour · Sound classifier + persist.  │
     built-in simulator (same pipeline)          │  Behaviour analysis · Daily trends · Alert       │
                                                 │  analyzer · Schedule optimizer · History agg. ·  │
                                                 │  Trust Score                                      │
                                                 │ Cloud & response: ThingSpeak · SMS · webhook ·   │
                                                 │  live updates (SSE) → React dashboard (PWA)      │
                                                 └──────────────────────────────────────────────────┘
```

| Report requirement | Where it lives |
|---|---|
| RFID attendance, reject unregistered tags, debounce duplicates | `backend/app/pipeline.py → process_rfid` |
| GPS validation; tolerate missing fixes | `backend/app/services/location.py` |
| Haversine safe zones (1.0 inside / 0.3 outside), plus route corridors | `backend/app/ml/safe_zone.py` |
| Sound categories (Quiet / Normal / Loud / Very Loud), 5-min rolling window, 60 s persistence rule | `backend/app/ml/sound_classifier.py`, `services/sound.py` |
| Device behaviour thresholds (>360 min screen, >60 min night, >80 unlocks) | `backend/app/ml/device_behaviour.py` |
| Trust Score `T = 100 × (0.25·Sa + 0.20·Ss + 0.25·Sl + 0.15·Sd + 0.15·Sn)` | `backend/app/ml/trust_score.py` |
| Critical / Warning / Info prioritisation, buzzer + LED actuation | `backend/app/ml/alert_analyzer.py` |
| Daily trends, history aggregation, schedule optimizer | `backend/app/ml/*.py` |
| ThingSpeak publishing, SMS / push notifications | `backend/app/notify.py` |
| Failure handling: GPS loss, network loss + buffered sync, restart, offline device | pipeline, simulator, firmware |
| Firmware | `hardware/arduino_uno`, `hardware/esp8266_bridge` |

## Features

- **Live overview:** where the child is, current activity, sound level, Trust Score ring (each segment's length is its weight), RFID log and alerts. Everything updates in real time over Server-Sent Events.
- **Live map:** OpenStreetMap with safe zones, the bus-route corridor, a movement trail and pins for location alerts.
- **Safe-zone editor:** click to place or resize home, school, route or other zones. No firmware changes needed.
- **Ambient sound:** dB meter, rolling average, persistence-rule countdown, category mix, and a description of the privacy pipeline.
- **Activity & device:** activity timeline, device-usage thresholds and violations, 14-day screen-time chart.
- **RFID attendance:** entry/exit log, on-time rate, rejected and duplicate scans, card management.
- **Trust Score:** live breakdown, history, per-component chart, and a what-if calculator.
- **Alerts:** filters, acknowledge, a full-screen takeover for critical alerts, and browser notifications.
- **History and schedule:** multi-day aggregates, daily trend detection, routine editor, smart reminders.
- **Device lab:** simulator timeline, 12 one-click test scenarios, device key, and hardware set-up steps.
- **Settings:** child profile, every threshold, SMS / webhook, ThingSpeak, and multiple children.
- Dark and light themes, mobile-first layout with a bottom nav, and installable as a PWA.

## Run locally

```bash
# backend (Python 3.11+)
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8765 --reload

# frontend (Node 20+), in another terminal
cd frontend
npm install
npm run dev            # http://localhost:5173 (proxies /api to :8765)
```

Demo login: `demo@safetrack.app` / `demo1234` (or click **Try the live demo**).

### Tests

```bash
cd backend && .venv/bin/pip install pytest && .venv/bin/python -m pytest -q
```

44 tests mirror report Chapter 6: safe-zone detection, sound classification and the persistence rule, device
scoring, the Trust Score (including the §5.3 case study), RFID registered / unregistered / duplicate, SOS, the
critical combo scenario, GPS loss, restart, commands, and API authorisation.

## Deploy (Render)

The repo ships a `Dockerfile` and a `render.yaml` blueprint: **Render → New → Blueprint → pick this repo**.
The free plan works. Note that the free plan's disk is temporary, so data resets when the service restarts and the
demo account is re-created automatically. To keep data across restarts, attach a Render Postgres database and set
`DATABASE_URL`.

| Env var | Purpose |
|---|---|
| `SECRET_KEY` | Signs login tokens (Render generates it) |
| `DATABASE_URL` | Optional Postgres URL (default: SQLite) |
| `APP_TIMEZONE` | Day boundaries / schedule (default `Asia/Kolkata`) |
| `SIMULATOR_ENABLED`, `SIM_TICK_SECONDS` | Virtual device on/off and its interval (default `1`, `5`) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Optional SMS for critical alerts |

## Connect the real device

1. Wire the Uno as described at the top of `hardware/arduino_uno/arduino_uno.ino` and flash it (libraries: MFRC522, TinyGPSPlus).
2. Copy `hardware/esp8266_bridge/config.example.h` to `config.h`. Fill in your Wi-Fi details, the server URL and the **device key** from the Device lab page, then flash the ESP8266 (library: ArduinoJson 7).
3. When the first reading arrives, the simulator switches off and the dashboard shows **Hardware**.

Device API: `POST /api/device/ingest` with header `X-Device-Key`. Interactive docs are at `/api/docs`.

## Honest notes

- The Trust Score helps decide what needs attention first. It is **not** a validated probability of safety.
- The prototype parts list has no accelerometer, so the firmware estimates movement and steps from GPS speed. An MPU-6050 can be added for indoor accuracy.
- Device-usage figures (screen, gaming, study, unlocks) come from a companion phone app via `POST /api/device/usage`. In the demo they are simulated.
- Back-filled history in a fresh demo is labelled **simulated** in the UI.
