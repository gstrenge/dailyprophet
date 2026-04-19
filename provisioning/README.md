# Daily Prophet — Raspberry Pi network provisioning

This directory contains **host-side** files for §2.1 (Network Bootstrap): first-boot / setup AP, home Wi‑Fi credentials, and a small **localhost-only** API for the backend container to trigger changes.

## Intended environment

- **Raspberry Pi OS Lite** (or similar) with **`dhcpcd`** managing interfaces and **`wpa_supplicant@wlan0`** for client mode.
- Single Wi‑Fi interface, default **`wlan0`** (override with `/etc/default/dailyprophet-network`).
- **Not** designed for images that use **NetworkManager** for `wlan0` without removing/disabling it first — mixing stacks will conflict. See “NetworkManager” below.

## What gets installed

| Piece | Role |
|--------|------|
| `hostapd` | Setup SSID **`DailyProphet-Setup`** (WPA2 passphrase **`dailyprophet-setup`**) when no home Wi‑Fi is configured |
| `dnsmasq` | DHCP for clients on the setup AP (`192.168.4.0/24`) |
| `avahi-daemon` | mDNS (`dailyprophet.local`) — host service; advertise on whatever interfaces are up |
| `dailyprophet-network-bootstrap.service` | **Oneshot** on boot: choose AP vs STA, lay down configs, start/stop `hostapd` / `wpa_supplicant` as needed |
| `dailyprophet-network-agent.service` | **Long-running** HTTP on **`127.0.0.1:18765`** — `POST /wifi` for credentials (same JSON shape as the backend stub) |

State and generated configs live under **`/var/lib/dailyprophet/`**.

## Quick install

On the Pi (from a clone of this repo, or copy the `provisioning/` tree):

```bash
cd provisioning
sudo ./install.sh
sudo reboot   # recommended after first install
```

## Localhost agent API (for Docker backend)

Bind address: **`127.0.0.1:18765`** (override with `DAILYPROPHET_NET_AGENT_ADDR` / `DAILYPROPHET_NET_AGENT_PORT` in the agent’s `Environment=` file or drop-in).

| Method | Path | Body | Notes |
|--------|------|------|--------|
| `GET` | `/status` | — | JSON: `mode`, `wlan`, `ssid`, `message` |
| `POST` | `/wifi` | `{"ssid":"...","password":"..."}` | Writes STA config, runs `bootstrap.sh client`; returns JSON |

Phase 2 backend: replace the Wi‑Fi stub with an HTTP client to `http://127.0.0.1:18765/wifi` (or mount `host` network and same URL).

## mDNS

**`avahi-daemon`** is enabled by the installer. Ensure the Pi hostname is **`dailyprophet`** (or your chosen name) via `raspi-config` / `/etc/hostname` so `dailyprophet.local` matches the SPEC.

## NetworkManager

If your image uses **NetworkManager** on `wlan0`, either:

- migrate this device to **dhcpcd + wpa_supplicant** before using these scripts, or  
- replace the bootstrap logic with **nmcli** profiles (not included here).

## Manual recovery

- **AP mode** with no credentials: connect to `DailyProphet-Setup`, open the web UI, submit Wi‑Fi.  
- **Broken STA config**: remove `/var/lib/dailyprophet/sta.enabled`, reboot → bootstrap returns to AP mode (or run `sudo /usr/local/lib/dailyprophet/network/bootstrap.sh ap`).

## Files

- `install.sh` — installs packages, copies scripts/units/templates, `daemon-reload`, enables units  
- `scripts/bootstrap.sh` — AP vs client switching  
- `scripts/agent.py` — localhost HTTP API (stdlib only)  
- `templates/` — `hostapd`, `dnsmasq`, `dhcpcd` snippets  
- `systemd/` — unit files  
