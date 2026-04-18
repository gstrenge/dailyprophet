"""
HEIC upload integration test — uses the REAL processor (no stubs).

Verifies that a .heic still image uploaded through the API is converted
to JPEG and processed to 'ready' end-to-end.
"""

import asyncio
import pytest
import pytest_asyncio

from httpx import AsyncClient, ASGITransport

import app.config as config_module
import app.database as db_module
import app.services.queue as queue_module
from app.main import app


@pytest_asyncio.fixture
async def real_client(tmp_path):
    """API client wired to the real processor (no stub)."""
    config_module.settings.clips_dir = tmp_path
    queue_module._queue = asyncio.Queue()
    queue_module._worker_task = None

    await db_module.init_db()
    await queue_module.start_worker()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c

    await queue_module.stop_worker()
    await db_module.close_db()


async def _wait_terminal(client, clip_id, timeout=60):
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        r = await client.get(f"/clips/{clip_id}/status")
        info = r.json()
        if info["status"] in ("ready", "failed"):
            return info
        await asyncio.sleep(0.5)
    pytest.fail(f"Clip did not finish within {timeout}s")


async def test_heic_still_upload_to_ready(real_client, heic_still):
    """Upload a still HEIC → processes all the way to ready."""
    with open(heic_still, "rb") as f:
        r = await real_client.post(
            "/clips", files={"file": ("photo.heic", f, "image/heic")}
        )
    assert r.status_code == 202

    info = await _wait_terminal(real_client, r.json()["id"])
    assert info["status"] == "ready", f"Expected ready, got: {info}"
