"""
A2 — Sequential processing: one clip at a time, in submission order
A3 — Crash recovery: interrupted jobs are re-queued on startup
"""

import asyncio
import io
import pytest

import app.services.queue as queue_module
import app.database as db_module
from app.models import ClipStatus


def _fake_file(name: str = "clip.mp4") -> tuple:
    return (name, io.BytesIO(b"x" * 512), "video/mp4")


async def _wait_all_terminal(client, ids: list[str], timeout: float = 10.0) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        clips = {c["id"]: c["status"] for c in (await client.get("/clips")).json()}
        if all(clips.get(i) in ("ready", "failed") for i in ids):
            return clips
        await asyncio.sleep(0.05)
    pytest.fail(f"Not all clips reached terminal status within {timeout}s; last: {clips}")


# ---------------------------------------------------------------------------
# A2: sequential processing
# ---------------------------------------------------------------------------

async def test_clips_process_one_at_a_time(client, monkeypatch):
    """At no point should more than one clip be in 'processing' state."""
    concurrent_peak = [0]
    current = [0]

    original = queue_module.process_clip

    async def tracked(clip_id, raw_path, cb):
        current[0] += 1
        concurrent_peak[0] = max(concurrent_peak[0], current[0])
        try:
            return await original(clip_id, raw_path, cb)
        finally:
            current[0] -= 1

    monkeypatch.setattr(queue_module, "process_clip", tracked)

    ids = []
    for i in range(3):
        r = await client.post("/clips", files={"file": _fake_file(f"clip{i}.mp4")})
        ids.append(r.json()["id"])

    await _wait_all_terminal(client, ids)

    assert concurrent_peak[0] == 1, (
        f"Expected max 1 concurrent processor, got {concurrent_peak[0]}"
    )


async def test_clips_process_in_submission_order(client, monkeypatch):
    """Clips start processing in the order they were submitted."""
    started: list[str] = []

    original = queue_module.process_clip

    async def tracked(clip_id, raw_path, cb):
        started.append(clip_id)
        return await original(clip_id, raw_path, cb)

    monkeypatch.setattr(queue_module, "process_clip", tracked)

    ids = []
    for i in range(3):
        r = await client.post("/clips", files={"file": _fake_file(f"clip{i}.mp4")})
        ids.append(r.json()["id"])

    await _wait_all_terminal(client, ids)

    assert started == ids, f"Processing order {started} != submission order {ids}"


# ---------------------------------------------------------------------------
# A3: crash recovery
# ---------------------------------------------------------------------------

async def test_interrupted_processing_clip_is_requeued_on_restart(client, tmp_path):
    """
    A clip left in 'processing' state (as if the backend died mid-job)
    is reset to 'queued' and eventually reaches 'ready' after _recover_interrupted_jobs runs.
    """
    # Upload and wait for ready so we have a real clip directory on disk.
    r = await client.post("/clips", files={"file": _fake_file()})
    clip_id = r.json()["id"]

    deadline = asyncio.get_event_loop().time() + 5.0
    while asyncio.get_event_loop().time() < deadline:
        s = (await client.get(f"/clips/{clip_id}/status")).json()["status"]
        if s in ("ready", "failed"):
            break
        await asyncio.sleep(0.05)

    # Simulate a crash: forcibly set status back to 'processing' with partial progress.
    db = await db_module.get_db()
    await db.execute(
        "UPDATE clips SET status=?, progress=40 WHERE id=?",
        (ClipStatus.PROCESSING, clip_id),
    )
    await db.commit()

    # Stop the worker (simulates the restart boundary).
    await queue_module.stop_worker()
    queue_module._queue = asyncio.Queue()
    queue_module._worker_task = None

    # Run recovery (called automatically on real startup via start_worker).
    await queue_module._recover_interrupted_jobs()

    # Verify the clip was reset to queued.
    async with db.execute(
        "SELECT status, progress FROM clips WHERE id=?", (clip_id,)
    ) as cur:
        row = await cur.fetchone()
    assert row["status"] == ClipStatus.QUEUED
    assert row["progress"] == 0


async def test_interrupted_clip_completes_after_recovery(client, tmp_path):
    """After recovery, the re-queued clip is processed and reaches 'ready'."""
    r = await client.post("/clips", files={"file": _fake_file()})
    clip_id = r.json()["id"]

    deadline = asyncio.get_event_loop().time() + 5.0
    while asyncio.get_event_loop().time() < deadline:
        if (await client.get(f"/clips/{clip_id}/status")).json()["status"] in ("ready", "failed"):
            break
        await asyncio.sleep(0.05)

    # Simulate crash
    db = await db_module.get_db()
    await db.execute(
        "UPDATE clips SET status=?, progress=40 WHERE id=?",
        (ClipStatus.PROCESSING, clip_id),
    )
    await db.commit()

    # Restart worker (calls _recover_interrupted_jobs internally)
    await queue_module.stop_worker()
    queue_module._queue = asyncio.Queue()
    queue_module._worker_task = None
    await queue_module.start_worker()

    # Clip should reach ready again
    deadline = asyncio.get_event_loop().time() + 5.0
    while asyncio.get_event_loop().time() < deadline:
        s = (await client.get(f"/clips/{clip_id}/status")).json()["status"]
        if s in ("ready", "failed"):
            break
        await asyncio.sleep(0.05)

    assert s == "ready"
