from fastapi import APIRouter, Depends
from app.database import get_db
from app.models import DisplaySchedule

router = APIRouter(prefix="/display", tags=["display"])


@router.get("/schedule", response_model=DisplaySchedule)
async def get_schedule(db=Depends(get_db)):
    async with db.execute("SELECT * FROM display_schedule WHERE id=1") as cur:
        row = await cur.fetchone()
    return DisplaySchedule(
        enabled=bool(row["enabled"]),
        on_time=row["on_time"],
        off_time=row["off_time"],
    )


@router.put("/schedule", response_model=DisplaySchedule)
async def put_schedule(body: DisplaySchedule, db=Depends(get_db)):
    await db.execute(
        "UPDATE display_schedule SET enabled=?, on_time=?, off_time=? WHERE id=1",
        (int(body.enabled), body.on_time, body.off_time),
    )
    await db.commit()
    return body
