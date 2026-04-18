import logging

import aiosqlite
from contextlib import asynccontextmanager
from app.config import settings

logger = logging.getLogger(__name__)

_db: aiosqlite.Connection | None = None


async def get_db() -> aiosqlite.Connection:
    return _db


async def init_db():
    global _db
    settings.clips_dir.mkdir(parents=True, exist_ok=True)
    _db = await aiosqlite.connect(settings.db_path)
    _db.row_factory = aiosqlite.Row
    await _db.execute("PRAGMA journal_mode=WAL")
    await _db.execute("PRAGMA foreign_keys=ON")
    await _create_tables()
    await _db.commit()


async def close_db():
    global _db
    if _db:
        await _db.close()
        _db = None


async def _create_tables():
    await _db.executescript("""
        CREATE TABLE IF NOT EXISTS clips (
            id          TEXT PRIMARY KEY,
            filename    TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'queued',
            progress    INTEGER NOT NULL DEFAULT 0,
            duration    REAL,
            media_type  TEXT NOT NULL DEFAULT 'video',
            thumbnail   TEXT,
            created_at  TEXT NOT NULL,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            error_msg   TEXT,
            edit_params TEXT
        );

        CREATE TABLE IF NOT EXISTS display_schedule (
            id          INTEGER PRIMARY KEY CHECK (id = 1),
            enabled     INTEGER NOT NULL DEFAULT 0,
            on_time     TEXT NOT NULL DEFAULT '08:00',
            off_time    TEXT NOT NULL DEFAULT '22:00'
        );

        INSERT OR IGNORE INTO display_schedule (id, enabled, on_time, off_time)
        VALUES (1, 0, '08:00', '22:00');
    """)
    await _migrate()


async def _migrate():
    """Add columns that may be missing from older databases."""
    async with _db.execute("PRAGMA table_info(clips)") as cur:
        columns = {row[1] for row in await cur.fetchall()}
    if "media_type" not in columns:
        logger.info("Migrating: adding media_type column to clips")
        await _db.execute(
            "ALTER TABLE clips ADD COLUMN media_type TEXT NOT NULL DEFAULT 'video'"
        )
    if "edit_params" not in columns:
        logger.info("Migrating: adding edit_params column to clips")
        await _db.execute("ALTER TABLE clips ADD COLUMN edit_params TEXT")

    async with _db.execute("PRAGMA table_info(display_schedule)") as cur:
        ds_columns = {row[1] for row in await cur.fetchall()}
    if "override" not in ds_columns:
        logger.info("Migrating: adding override column to display_schedule")
        await _db.execute("ALTER TABLE display_schedule ADD COLUMN override TEXT")
