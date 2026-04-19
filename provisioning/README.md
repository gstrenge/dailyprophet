# Daily Prophet — Raspberry Pi network provisioning

This directory contains **host-side** files for §2.1 (Network Bootstrap): first-boot / setup AP, home Wi‑Fi credentials, and a small **localhost-only** API for the backend container to trigger changes.

## Intended environment

- **Raspberry Pi OS Bookworm Lite** (or similar) with **NetworkManager** managing interfaces.
- Single Wi‑Fi interface, default **`wlan0`** (override with `/etc/default/dailyprophet-network`).
- **Not** designed for images that use **dhcpcd + wpa_supplicant** — if your image uses dhcpcd, migrate to NetworkManager first or use a fresh Bookworm image.

## What gets installed

| Piece | Role |
|--------|------|
| NM AP profile `dp-ap` | Setup SSID **`DailyProphet-Setup`** (WPA2 passphrase **`dailyprophet-setup`**), static IP `192.168.4.1/24`, built-in DHCP via NM shared mode |
| NM STA profile `dp-sta` | Created on demand when credentials are submitted; auto-connect priority 10 |
| `avahi-daemon` | mDNS (`dailyprophet.local`) on all active interfaces |
| `dailyprophet-network-bootstrap.service` | **Oneshot** on boot: choose AP vs STA, activate the right NM profile |
| `dailyprophet-network-agent.service` | **Long-running** HTTP on **`127.0.0.1:18765`** — `POST /wifi` for credentials |

State lives under **`/var/lib/dailyprophet/`**.

## Quick install

On the Pi (from a clone of this repo, or copy the `provisioning/` tree):

```bash
cd provisioning
sudo ./install.sh
sudo reboot   # recommended after first install
```

`install.sh` will exit with an error if NetworkManager is not active.

## Localhost agent API (for Docker backend)

Bind address: **`127.0.0.1:18765`** (override with `DAILYPROPHET_NET_AGENT_ADDR` / `DAILYPROPHET_NET_AGENT_PORT` in `/etc/default/dailyprophet-network`).

| Method | Path | Body | Notes |
|--------|------|------|--------|
| `GET` | `/status` | — | JSON: `mode`, `wlan`, `ssid`, `message` |
| `POST` | `/wifi` | `{"ssid":"...","password":"..."}` | Writes creds, runs `bootstrap.sh client`; returns JSON. On auth failure: 500 + reverts to AP. |

Phase 2 backend: replace the Wi‑Fi stub with an HTTP client to `http://127.0.0.1:18765/wifi`.

## Credential flow

1. `POST /wifi` → agent writes `/var/lib/dailyprophet/sta.creds` (mode 0600, root only).
2. Agent calls `bootstrap.sh client`.
3. bootstrap reads + deletes the creds file, creates the `dp-sta` NM profile, calls `nmcli --wait 40 con up dp-sta`.
4. On success: sets `/var/lib/dailyprophet/sta.enabled` marker, returns 200.
5. On failure (bad password, SSID not found, timeout): deletes `dp-sta`, restores `dp-ap`, returns 500 with `"message": "Wi-Fi connection failed; reverted to setup AP"`.

## mDNS

**`avahi-daemon`** is enabled by the installer. Ensure the Pi hostname is **`dailyprophet`** via `raspi-config` → System → Hostname so `dailyprophet.local` resolves correctly.

## Manual recovery

- **AP mode with no credentials**: connect to `DailyProphet-Setup` (password `dailyprophet-setup`), submit Wi‑Fi via web UI.
- **Broken STA config**: `sudo rm -f /var/lib/dailyprophet/sta.enabled && sudo /usr/local/lib/dailyprophet/network/bootstrap.sh ap` — or reboot, bootstrap will fall back to AP automatically since the marker is gone.

## Files

- `install.sh` — installs packages, copies scripts/units/template, `daemon-reload`, enables units
- `scripts/bootstrap.sh` — AP vs STA switching via nmcli
- `scripts/agent.py` — localhost HTTP API (stdlib only)
- `templates/default-dailyprophet-network` — `/etc/default/dailyprophet-network` defaults
- `systemd/` — unit files
