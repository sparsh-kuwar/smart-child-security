import os
import sys
import tempfile
from pathlib import Path

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["SIMULATOR_ENABLED"] = "0"
os.environ["FRONTEND_DIST"] = f"{_tmp}/no-frontend"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def parent(client):
    import uuid
    email = f"p{uuid.uuid4().hex[:8]}@test.dev"
    r = client.post("/api/auth/register", json={"name": "Parent", "email": email, "password": "secret123",
                                                "child_name": "Kid"})
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    child = client.get("/api/children", headers=headers).json()[0]
    # isolate tests from the simulator
    client.post(f"/api/children/{child['id']}/simulator", json={"enabled": False}, headers=headers)
    return {"headers": headers, "child": child, "dev": {"X-Device-Key": child["device_key"]}}
