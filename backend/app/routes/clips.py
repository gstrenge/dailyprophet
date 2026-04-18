import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File, status
from fastapi.responses import FileResponse

from app.config import settings
from app.database import get_db
from app.models import Clip, ClipOrderRequest, ClipStatus, ClipStatusResponse
from app.services.queue import enqueue

router = APIRouter(prefix="/clips", tags=["clips"])


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def upload_clip(
    file: UploadFile = File(...),
    trim_start: Optional[float] = Form(None),
    trim_end: Optional[float] = Form(None),
    crop_x: Optional[float] = Form(None),
    crop_y: Optional[float] = Form(None),
    crop_w: Optional[float] = Form(None),
    crop_h: Optional[float] = Form(None),
    db=Depends(get_db),
):
    used = _get_used_bytes()
    if used >= settings.quota_bytes:
        raise HTTPException(
            status_code=status.HTTP_507_INSUFFICIENT_STORAGE,
            detail="Storage quota exceeded. Delete existing clips to free space.",
        )

    edit_params: dict = {}
    if trim_start is not None:
        edit_params["trim_start"] = trim_start
    if trim_end is not None:
        edit_params["trim_end"] = trim_end
    if crop_x is not None:
        edit_params["crop_x"] = crop_x
    if crop_y is not None:
        edit_params["crop_y"] = crop_y
    if crop_w is not None:
        edit_params["crop_w"] = crop_w
    if crop_h is not None:
        edit_params["crop_h"] = crop_h
    edit_json = json.dumps(edit_params) if edit_params else None

    clip_id = str(uuid.uuid4())
    raw_dir = settings.clips_dir / clip_id / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    dest = raw_dir / (file.filename or "upload")
    async with aiofiles.open(dest, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            await f.write(chunk)

    created_at = datetime.now(timezone.utc).isoformat()
    async with db.execute("SELECT MAX(sort_order) as m FROM clips") as cur:
        row = await cur.fetchone()
    sort_order = (row["m"] or 0) + 1

    await db.execute(
        """INSERT INTO clips (id, filename, status, progress, created_at, sort_order, edit_params)
           VALUES (?, ?, ?, 0, ?, ?, ?)""",
        (clip_id, dest.name, ClipStatus.QUEUED, created_at, sort_order, edit_json),
    )
    await db.commit()

    await enqueue(clip_id)
    return {"id": clip_id, "status": ClipStatus.QUEUED}


@router.get("/{clip_id}/status", response_model=ClipStatusResponse)
async def get_clip_status(clip_id: str, db=Depends(get_db)):
    async with db.execute("SELECT * FROM clips WHERE id=?", (clip_id,)) as cur:
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Clip not found")
    return ClipStatusResponse(
        id=row["id"],
        status=row["status"],
        progress=row["progress"],
        error_msg=row["error_msg"],
    )


@router.get("", response_model=list[Clip])
async def list_clips(db=Depends(get_db)):
    async with db.execute(
        "SELECT * FROM clips ORDER BY sort_order, created_at"
    ) as cur:
        rows = await cur.fetchall()
    return [_row_to_clip(r) for r in rows]


@router.delete("/{clip_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_clip(clip_id: str, db=Depends(get_db)):
    async with db.execute("SELECT id FROM clips WHERE id=?", (clip_id,)) as cur:
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Clip not found")

    clip_dir = settings.clips_dir / clip_id
    if clip_dir.exists():
        import shutil
        await __import__("asyncio").to_thread(shutil.rmtree, clip_dir)

    await db.execute("DELETE FROM clips WHERE id=?", (clip_id,))
    await db.commit()


@router.patch("/order", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_clips(body: ClipOrderRequest, db=Depends(get_db)):
    for index, clip_id in enumerate(body.order):
        await db.execute(
            "UPDATE clips SET sort_order=? WHERE id=?", (index, clip_id)
        )
    await db.commit()


@router.get("/{clip_id}/thumbnail")
async def get_thumbnail(clip_id: str, db=Depends(get_db)):
    async with db.execute("SELECT thumbnail FROM clips WHERE id=?", (clip_id,)) as cur:
        row = await cur.fetchone()
    if row is None or not row["thumbnail"]:
        raise HTTPException(status_code=404, detail="Thumbnail not available")
    path = Path(row["thumbnail"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail file missing")
    return FileResponse(path, media_type="image/jpeg")


@router.get("/{clip_id}/video")
async def get_video(clip_id: str, db=Depends(get_db)):
    async with db.execute("SELECT status, media_type FROM clips WHERE id=?", (clip_id,)) as cur:
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Clip not found")
    if row["status"] != ClipStatus.READY:
        raise HTTPException(status_code=409, detail="Clip is not ready yet")

    if row["media_type"] == "image":
        img_path = settings.clips_dir / clip_id / "processed.jpg"
        if not img_path.exists():
            raise HTTPException(status_code=404, detail="Image file missing")
        return FileResponse(img_path, media_type="image/jpeg")

    video_path = settings.clips_dir / clip_id / "processed.mp4"
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file missing")
    return FileResponse(video_path, media_type="video/mp4")


def _row_to_clip(row) -> Clip:
    return Clip(
        id=row["id"],
        filename=row["filename"],
        status=row["status"],
        progress=row["progress"],
        duration=row["duration"],
        media_type=row["media_type"],
        thumbnail=f"/clips/{row['id']}/thumbnail" if row["thumbnail"] else None,
        created_at=row["created_at"],
        sort_order=row["sort_order"],
        error_msg=row["error_msg"],
    )


def _get_used_bytes() -> int:
    total = 0
    for p in settings.clips_dir.rglob("*"):
        if p.is_file() and p.suffix not in (".sqlite3", ".wal", ".shm"):
            total += p.stat().st_size
    return total
