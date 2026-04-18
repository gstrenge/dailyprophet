from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from app.database import get_db
from app.models import DisplaySchedule, OverrideRequest

router = APIRouter(prefix="/display", tags=["display"])


def _is_within_schedule(on_time: str, off_time: str) -> bool:
    """Return True if the current time falls inside the on/off window."""
    now = datetime.now()
    now_min = now.hour * 60 + now.minute
    oh, om = (int(x) for x in on_time.split(":"))
    fh, fm = (int(x) for x in off_time.split(":"))
    on_min = oh * 60 + om
    off_min = fh * 60 + fm
    if on_min <= off_min:
        return on_min <= now_min < off_min
    return now_min >= on_min or now_min < off_min


@router.get("/schedule", response_model=DisplaySchedule)
async def get_schedule(db=Depends(get_db)):
    async with db.execute("SELECT * FROM display_schedule WHERE id=1") as cur:
        row = await cur.fetchone()

    enabled = bool(row["enabled"])
    on_time = row["on_time"]
    off_time = row["off_time"]
    override = row["override"]

    if enabled and override is not None:
        within = _is_within_schedule(on_time, off_time)
        if (override == "on" and within) or (override == "off" and not within):
            override = None
            await db.execute(
                "UPDATE display_schedule SET override=NULL WHERE id=1"
            )
            await db.commit()

    return DisplaySchedule(
        enabled=enabled,
        on_time=on_time,
        off_time=off_time,
        override=override,
    )


@router.put("/schedule", response_model=DisplaySchedule)
async def put_schedule(body: DisplaySchedule, db=Depends(get_db)):
    await db.execute(
        "UPDATE display_schedule SET enabled=?, on_time=?, off_time=?, override=NULL WHERE id=1",
        (int(body.enabled), body.on_time, body.off_time),
    )
    await db.commit()
    return DisplaySchedule(
        enabled=body.enabled,
        on_time=body.on_time,
        off_time=body.off_time,
        override=None,
    )


@router.post("/override", response_model=DisplaySchedule)
async def post_override(body: OverrideRequest, db=Depends(get_db)):
    if body.override not in ("on", "off", None):
        raise HTTPException(status_code=422, detail="override must be 'on', 'off', or null")
    await db.execute(
        "UPDATE display_schedule SET override=? WHERE id=1",
        (body.override,),
    )
    await db.commit()
    async with db.execute("SELECT * FROM display_schedule WHERE id=1") as cur:
        row = await cur.fetchone()
    return DisplaySchedule(
        enabled=bool(row["enabled"]),
        on_time=row["on_time"],
        off_time=row["off_time"],
        override=row["override"],
    )
