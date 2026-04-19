#!/usr/bin/env python3
"""
Daily Prophet network agent — localhost HTTP API for Wi-Fi bootstrap.
Stdlib only. Run as root (systemd service).

POST /wifi  {"ssid":"...","password":"..."}
GET  /status
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse

STATE_DIR = Path("/var/lib/dailyprophet")
FRAGMENT = STATE_DIR / "sta.network.fragment"
MARKER_STA = STATE_DIR / "sta.enabled"
BOOTSTRAP = "/usr/local/lib/dailyprophet/network/bootstrap.sh"

ADDR = os.environ.get("DAILYPROPHET_NET_AGENT_ADDR", "127.0.0.1")
PORT = int(os.environ.get("DAILYPROPHET_NET_AGENT_PORT", "18765"))
MAX_BODY = 32768


def _wlan() -> str:
    v = os.environ.get("WLAN_IF", "").strip()
    if v:
        return v
    p = Path("/etc/default/dailyprophet-network")
    if p.is_file():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line.startswith("WLAN_IF=") and not line.startswith("#"):
                return line.split("=", 1)[1].strip().strip('"').strip("'") or "wlan0"
    return "wlan0"


def _mode() -> str:
    if MARKER_STA.is_file() and Path(f"/etc/wpa_supplicant/wpa_supplicant-{_wlan()}.conf").is_file():
        return "client"
    return "ap"


def _ssid_hint() -> str | None:
    p = Path(f"/etc/wpa_supplicant/wpa_supplicant-{_wlan()}.conf")
    if not p.is_file():
        return None
    for line in p.read_text().splitlines():
        if "ssid=" in line and not line.strip().startswith("#"):
            raw = line.split("ssid=", 1)[1].strip()
            return raw.strip('"').strip("'")
    return None


def _write_fragment(ssid: str, password: str) -> None:
    r = subprocess.run(
        ["wpa_passphrase", ssid, password],
        capture_output=True,
        text=True,
        check=True,
    )
    lines: list[str] = []
    for line in r.stdout.splitlines():
        s = line.strip()
        if s.startswith("#"):
            continue
        lines.append(line)
    body = "\n".join(lines).strip() + "\n"
    STATE_DIR.mkdir(parents=True, mode=0o750, exist_ok=True)
    FRAGMENT.write_text(body, encoding="utf-8")
    os.chmod(FRAGMENT, 0o600)


def _run_bootstrap_client() -> tuple[int, str]:
    p = subprocess.run(
        [BOOTSTRAP, "client"],
        capture_output=True,
        text=True,
    )
    out = (p.stdout or "") + (p.stderr or "")
    return p.returncode, out.strip()


class Handler(BaseHTTPRequestHandler):
    server_version = "DailyProphetNetwork/1.0"

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[dailyprophet-agent] " + (fmt % args) + "\n")

    def _json(self, code: int, payload: dict) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/status":
            self._json(
                200,
                {
                    "mode": _mode(),
                    "wlan": _wlan(),
                    "ssid": _ssid_hint(),
                    "message": "ok",
                },
            )
            return
        self._json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/wifi":
            self._json(404, {"error": "not_found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY:
            self._json(413, {"error": "body_too_large"})
            return
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._json(400, {"error": "invalid_json"})
            return
        ssid = str(body.get("ssid", "")).strip()
        password = str(body.get("password", ""))
        if not ssid:
            self._json(400, {"error": "ssid_required"})
            return

        try:
            _write_fragment(ssid, password)
        except subprocess.CalledProcessError as e:
            self._json(
                500,
                {"status": "error", "message": f"wpa_passphrase failed: {e.stderr or e}"},
            )
            return
        except OSError as e:
            self._json(500, {"status": "error", "message": str(e)})
            return

        code, log = _run_bootstrap_client()
        if code != 0:
            self._json(
                500,
                {
                    "status": "error",
                    "message": "bootstrap client failed",
                    "detail": log[-4000:],
                },
            )
            return

        self._json(200, {"status": "ok", "message": "Wi-Fi credentials applied; reconnecting"})


def main() -> None:
    if os.geteuid() != 0:
        print("Run as root.", file=sys.stderr)
        sys.exit(1)
    STATE_DIR.mkdir(parents=True, mode=0o750, exist_ok=True)
    srv = HTTPServer((ADDR, PORT), Handler)
    sys.stderr.write(
        f"[dailyprophet-agent] listening on http://{ADDR}:{PORT} (GET /status, POST /wifi)\n"
    )
    srv.serve_forever()


if __name__ == "__main__":
    main()
