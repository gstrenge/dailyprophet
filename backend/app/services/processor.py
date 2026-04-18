"""
Media processing pipeline — handles both video clips and still images.

Video transforms (in order):
  0. Pre-process HEIC/HEIF files  (convert to JPEG so ffmpeg can read them)
  1. Resize + letterbox to target display resolution (black bars, never stretch)
  2. Normalize frame rate
  3. Daily Prophet sepia filter  (brownish-gray via classic sepia matrix + film grain)
  4. Loop-smoothing crossfade    (blends last N frames with first N for seamless loop)
  5. H.264 / MP4 encode, audio stripped

Still-image transforms:
  1. Resize + letterbox to target display resolution
  2. Daily Prophet sepia filter
  3. Output as JPEG

Tunable via app.config.Settings:
  DISPLAY_WIDTH / DISPLAY_HEIGHT  — set to actual Pi display resolution
  TARGET_FPS                      — output frame rate
  VIDEO_CRF                       — libx264 quality (lower = better, larger)
  MAX_CLIP_DURATION               — upload ceiling in seconds
  CROSSFADE_DURATION              — loop blend window in seconds
"""

import asyncio
import json
import logging
from dataclasses import dataclass
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)

HEIC_EXTENSIONS = {".heic", ".heif"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"} | HEIC_EXTENSIONS


@dataclass
class _ProbeResult:
    duration: float
    width: int
    height: int
    fps: float
    is_still: bool = False


# ---------------------------------------------------------------------------
# HEIC pre-processing
# ---------------------------------------------------------------------------

async def _prepare_input(raw_path: Path, work_dir: Path) -> Path:
    """If the input is HEIC/HEIF, convert to JPEG so ffmpeg can read it.

    iOS strips the Live Photo video during web uploads, so HEIC files are
    always still images.  Users should save Live Photos as MOV and upload
    the video directly for motion content.
    """
    if raw_path.suffix.lower() not in HEIC_EXTENSIONS:
        return raw_path

    import shutil
    if not shutil.which("heif-convert"):
        raise ValueError(
            "HEIC support requires heif-convert (libheif-examples). "
            "Install it or rebuild the Docker image."
        )

    jpg_path = raw_path.with_suffix(".jpg")
    proc = await asyncio.create_subprocess_exec(
        "heif-convert", str(raw_path), str(jpg_path),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0 or not jpg_path.exists():
        raise ValueError(
            f"Cannot decode HEIC image: {stderr.decode().strip()}"
        )

    logger.info("Converted HEIC to JPEG: %s", jpg_path.name)
    return jpg_path


async def process_clip(
    clip_id: str,
    raw_path: Path,
    progress_callback,  # async (pct: int) -> None
    edit_params: dict | None = None,
) -> dict:
    out_dir = settings.clips_dir / clip_id
    out_dir.mkdir(parents=True, exist_ok=True)
    edit_params = edit_params or {}

    await progress_callback(5)

    input_path = await _prepare_input(raw_path, out_dir)

    info = await _probe(input_path)

    crop = _parse_crop(edit_params)

    if info.is_still:
        logger.info("Input is a still image — processing as image")
        return await _process_still(input_path, out_dir, progress_callback, crop)

    trim = _parse_trim(edit_params, info.duration)
    effective_duration = (trim[1] - trim[0]) if trim else info.duration

    if effective_duration > settings.max_clip_duration:
        raise ValueError(
            f"Clip is {effective_duration:.1f}s; maximum allowed is "
            f"{settings.max_clip_duration}s"
        )

    return await _process_video(
        input_path, info, out_dir, progress_callback, trim, crop,
    )


def _parse_trim(
    params: dict, duration: float,
) -> tuple[float, float] | None:
    """Return (start, end) in seconds or None if no trim requested."""
    s = params.get("trim_start")
    e = params.get("trim_end")
    if s is None and e is None:
        return None
    start = max(0.0, float(s or 0))
    end = min(duration, float(e or duration))
    if end <= start:
        return None
    return (start, end)


def _parse_crop(params: dict) -> tuple[int, int, int, int] | None:
    """Return (w, h, x, y) in pixels or None if no crop requested."""
    keys = ("crop_w", "crop_h", "crop_x", "crop_y")
    if not all(params.get(k) is not None for k in keys):
        return None
    return (
        int(params["crop_w"]),
        int(params["crop_h"]),
        int(params["crop_x"]),
        int(params["crop_y"]),
    )


async def _process_still(
    input_path: Path, out_dir: Path, progress_callback,
    crop: tuple[int, int, int, int] | None = None,
) -> dict:
    """Resize + letterbox + sepia a still image and save as JPEG."""
    output_path = out_dir / "processed.jpg"
    W = settings.display_width
    H = settings.display_height

    filters: list[str] = []
    if crop:
        cw, ch, cx, cy = crop
        filters.append(f"crop={cw}:{ch}:{cx}:{cy}")
    filters += [
        f"scale={W}:{H}:force_original_aspect_ratio=decrease",
        f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black",
        "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131",
        "noise=alls=8:allf=t+u",
    ]
    vf = ",".join(filters)

    await progress_callback(10)

    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y",
        "-i", str(input_path),
        "-vf", vf,
        "-frames:v", "1",
        "-q:v", "2",
        str(output_path),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()

    if proc.returncode != 0 or not output_path.exists():
        raise RuntimeError(
            f"FFmpeg image processing failed:\n{stderr.decode()[-500:]}"
        )

    await progress_callback(100)
    return {
        "output_path": output_path,
        "thumbnail_path": output_path,
        "duration": None,
        "media_type": "image",
    }


async def _process_video(
    input_path: Path, info: _ProbeResult, out_dir: Path, progress_callback,
    trim: tuple[float, float] | None = None,
    crop: tuple[int, int, int, int] | None = None,
) -> dict:
    """Full video pipeline: trim, crop, resize, sepia, crossfade, encode."""
    output_path = out_dir / "processed.mp4"

    await progress_callback(10)

    effective_dur = (trim[1] - trim[0]) if trim else info.duration
    cfade = min(settings.crossfade_duration, effective_dur / 4)
    total_frames = max(1, int(effective_dur * settings.target_fps))

    trimmed_info = _ProbeResult(
        duration=effective_dur,
        width=info.width,
        height=info.height,
        fps=info.fps,
    )
    filter_complex = _build_filter_complex(trimmed_info, cfade, crop)

    input_opts: list[str] = []
    if trim:
        input_opts += ["-ss", f"{trim[0]:.6f}", "-to", f"{trim[1]:.6f}"]

    cmd = [
        "ffmpeg", "-y",
        *input_opts,
        "-i", str(input_path),
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-crf", str(settings.video_crf),
        "-preset", "fast",
        "-movflags", "+faststart",
        "-an",
        "-progress", "pipe:1",
        "-nostats",
        str(output_path),
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    stderr_lines: list[str] = []

    async def read_stdout():
        async for raw_line in proc.stdout:
            line = raw_line.decode().strip()
            if line.startswith("frame="):
                try:
                    frame = int(line.split("=", 1)[1])
                    pct = 10 + int(frame / total_frames * 85)
                    await progress_callback(min(95, pct))
                except ValueError:
                    pass

    async def read_stderr():
        async for raw_line in proc.stderr:
            stderr_lines.append(raw_line.decode())

    await asyncio.gather(read_stdout(), read_stderr(), proc.wait())

    if proc.returncode != 0:
        detail = "".join(stderr_lines[-20:])
        raise RuntimeError(f"FFmpeg failed (exit {proc.returncode}):\n{detail}")

    thumbnail_path = await _extract_thumbnail(output_path, out_dir)
    await progress_callback(100)

    return {
        "output_path": output_path,
        "thumbnail_path": thumbnail_path,
        "duration": info.duration,
        "media_type": "video",
    }


def _build_filter_complex(
    info: _ProbeResult, cfade: float,
    crop: tuple[int, int, int, int] | None = None,
) -> str:
    W = settings.display_width
    H = settings.display_height
    FPS = settings.target_fps

    filters: list[str] = []
    if crop:
        cw, ch, cx, cy = crop
        filters.append(f"crop={cw}:{ch}:{cx}:{cy}")
    filters += [
        f"scale={W}:{H}:force_original_aspect_ratio=decrease",
        f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black",
        f"fps={FPS}",
        "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131",
        "noise=alls=8:allf=t+u",
    ]
    base = ",".join(filters)

    if cfade < 0.1:
        return f"[0:v]{base}[out]"

    main_end = info.duration - cfade

    # xfade requires constant-frame-rate inputs; re-apply fps after each trim+setpts.
    return ";".join([
        f"[0:v]{base}[processed]",
        "[processed]split=3[main_full][for_end][for_start]",
        f"[main_full]trim=start=0:end={main_end:.6f},setpts=PTS-STARTPTS[main]",
        f"[for_end]trim=start={main_end:.6f}:end={info.duration:.6f},setpts=PTS-STARTPTS,fps={FPS}[end_part]",
        f"[for_start]trim=start=0:end={cfade:.6f},setpts=PTS-STARTPTS,fps={FPS}[start_part]",
        f"[end_part][start_part]xfade=transition=fade:duration={cfade:.6f}:offset=0[xfaded]",
        "[main][xfaded]concat=n=2:v=1:a=0[out]",
    ])


async def _probe(path: Path) -> _ProbeResult:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v", "quiet",
        "-print_format", "json",
        "-show_streams",
        "-show_format",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()

    try:
        data = json.loads(stdout.decode())
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"ffprobe returned invalid output: {exc}") from exc

    video_stream = next(
        (s for s in data.get("streams", []) if s.get("codec_type") == "video"),
        None,
    )

    if video_stream:
        width = int(video_stream.get("width", settings.display_width))
        height = int(video_stream.get("height", settings.display_height))
        fps_str = video_stream.get("r_frame_rate", f"{settings.target_fps}/1")
        try:
            num, den = fps_str.split("/")
            fps = float(num) / max(1.0, float(den))
        except (ValueError, ZeroDivisionError):
            fps = float(settings.target_fps)
        nb_frames = int(video_stream.get("nb_frames", 0) or 0)
    else:
        width = settings.display_width
        height = settings.display_height
        fps = float(settings.target_fps)
        nb_frames = 0

    try:
        duration = float(data["format"]["duration"])
    except (KeyError, ValueError):
        duration = 0.0

    is_still = nb_frames <= 1 or duration < 0.5

    return _ProbeResult(
        duration=duration, width=width, height=height, fps=fps, is_still=is_still,
    )


async def _extract_thumbnail(video_path: Path, out_dir: Path) -> Path | None:
    thumb_path = out_dir / "thumbnail.jpg"
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-ss", "00:00:00",
        "-vframes", "1",
        "-q:v", "5",
        str(thumb_path),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await proc.wait()
    return thumb_path if thumb_path.exists() else None
