from fastapi import APIRouter
from app.config import settings
from app.models import StorageResponse

router = APIRouter(prefix="/storage", tags=["storage"])


@router.get("", response_model=StorageResponse)
async def get_storage():
    used = _used_bytes()
    total = settings.quota_bytes
    return StorageResponse(
        used_bytes=used,
        total_allocated_bytes=total,
        free_bytes=max(0, total - used),
    )


def _used_bytes() -> int:
    total = 0
    for p in settings.clips_dir.rglob("*"):
        if p.is_file() and p.suffix not in (".sqlite3", ".wal", ".shm"):
            total += p.stat().st_size
    return total
