# Technologies used in SafeTrack

This document explains **what** technology each layer of SafeTrack uses, **why** it was chosen, and **where** it is in
the code. It follows the four-layer architecture from the project report (§4.1): hardware, service layer, ML /
analytics layer, and cloud monitoring and response. It then covers the parent app and deployment.

---

## 1. Overview

| Layer | Technologies |
|---|---|
| Hardware | Arduino Uno, RC522 RFID, Neo-6M GPS, electret sound sensor, buzzer, LEDs, ESP8266 Wi-Fi |
| Firmware | Arduino C++ · MFRC522 · TinyGPSPlus · ArduinoJson · ESP8266 core |
| Backend (service + ML layers) | Python 3.12 · FastAPI · Uvicorn · SQLAlchemy 2 · Pydantic 2 · PyJWT · httpx |
| Database | SQLite (default) or PostgreSQL (psycopg 3) |
| Real-time | Server-Sent Events (SSE) · asyncio |
| Cloud & notifications | ThingSpeak REST API · Twilio SMS · webhooks · Browser Notifications API |
| Frontend (parent app) | React 18 · TypeScript · Vite · Tailwind CSS · Leaflet + OpenStreetMap · Recharts · Framer Motion · Lucide icons |
| Testing | pytest · FastAPI TestClient · Playwright (UI checks during development) |
| Deployment | Docker (multi-stage) · Render (Blueprint `render.yaml`) · GitHub |

```
 Arduino Uno ──serial JSON──► ESP8266 ──HTTPS POST──► FastAPI backend ──SSE──► React parent app
  (sensors)   ◄──"A:1,R"────   (Wi-Fi)  ◄──actuate───   │  services → ML → alerts
                                                        ├──► SQLite / PostgreSQL
                                                        ├──► ThingSpeak (cloud charts)
                                                        └──► SMS / webhook / browser notifications
```

---

## 2. Hardware layer

| Component | Interface | Role |
|---|---|---|
| **Arduino Uno** (ATmega328P) | — | Main controller: reads every sensor and drives the buzzer and LEDs |
| **RC522 RFID reader** (13.56 MHz, MIFARE) | SPI (D10–D13, RST D9) | Reads the child's ID card UID at the school gate |
| **Neo-6M GPS** | UART via SoftwareSerial (D4/D3) | Latitude, longitude, satellite count and speed |
| **Electret microphone + envelope detector** | Analogue A0 | Sound intensity, converted to a dB estimate on the device |
| **Buzzer** | Digital D6 | Local audible alarm (SOS or critical alert) |
| **LEDs** (green / amber / red) | D7 / A1 / D8 | Status: safe / warning or offline / critical |
| **SOS push-button** | D2 (internal pull-up) | Long press (0.8 s) to trigger an emergency |
| **ESP8266** | Hardware serial (D0/D1) | Wi-Fi bridge to the server |

**Why this hardware:** it is cheap and widely available, well documented, and matches the parts list in the report (§3.1.1).

**Code:** `hardware/arduino_uno/arduino_uno.ino`, `hardware/esp8266_bridge/esp8266_bridge.ino`

### Firmware details

- **Arduino C++**, built in the Arduino IDE.
- **MFRC522 library:** reads the card UID. A 3 s debounce on the device prevents flooding, and the server applies its own configurable 60 s debounce.
- **TinyGPSPlus:** parses the NMEA sentences from the Neo-6M.
- **Sound to dB:** the firmware measures peak-to-peak amplitude over a 50 ms window and computes `dB = 20·log10(p2p) + offset`. Samples are discarded immediately and **no audio is ever stored or sent**.
- **Movement and steps:** the parts list has no accelerometer, so these are estimated from GPS speed. An MPU-6050 can be added later.
- **ESP8266 + ArduinoJson:** POSTs readings over HTTPS. If Wi-Fi drops, it keeps up to 24 readings in a ring buffer and uploads them as one batch, each with an `age_s` field, when the connection returns. It parses the server's reply and sends `A:<buzzer>,<led>` back to the Uno.

---

## 3. Backend: service layer and ML / analytics layer

### Core technologies

| Technology | Version | Why it was used |
|---|---|---|
| **Python** | 3.12 | The report specifies a Python service layer, and Python is easy to read and test |
| **FastAPI** | 0.115 | Modern, fast REST framework with automatic validation and interactive API docs at `/api/docs` |
| **Uvicorn** | 0.32 | ASGI server that runs FastAPI and supports long-lived SSE connections |
| **Pydantic** | 2.10 | Validates request bodies (zones, settings, schedule), so malformed input is rejected |
| **SQLAlchemy** | 2.0 | ORM: the same code works on SQLite and on PostgreSQL |
| **SQLite** | built-in | Zero-setup database for local runs and demos. WAL mode allows concurrent reads |
| **PostgreSQL + psycopg 3** | optional | Permanent storage in the cloud (set `DATABASE_URL`) |
| **PyJWT** | 2.10 | Signed login tokens (JWT, HS256) |
| **hashlib PBKDF2-SHA256** | standard library | Password hashing with a random salt and 200,000 iterations |
| **httpx** | 0.28 | Outbound HTTP to ThingSpeak, Twilio and webhooks (with timeouts) |
| **asyncio + thread pool** | standard library | Runs the simulator and housekeeping in the background, and sends notifications without blocking |
| **zoneinfo + tzdata** | — | Day boundaries and schedules in IST (`Asia/Kolkata`) |

### Six services (report §4.1.2) in `backend/app/services/`

Each service is a pure function that validates raw input and returns a structured record (a dictionary).

| Service | File | What it does |
|---|---|---|
| Location | `location.py` | Validates lat/lon, rejects the (0,0) "no fix" value, and keeps the last good position when GPS is lost (flagged *stale*) |
| Activity | `activity.py` | Cleans up steps, movement (0–1) and screen state, and works out the hour and period of day |
| Device | `device.py` | Screen, night, gaming and study minutes, and unlock count |
| Behaviour | `behaviour.py` | Compares today's figures with yesterday's |
| Schedule | `schedule.py` | Planned vs observed: school arrival time, study hours, bedtime device use |
| Ambient Sound | `sound.py` | Accepts **only a numeric dB value** and computes the category, rolling average and persistence |

### ML / analytics layer (report §5.1.6) in `backend/app/ml/`

> **Being honest about "ML":** like the report, these modules are **rule-based and threshold-based models**
> (explainable heuristics), not trained neural networks. That is a deliberate choice: there is no labelled
> real-world dataset yet, and rules can be explained and tested. Report §8.2 lists trained models as future work.

| Module | Technique |
|---|---|
| **Activity classifier** | Decision rules on steps, movement, screen state and hour, giving one of Sleeping, Idle, Sitting, Walking or Active. Each activity then gets a "fits the time of day" score |
| **Safe-zone model** | **Haversine formula** for great-circle distance to each circular zone. **Point-to-segment distance** for school-bus route corridors. Inside = 1.0, outside = 0.3 |
| **Sound-level classifier** | Quiet < 50 dB, Normal 50–70, Loud 70–85, Very Loud > 85. A **5-minute rolling average** plus a **persistence rule**: alert only if the level stays above 85 dB for 60 s, so short spikes are ignored |
| **Device behaviour model** | Starts at 1.0. Subtracts 0.2 for screen > 360 min, 0.2 for night use > 60 min, 0.1 for > 80 unlocks, and 0.2 if gaming exceeds study |
| **Behaviour analysis** | Study-hours adherence, and comparison with the child's own multi-day average (flags changes over 40%) |
| **Daily trend analyzer** | Compares today's component scores with yesterday's and flags rises or drops of 0.2 or more |
| **Alert analyzer** | Combines all signals into **Critical / Warning / Info** alerts. Each alert has a *cooldown key* so repeats are suppressed. Critical alerts sound the device buzzer and turn on the red LED |
| **Schedule optimizer** | Splits the day into morning, afternoon, evening and night, finds the current and next activity, and builds smart reminders from what it observes |
| **History aggregator** | Multi-day averages, best and worst day, activity mix and sound mix |
| **Trust Score** | `T = 100 × (0.25·Sa + 0.20·Ss + 0.25·Sl + 0.15·Sd + 0.15·Sn)` with each input clamped to 0–1. Bands: Safe ≥ 80, Watch ≥ 60, Concern ≥ 45, Critical < 45 |

### Processing pipeline in `backend/app/pipeline.py`

For every reading:

1. Run all six services.
2. Classify activity, check the safe zones and classify the sound.
3. Handle RFID (accept, reject or ignore as a duplicate) and SOS.
4. Compute the 5 Trust Score components.
5. Generate alerts, skipping any still in cooldown.
6. Save everything to the database.
7. Push live updates to open dashboards.
8. Publish to ThingSpeak and send SMS / webhook notifications.
9. Reply to the device with `actuate: {buzzer, led}`.

The **built-in simulator** (`simulator.py`) sends readings through **exactly the same pipeline**, so the demo exercises the real code.

---

## 4. Real-time updates

| Technology | Use |
|---|---|
| **Server-Sent Events (SSE)** | The server pushes `reading`, `alert` and `attendance` events to the dashboard over one long-lived HTTP connection (`/api/children/{id}/stream`) |
| **asyncio pub/sub hub** (`realtime.py`) | Thread-safe fan-out from the processing threads to the connected browsers |
| **Polling fallback** | The app also re-fetches every ~9 s in case the stream drops |

**Why SSE and not WebSockets:** the data only flows one way (server to parent). SSE works over plain HTTP, reconnects
automatically and needs no extra library.

---

## 5. Cloud monitoring and response

| Technology | Use |
|---|---|
| **ThingSpeak REST API** | Publishes field1 = latitude, field2 = longitude, field3 = dB, field4 = sound category, field5 = Trust Score and field6 = alert level, at most once every 15 s (the free-tier limit) |
| **Twilio SMS API** | Optional SMS with a Google Maps link for **critical** alerts |
| **Webhooks** | Every alert is POSTed as JSON to a URL you choose (Slack, Discord, Telegram bot, IFTTT, …) |
| **Browser Notifications API** | Desktop or phone pop-ups while the dashboard is open in the background |

---

## 6. Frontend: parent web app (`frontend/`)

| Technology | Version | Why it was used |
|---|---|---|
| **React** | 18.3 | Component-based UI with a large ecosystem |
| **TypeScript** | 5.6 | Type safety: API data types live in `src/lib/types.ts` |
| **Vite** | 5.4 | Fast dev server and optimised production build with lazy-loaded pages |
| **Tailwind CSS** | 3.4 | Utility-first styling, with dark and light themes built from CSS variables |
| **React Router** | 6.28 | Page navigation for the 12 pages and protected routes |
| **Leaflet + React-Leaflet** | 1.9 / 4.2 | Interactive map with zones, route corridors, trail and alert pins |
| **OpenStreetMap tiles** | — | Free map data with no API key. Dark mode recolours the tiles with a CSS filter |
| **Recharts** | 2.13 | Charts for sound level, Trust Score history, activity timeline, screen time and history |
| **Framer Motion** | 11 | Animations: Trust Score ring, page transitions, critical-alert overlay, toasts |
| **Lucide React** | 0.460 | Icons |
| **PWA manifest** | — | Can be installed on a phone home screen like an app |

**Key UI pieces:**
- `TrustRing.tsx` draws the formula as a ring: each segment's length is its weight, and how much is lit is its value.
- `SoundMeter.tsx` shows the dB meter and the countdown for the 60 s persistence rule.
- `LiveMap.tsx` draws the map, zones and corridors.
- `Overlays.tsx` holds the full-screen critical alert and the toasts.
- `live.tsx` handles the SSE connection and data refreshes.

---

## 7. Security

| Concern | How it is handled |
|---|---|
| Passwords | PBKDF2-SHA256 with a random 16-byte salt and 200k iterations. Never stored in plain text |
| Sessions | JWT (HS256) signed with `SECRET_KEY`, which Render generates. Expires after 7 days |
| Device authentication | Each child's device has its own `X-Device-Key`, which can be rotated from the Device lab |
| Data isolation | Every endpoint checks the child belongs to the logged-in parent |
| Input validation | Pydantic models and range checks (lat/lon, dB 0–140, radius 20–5000 m, …) |
| Privacy | Audio is reduced to a dB value on the device. RFID cards hold only a UID, never the student's personal details |

---

## 8. Testing

| Tool | What is tested |
|---|---|
| **pytest** (44 tests) | The report's Chapter 6 test cases: Haversine distance, inside / outside zones, route corridor, all four sound categories, transient vs sustained loud sound, device thresholds, Trust Score (including the §5.3 case study, which comes to 83), activity classes, GPS loss |
| **FastAPI TestClient** | End-to-end API scenarios: RFID accepted / rejected / duplicate, SOS buzzer, critical combo, buffered upload, GPS loss alert, restart, parent commands, authorisation |
| **Playwright + Chrome** | Used during development to screenshot every page on desktop and mobile, and to confirm the critical-alert overlay fires after the 60 s rule |

Run the tests with `cd backend && python -m pytest -q`.

---

## 9. Deployment and DevOps

| Technology | Use |
|---|---|
| **Docker** (multi-stage) | Stage 1 builds the React app with Node 20. Stage 2 is Python 3.12-slim, serving the API and the built frontend from one container |
| **Render** | Cloud hosting. `render.yaml` defines a free Docker web service with a health check at `/api/health` and a generated secret |
| **GitHub** | Source control. Render redeploys automatically on every push to `main` |
| **Docker volume** | For local deployment: `safetrack-data` keeps the database across restarts |

---

## 10. Why this stack, in short

- **One language per side:** Python for the analytics (as the report requires) and TypeScript for the UI.
- **Free and open:** OpenStreetMap, SQLite, ThingSpeak's free tier and Render's free plan. No paid API keys are needed to run it.
- **Explainable:** rule-based models and a weighted score, so every alert can be explained.
- **Testable without hardware:** the simulator uses the same pipeline, so every report scenario can be demonstrated live.
- **Swappable:** SQLite to PostgreSQL, simulator to real Arduino, and rule-based to trained models later, with no change to the API.
