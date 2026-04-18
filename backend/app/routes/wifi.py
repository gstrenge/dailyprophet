"""
Wi-Fi credential endpoint — stub for Phase 1.
Phase 2 will proxy this to the Network Bootstrap Service.
"""

from fastapi import APIRouter
from app.models import WifiCredentials

router = APIRouter(prefix="/wifi", tags=["wifi"])


@router.post("")
async def set_wifi(credentials: WifiCredentials):
    # Phase 1 stub: echoes success.
    # Phase 2: write to wpa_supplicant / call hostapd service.
    return {"status": "ok", "message": "Wi-Fi credentials accepted (stub)"}
