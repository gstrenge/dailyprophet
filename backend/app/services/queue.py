"""
Sequential processing queue. Accepts concurrent submissions; processes one at a time.

On startup, any clips still in 'queued' or 'processing' state are re-queued so
jobs survive a backend restart (they restart from scratch — the stub copy is fast
enough that resumption adds no value in Phase 1).
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

import aiosqlite

from app.database import get_db
from app.models import ClipStatus
from app.services.processor import process_clip
from app.config import settings

logger = logging.getLogger(__name__)

_queue: asyncio.Queue[str] = asyncio.Queue()
_worker_task: asyncio.Task | None = None


async def enqueue(clip_id: str):
    await _queue.put(clip_id)


async def start_worker():
    global _worker_task
    _worker_task = asyncio.create_task(_worker_loop(), name="processor-worker")
    await _recover_interrupted_jobs()


async def stop_worker():
    if _worker_task:
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass


async def _recover_interrupted_jobs():
    db = await get_db()
    async with db.execute(
        "SELECT id FROM clips WHERE status IN (?, ?) ORDER BY sort_order, created_at",
        (ClipStatus.QUEUED, ClipStatus.PROCESSING),
    ) as cur:
        rows = await cur.fetchall()

    for row in rows:
        logger.info("Re-queuing interrupted job %s", row["id"])
        await db.execute(
            "UPDATE clips SET status=?, progress=0 WHERE id=?",
            (ClipStatus.QUEUED, row["id"]),
        )
    await db.commit()

    for row in rows:
        await enqueue(row["id"])


async def _worker_loop():
    while True:
        clip_id = await _queue.get()
        try:
            await _process(clip_id)
        except Exception:
            logger.exception("Unhandled error processing clip %s", clip_id)
        finally:
            _queue.task_done()


async def _process(clip_id: str):
    db = await get_db()

    async with db.execute("SELECT * FROM clips WHERE id=?", (clip_id,)) as cur:
        row = await cur.fetchone()

    if row is None:
        logger.warning("Clip %s not found; skipping", clip_id)
        return

    raw_path = settings.clips_dir / clip_id / "raw" / row["filename"]
    if not raw_path.exists():
        await _mark_failed(db, clip_id, "Raw file missing")
        return

    await db.execute(
        "UPDATE clips SET status=?, progress=0 WHERE id=?",
        (ClipStatus.PROCESSING, clip_id),
    )
    await db.commit()

    async def progress_callback(pct: int):
        await db.execute(
            "UPDATE clips SET progress=? WHERE id=?", (pct, clip_id)
        )
        await db.commit()

    edit_params = None
    raw_edit = row["edit_params"]
    if raw_edit:
        try:
            edit_params = json.loads(raw_edit)
        except json.JSONDecodeError:
            logger.warning("Invalid edit_params JSON for clip %s", clip_id)

    try:
        result = await process_clip(
            clip_id, raw_path, progress_callback, edit_params=edit_params,
        )
        await db.execute(
            """UPDATE clips
               SET status=?, progress=100, duration=?, media_type=?, thumbnail=?
               WHERE id=?""",
            (
                ClipStatus.READY,
                result.get("duration"),
                result.get("media_type", "video"),
                str(result["thumbnail_path"]) if result.get("thumbnail_path") else None,
                clip_id,
            ),
        )
        await db.commit()
        logger.info("Clip %s processed successfully", clip_id)
    except ValueError as exc:
        await _mark_failed(db, clip_id, str(exc))
    except Exception as exc:
        logger.exception("Processing failed for clip %s", clip_id)
        await _mark_failed(db, clip_id, str(exc))


async def _mark_failed(db: aiosqlite.Connection, clip_id: str, reason: str):
    await db.execute(
        "UPDATE clips SET status=?, error_msg=? WHERE id=?",
        (ClipStatus.FAILED, reason, clip_id),
    )
    await db.commit()
    logger.error("Clip %s failed: %s", clip_id, reason)
