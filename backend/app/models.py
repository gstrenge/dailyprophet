from enum import StrEnum
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class ClipStatus(StrEnum):
    QUEUED = "queued"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class Clip(BaseModel):
    id: str
    filename: str
    status: ClipStatus
    progress: int
    duration: Optional[float] = None
    thumbnail: Optional[str] = None
    created_at: str
    sort_order: int
    error_msg: Optional[str] = None


class ClipStatusResponse(BaseModel):
    id: str
    status: ClipStatus
    progress: int
    error_msg: Optional[str] = None


class StorageResponse(BaseModel):
    used_bytes: int
    total_allocated_bytes: int
    free_bytes: int


class DisplaySchedule(BaseModel):
    enabled: bool
    on_time: str   # "HH:MM"
    off_time: str  # "HH:MM"


class ClipOrderRequest(BaseModel):
    order: list[str]  # list of clip IDs in desired order


class WifiCredentials(BaseModel):
    ssid: str
    password: str
