import aiosqlite
from contextlib import asynccontextmanager
from app.config import settings

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
            status      TEXT NOT NULL DEFAULT 'uploading',
            progress    INTEGER NOT NULL DEFAULT 0,
            duration    REAL,
            thumbnail   TEXT,
            created_at  TEXT NOT NULL,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            error_msg   TEXT
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
