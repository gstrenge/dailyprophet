"""
Wi-Fi credential endpoint — proxies to the dailyprophet-network-agent service.
On non-Pi environments where the agent is not running, both endpoints return 503.
"""

import httpx
from fastapi import APIRouter, HTTPException

from app.config import settings
from app.models import WifiCredentials, WifiStatus

router = APIRouter(prefix="/wifi", tags=["wifi"])

_AGENT_TIMEOUT = 50.0  # slightly longer than the agent's own 40 s nmcli timeout


@router.get("/status", response_model=WifiStatus)
async def get_wifi_status():
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{settings.net_agent_base_url}/status", timeout=5.0)
        r.raise_for_status()
        return r.json()
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Network agent unavailable")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text)


@router.post("")
async def set_wifi(credentials: WifiCredentials):
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{settings.net_agent_base_url}/wifi",
                json={"ssid": credentials.ssid, "password": credentials.password},
                timeout=_AGENT_TIMEOUT,
            )
        if r.status_code == 200:
            return {"status": "ok", "message": "Connected to network successfully"}
        # Agent returns 500 on auth failure / timeout — surface the detail
        raise HTTPException(status_code=r.status_code, detail=r.text or "Failed to connect to network")
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Network agent unavailable")
