"""
A1 — Upload-to-ready lifecycle
A4 — Quota enforcement
A5 — Delete removes DB row and files
"""

import asyncio
import io
import pytest

import app.config as config_module


def _fake_file(name: str = "clip.mp4", size: int = 1024) -> tuple:
    return (name, io.BytesIO(b"x" * size), "video/mp4")


async def _wait_for_terminal(client, clip_id: str, timeout: float = 5.0) -> str:
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        r = await client.get(f"/clips/{clip_id}/status")
        status = r.json()["status"]
        if status in ("ready", "failed"):
            return status
        await asyncio.sleep(0.05)
    pytest.fail(f"Clip {clip_id} did not reach terminal status within {timeout}s")


# ---------------------------------------------------------------------------
# A1: lifecycle
# ---------------------------------------------------------------------------

async def test_upload_returns_queued(client):
    r = await client.post("/clips", files={"file": _fake_file()})
    assert r.status_code == 202
    body = r.json()
    assert "id" in body
    assert body["status"] == "queued"


async def test_status_progresses_to_ready(client):
    r = await client.post("/clips", files={"file": _fake_file()})
    clip_id = r.json()["id"]
    status = await _wait_for_terminal(client, clip_id)
    assert status == "ready"


async def test_ready_clip_appears_in_list(client):
    r = await client.post("/clips", files={"file": _fake_file()})
    clip_id = r.json()["id"]
    await _wait_for_terminal(client, clip_id)

    clips = (await client.get("/clips")).json()
    ids = [c["id"] for c in clips]
    assert clip_id in ids


async def test_status_endpoint_tracks_progress(client):
    r = await client.post("/clips", files={"file": _fake_file()})
    clip_id = r.json()["id"]

    seen_statuses = set()
    deadline = asyncio.get_event_loop().time() + 5.0
    while asyncio.get_event_loop().time() < deadline:
        s = (await client.get(f"/clips/{clip_id}/status")).json()["status"]
        seen_statuses.add(s)
        if s in ("ready", "failed"):
            break
        await asyncio.sleep(0.02)

    assert "ready" in seen_statuses, f"Never reached ready; saw: {seen_statuses}"


# ---------------------------------------------------------------------------
# A4: quota enforcement
# ---------------------------------------------------------------------------

async def test_quota_rejection_returns_507(client, tmp_path):
    # Fill the quota directory with a dummy file larger than the quota.
    dummy = tmp_path / "filler.bin"
    dummy.write_bytes(b"x" * (config_module.settings.quota_bytes + 1))

    r = await client.post("/clips", files={"file": _fake_file()})
    assert r.status_code == 507


async def test_upload_succeeds_when_quota_not_exceeded(client):
    r = await client.post("/clips", files={"file": _fake_file()})
    assert r.status_code == 202


# ---------------------------------------------------------------------------
# A5: delete removes DB row and clip directory
# ---------------------------------------------------------------------------

async def test_delete_removes_from_list(client):
    r = await client.post("/clips", files={"file": _fake_file()})
    clip_id = r.json()["id"]
    await _wait_for_terminal(client, clip_id)

    await client.delete(f"/clips/{clip_id}")

    clips = (await client.get("/clips")).json()
    assert not any(c["id"] == clip_id for c in clips)


async def test_delete_removes_files_from_disk(client, tmp_path):
    r = await client.post("/clips", files={"file": _fake_file()})
    clip_id = r.json()["id"]
    await _wait_for_terminal(client, clip_id)

    await client.delete(f"/clips/{clip_id}")

    assert not (tmp_path / clip_id).exists()


async def test_delete_nonexistent_returns_404(client):
    r = await client.delete("/clips/does-not-exist")
    assert r.status_code == 404


async def test_delete_returns_204(client):
    r = await client.post("/clips", files={"file": _fake_file()})
    clip_id = r.json()["id"]
    await _wait_for_terminal(client, clip_id)

    r = await client.delete(f"/clips/{clip_id}")
    assert r.status_code == 204


# ---------------------------------------------------------------------------
# Thumbnail URL contract
# ---------------------------------------------------------------------------

async def test_ready_clip_has_thumbnail_url(client):
    r = await client.post("/clips", files={"file": _fake_file()})
    clip_id = r.json()["id"]
    await _wait_for_terminal(client, clip_id)

    clips = (await client.get("/clips")).json()
    clip = next(c for c in clips if c["id"] == clip_id)
    assert clip["thumbnail"] == f"/clips/{clip_id}/thumbnail"
