"""
Video processing pipeline.

Phase 1: stubbed pass-through — copies the raw upload to the processed output
and generates a thumbnail placeholder. Real FFmpeg transforms come in the next step.
"""

import asyncio
import shutil
from pathlib import Path

from app.config import settings

MAX_DURATION_SECONDS = 15


async def process_clip(
    clip_id: str,
    raw_path: Path,
    progress_callback,  # async callable(percent: int)
) -> dict:
    """
    Returns dict with keys: output_path, thumbnail_path, duration.
    Raises ValueError for validation failures, RuntimeError for processing errors.
    """
    out_dir = settings.clips_dir / clip_id
    out_dir.mkdir(parents=True, exist_ok=True)

    await progress_callback(10)

    duration = await _probe_duration(raw_path)
    if duration is not None and duration > MAX_DURATION_SECONDS:
        raise ValueError(
            f"Clip duration {duration:.1f}s exceeds maximum of {MAX_DURATION_SECONDS}s"
        )

    await progress_callback(30)

    # --- stub: pass-through copy (will be replaced with real FFmpeg pipeline) ---
    output_path = out_dir / "processed.mp4"
    await asyncio.to_thread(shutil.copy2, raw_path, output_path)

    await progress_callback(70)

    thumbnail_path = await _extract_thumbnail(raw_path, out_dir)

    await progress_callback(100)

    return {
        "output_path": output_path,
        "thumbnail_path": thumbnail_path,
        "duration": duration,
    }


async def _probe_duration(path: Path) -> float | None:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()
    try:
        return float(stdout.decode().strip())
    except (ValueError, AttributeError):
        return None


async def _extract_thumbnail(video_path: Path, out_dir: Path) -> Path | None:
    thumb_path = out_dir / "thumbnail.jpg"
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-y",
        "-i", str(video_path),
        "-ss", "00:00:00",
        "-vframes", "1",
        "-q:v", "5",
        str(thumb_path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    await proc.communicate()
    return thumb_path if thumb_path.exists() else None
