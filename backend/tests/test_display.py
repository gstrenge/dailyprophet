"""
Tests for display schedule endpoints and manual override logic.
"""

from unittest.mock import patch
from datetime import datetime

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_now(hour: int, minute: int = 0):
    """Return a patch context that pins datetime.now() for the display module."""
    fake = datetime(2026, 4, 18, hour, minute, 0)
    return patch("app.routes.display.datetime", wraps=datetime, **{
        "now.return_value": fake,
    })


# ---------------------------------------------------------------------------
# Basic schedule CRUD
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_get_default_schedule(client):
    r = await client.get("/display/schedule")
    assert r.status_code == 200
    data = r.json()
    assert data["enabled"] is False
    assert data["on_time"] == "08:00"
    assert data["off_time"] == "22:00"
    assert data["override"] is None


@pytest.mark.anyio
async def test_put_schedule_clears_override(client):
    await client.post("/display/override", json={"override": "on"})
    r = await client.get("/display/schedule")
    assert r.json()["override"] == "on"

    await client.put("/display/schedule", json={
        "enabled": True, "on_time": "09:00", "off_time": "21:00",
    })
    r = await client.get("/display/schedule")
    data = r.json()
    assert data["on_time"] == "09:00"
    assert data["off_time"] == "21:00"
    assert data["override"] is None


# ---------------------------------------------------------------------------
# POST /display/override
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_set_override_on(client):
    r = await client.post("/display/override", json={"override": "on"})
    assert r.status_code == 200
    assert r.json()["override"] == "on"


@pytest.mark.anyio
async def test_set_override_off(client):
    r = await client.post("/display/override", json={"override": "off"})
    assert r.status_code == 200
    assert r.json()["override"] == "off"


@pytest.mark.anyio
async def test_clear_override(client):
    await client.post("/display/override", json={"override": "on"})
    r = await client.post("/display/override", json={"override": None})
    assert r.status_code == 200
    assert r.json()["override"] is None


@pytest.mark.anyio
async def test_invalid_override_rejected(client):
    r = await client.post("/display/override", json={"override": "maybe"})
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Auto-clear logic
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_auto_clear_override_on_within_schedule(client):
    """override="on" auto-clears when we're inside scheduled hours."""
    await client.put("/display/schedule", json={
        "enabled": True, "on_time": "08:00", "off_time": "22:00",
    })
    await client.post("/display/override", json={"override": "on"})

    with _mock_now(12, 0):
        r = await client.get("/display/schedule")
        assert r.json()["override"] is None


@pytest.mark.anyio
async def test_no_auto_clear_override_on_outside_schedule(client):
    """override="on" persists when we're outside scheduled hours."""
    await client.put("/display/schedule", json={
        "enabled": True, "on_time": "08:00", "off_time": "22:00",
    })
    await client.post("/display/override", json={"override": "on"})

    with _mock_now(23, 0):
        r = await client.get("/display/schedule")
        assert r.json()["override"] == "on"


@pytest.mark.anyio
async def test_auto_clear_override_off_outside_schedule(client):
    """override="off" auto-clears when we're outside scheduled hours."""
    await client.put("/display/schedule", json={
        "enabled": True, "on_time": "08:00", "off_time": "22:00",
    })
    await client.post("/display/override", json={"override": "off"})

    with _mock_now(23, 0):
        r = await client.get("/display/schedule")
        assert r.json()["override"] is None


@pytest.mark.anyio
async def test_no_auto_clear_override_off_within_schedule(client):
    """override="off" persists when we're inside scheduled hours."""
    await client.put("/display/schedule", json={
        "enabled": True, "on_time": "08:00", "off_time": "22:00",
    })
    await client.post("/display/override", json={"override": "off"})

    with _mock_now(12, 0):
        r = await client.get("/display/schedule")
        assert r.json()["override"] == "off"


@pytest.mark.anyio
async def test_no_auto_clear_when_schedule_disabled(client):
    """override is returned as-is when the schedule is disabled."""
    await client.put("/display/schedule", json={
        "enabled": False, "on_time": "08:00", "off_time": "22:00",
    })
    await client.post("/display/override", json={"override": "on"})

    with _mock_now(12, 0):
        r = await client.get("/display/schedule")
        assert r.json()["override"] == "on"
