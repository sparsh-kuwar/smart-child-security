"""End-to-end scenario tests through the HTTP API (report §6.2.1, §6.2.7, §6.3, §6.4)."""


def ingest(client, p, **reading):
    r = client.post("/api/device/ingest", json=reading, headers=p["dev"])
    assert r.status_code == 200, r.text
    return r.json()


def alerts(client, p):
    return client.get(f"/api/children/{p['child']['id']}/alerts", headers=p["headers"]).json()


HOME = dict(lat=18.5205, lon=73.8568)


def test_demo_login_works(client):
    r = client.post("/api/auth/login", json={"email": "demo@safetrack.app", "password": "demo1234"})
    assert r.status_code == 200 and r.json()["token"]


def test_auth_required(client):
    assert client.get("/api/children").status_code == 401
    assert client.post("/api/device/ingest", json={}, headers={"X-Device-Key": "nope"}).status_code == 401


def test_cannot_read_other_parents_child(client, parent):
    other = client.post("/api/auth/register", json={"name": "B", "email": "b-other@test.dev", "password": "secret123"}).json()
    r = client.get(f"/api/children/{parent['child']['id']}/live", headers={"Authorization": f"Bearer {other['token']}"})
    assert r.status_code == 404


def test_normal_reading_inside_home(client, parent):
    res = ingest(client, parent, **HOME, steps=10, movement=0.2, sound_db=45)
    assert res["zone"] == "Home" and res["sound"] == "Quiet" and res["actuate"]["led"] == "green"
    live = client.get(f"/api/children/{parent['child']['id']}/live", headers=parent["headers"]).json()
    assert live["reading"]["zone"] == "Home" and 0 <= live["trust"]["trust"] <= 100


def test_rfid_registered_unregistered_duplicate(client, parent):
    cid = parent["child"]["id"]
    tag = client.get(f"/api/children/{cid}/tags", headers=parent["headers"]).json()[0]["uid"]
    ingest(client, parent, **HOME, rfid_uid=tag, sound_db=50)
    ingest(client, parent, **HOME, rfid_uid=tag, sound_db=50)  # within debounce
    ingest(client, parent, **HOME, rfid_uid="DE:AD:BE:EF", sound_db=50)
    rows = client.get(f"/api/children/{cid}/attendance", headers=parent["headers"]).json()
    statuses = sorted(r["status"] for r in rows if r["ts"] >= rows[-1]["ts"])
    assert statuses.count("accepted") >= 1 and "duplicate" in statuses and "rejected" in statuses
    titles = [a["title"] for a in alerts(client, parent)]
    assert any("Unregistered RFID" in t for t in titles)


def test_sos_is_critical_and_buzzes(client, parent):
    res = ingest(client, parent, **HOME, sos=True, sound_db=50)
    assert res["actuate"]["buzzer"] and res["actuate"]["led"] == "red"
    assert any(a["category"] == "sos" and a["level"] == "critical" for a in alerts(client, parent))


def test_case_study_critical_combo(client, parent):
    # Outside every zone + sustained ~92 dB for > 60 s, using buffered timestamps.
    far = dict(lat=18.56, lon=73.90)
    readings = [dict(**far, sound_db=92, age_s=80 - i * 5, steps=60, movement=0.6) for i in range(17)]
    res = client.post("/api/device/ingest", json={"readings": readings}, headers=parent["dev"]).json()
    assert res["processed"] == 17 and res["actuate"]["buzzer"]
    crit = [a for a in alerts(client, parent) if a["level"] == "critical" and a["category"] == "location"]
    assert crit and "very loud" in crit[0]["title"].lower()


def test_gps_loss_alert(client, parent):
    ingest(client, parent, **HOME, sound_db=45, age_s=100)
    for age in (90, 60, 30, 0):
        ingest(client, parent, lat=None, lon=None, gps_fix=False, sound_db=45, age_s=age)
    assert any(a["category"] == "gps" for a in alerts(client, parent))


def test_boot_event_and_battery(client, parent):
    ingest(client, parent, **HOME, event="boot", battery=87, fw="1.0.0", sound_db=45)
    child = client.get(f"/api/children/{parent['child']['id']}", headers=parent["headers"]).json()
    assert child["battery"] == 87 and child["firmware"] == "1.0.0" and child["data_source"] == "device"


def test_parent_buzz_command_is_delivered(client, parent):
    cid = parent["child"]["id"]
    client.post(f"/api/children/{cid}/commands", json={"type": "buzz"}, headers=parent["headers"])
    res = ingest(client, parent, **HOME, sound_db=45)
    assert res["actuate"]["buzzer"] and res["commands"][0]["type"] == "buzz"


def test_zone_crud_and_settings(client, parent):
    cid = parent["child"]["id"]
    z = client.post(f"/api/children/{cid}/zones", headers=parent["headers"],
                    json={"name": "Tuition", "kind": "other", "lat": 18.51, "lon": 73.84, "radius_m": 120}).json()
    assert z["name"] == "Tuition"
    client.delete(f"/api/children/{cid}/zones/{z['id']}", headers=parent["headers"])
    r = client.patch(f"/api/children/{cid}", headers=parent["headers"], json={"settings": {"screen_limit_minutes": 240}})
    assert r.json()["settings"]["screen_limit_minutes"] == 240


def test_dashboard_endpoints_respond(client, parent):
    cid = parent["child"]["id"]
    ingest(client, parent, **HOME, sound_db=55, steps=20, movement=0.3)
    for path in ("live", "trust", "sound", "device", "schedule", "history", "simulator", "readings"):
        r = client.get(f"/api/children/{cid}/{path}", headers=parent["headers"])
        assert r.status_code == 200, (path, r.text)
    h = client.get(f"/api/children/{cid}/history", headers=parent["headers"]).json()
    assert len(h["days"]) >= 14 and h["aggregate"]["days"] >= 14


def test_trust_whatif(client):
    r = client.post("/api/trust/calculate", json=dict(activity=0.8, schedule=0.7, location=1, device=0.6, sound=1))
    assert r.json()["trust"] == 83.0


def test_simulator_generates_through_pipeline(client, parent):
    from app import simulator
    cid = parent["child"]["id"]
    client.post(f"/api/children/{cid}/simulator", json={"enabled": True}, headers=parent["headers"])
    simulator.tick_child(cid)
    simulator.start_scenario(cid, "sos")
    simulator.tick_child(cid)
    live = client.get(f"/api/children/{cid}/live", headers=parent["headers"]).json()
    assert live["reading"]["source"] == "simulator"
    assert any(a["category"] == "sos" for a in alerts(client, parent))
