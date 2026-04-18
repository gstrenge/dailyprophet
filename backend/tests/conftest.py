import asyncio
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

import app.config as config_module
import app.database as db_module
import app.services.queue as queue_module
from app.main import app


@pytest_asyncio.fixture
async def client(tmp_path):
    # Isolate each test to its own temp directory and fresh database.
    config_module.settings.clips_dir = tmp_path

    # Reset queue state left over from any previous test.
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
