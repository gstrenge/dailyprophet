import asyncio
import shutil
import subprocess
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch

import app.config as config_module
import app.database as db_module
import app.services.queue as queue_module
from app.main import app


# ---------------------------------------------------------------------------
# API client fixture — stubs out the processor so A-group tests don't need
# real video files or a working FFmpeg pipeline.
# ---------------------------------------------------------------------------

async def _stub_processor(clip_id, raw_path, progress_callback, edit_params=None):
    out_dir = config_module.settings.clips_dir / clip_id
    out_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(raw_path, out_dir / "processed.mp4")
    thumb = out_dir / "thumbnail.jpg"
    thumb.write_bytes(b"\xff\xd8stub")
    await progress_callback(100)
    return {"output_path": out_dir / "processed.mp4", "thumbnail_path": thumb, "duration": 5.0, "media_type": "video"}


@pytest_asyncio.fixture
async def client(tmp_path):
    config_module.settings.clips_dir = tmp_path
    queue_module._queue = asyncio.Queue()
    queue_module._worker_task = None

    await db_module.init_db()

    with patch("app.services.queue.process_clip", _stub_processor):
        await queue_module.start_worker()
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            yield c

    await queue_module.stop_worker()
    await db_module.close_db()


# ---------------------------------------------------------------------------
# Session-scoped test video fixtures — generated once via ffmpeg lavfi.
# Used by test_processor.py (B-group).
# ---------------------------------------------------------------------------

def _generate_clip(path: Path, width: int, height: int, duration: int, color: str = "0x808080"):
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi",
            "-i", f"color=c={color}:size={width}x{height}:rate=30",
            "-t", str(duration),
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            str(path),
        ],
        check=True,
        capture_output=True,
    )


@pytest.fixture(scope="session")
def landscape_clip(tmp_path_factory) -> Path:
    """5-second 1280x720 neutral-gray landscape clip."""
    path = tmp_path_factory.mktemp("fixtures") / "landscape.mp4"
    _generate_clip(path, 1280, 720, 5)
    return path


@pytest.fixture(scope="session")
def portrait_clip(tmp_path_factory) -> Path:
    """5-second 720x1280 portrait clip."""
    path = tmp_path_factory.mktemp("fixtures") / "portrait.mp4"
    _generate_clip(path, 720, 1280, 5)
    return path


@pytest.fixture(scope="session")
def long_clip(tmp_path_factory) -> Path:
    """20-second clip that exceeds MAX_CLIP_DURATION."""
    path = tmp_path_factory.mktemp("fixtures") / "long.mp4"
    _generate_clip(path, 1280, 720, 20)
    return path


@pytest.fixture(scope="session")
def short_clip(tmp_path_factory) -> Path:
    """1-second clip — short enough that crossfade should be skipped."""
    path = tmp_path_factory.mktemp("fixtures") / "short.mp4"
    _generate_clip(path, 1280, 720, 1)
    return path


# ---------------------------------------------------------------------------
# Still image fixture
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def still_image(tmp_path_factory) -> Path:
    """A plain JPEG still image."""
    path = tmp_path_factory.mktemp("fixtures") / "photo.jpg"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi",
            "-i", "color=c=0x808080:size=640x480:rate=1",
            "-vframes", "1",
            str(path),
        ],
        check=True,
        capture_output=True,
    )
    return path


# ---------------------------------------------------------------------------
# HEIC fixtures — require heif-enc (from libheif-examples) in the container.
# ---------------------------------------------------------------------------

def _generate_heic_still(path: Path, width: int = 640, height: int = 480):
    """Generate a still HEIC image: ffmpeg → JPEG → heif-enc → HEIC."""
    tmp_jpg = path.with_suffix(".jpg")
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi",
            "-i", f"color=c=0x808080:size={width}x{height}:rate=1",
            "-vframes", "1",
            str(tmp_jpg),
        ],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["heif-enc", str(tmp_jpg), "-o", str(path)],
        check=True,
        capture_output=True,
    )
    tmp_jpg.unlink(missing_ok=True)


@pytest.fixture(scope="session")
def heic_still(tmp_path_factory) -> Path:
    """A plain HEIC still image (no embedded video)."""
    path = tmp_path_factory.mktemp("fixtures") / "still.heic"
    _generate_heic_still(path)
    return path
