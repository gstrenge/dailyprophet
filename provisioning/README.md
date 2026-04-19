# Daily Prophet — Provisioning

## Target hardware / OS

- **Device:** Raspberry Pi 5 (BCM2712 / rpi-2712 kernel)
- **OS:** Raspberry Pi OS Lite 64-bit (Debian Trixie), flashed via Raspberry Pi Imager
- **Network stack:** NetworkManager (default on Trixie Lite — required; dhcpcd is not supported)

## Flash settings (Raspberry Pi Imager)

| Setting | Value |
|---|---|
| Hostname | `dailyprophet` |
| Username | `pi` |
| SSH | Enabled |
| Wi-Fi | Leave blank — provisioning handles it |

---

## Install

From the Pi (clone or copy the `provisioning/` tree), run as root:

```bash
cd provisioning
sudo ./install.sh
sudo reboot
```

`install.sh` exits with an error if NetworkManager is not active.

### What it installs

**Packages:** `avahi-daemon` `rfkill` `xorg` `openbox` `firefox-esr` `lightdm` `unclutter`

**Network bootstrap**
- Scripts installed to `/usr/local/lib/dailyprophet/network/`
- State directory: `/var/lib/dailyprophet/`
- Config defaults: `/etc/default/dailyprophet-network` (only written if absent; override `WLAN_IF` here, defaults to `wlan0`)
- Systemd units enabled: `dailyprophet-network-bootstrap.service` (oneshot, runs on boot), `dailyprophet-network-agent.service` (long-running, localhost HTTP API)
- Boot logic: if no STA profile/marker present → activates AP `DailyProphet-Setup` (WPA2 password `dailyprophet-setup`, IP `192.168.4.1`, NM shared DHCP). If STA marker and profile exist → connects to home Wi-Fi; falls back to AP on failure.

**Hostname:** `hostnamectl set-hostname dailyprophet` + `/etc/hosts` `127.0.1.1` entry updated.

**Kiosk display**
- LightDM configured to autologin as `pi` into an Openbox session (`/etc/lightdm/lightdm.conf.d/50-dailyprophet.conf`)
- Openbox autostart (`/etc/xdg/openbox/autostart`): disables screen blanking/DPMS, hides cursor via `unclutter`, polls `http://localhost/kiosk-view` until the backend is up, then launches `firefox-esr --kiosk`. Restarts Firefox if it exits.
- Firefox policies (`/usr/lib/firefox-esr/distribution/policies.json`): suppresses first-run dialogs, update prompts, telemetry, Pocket, Firefox Accounts.
- Xorg permissions (`/etc/X11/Xwrapper.config`): `allowed_users=anybody` + `needs_root_rights=yes` — required for LightDM-launched X to open DRM.
- Xorg display config (`/etc/X11/xorg.conf.d/99-dailyprophet.conf`): pins modesetting to the vc4-drm card (`/dev/dri/by-path/platform-axi:gpu-card`) via an `OutputClass` match — avoids the Pi 5's card0/card1 ordering issue where Xorg would pick the v3d renderer (no connectors) and exit with "no screens found".

**Splash screen:** Copies `imgs/splash.png` to the Plymouth pix theme if Plymouth is installed. Skipped automatically on Lite (Plymouth not present by default).

**Services enabled:** `dailyprophet-network-bootstrap` `dailyprophet-network-agent` `avahi-daemon` `lightdm`

---

## Network agent API

Bind address: `127.0.0.1:18765` (override with `DAILYPROPHET_NET_AGENT_ADDR` / `DAILYPROPHET_NET_AGENT_PORT` in `/etc/default/dailyprophet-network`).

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/status` | — | JSON: `mode`, `wlan`, `ssid`, `message` |
| `POST` | `/wifi` | `{"ssid":"...","password":"..."}` | 200 on success; 500 + revert to AP on failure |

The backend Docker container calls `POST /wifi` to hand off home Wi-Fi credentials.

### Credential flow

1. `POST /wifi` → agent writes SSID (line 1) and password (line 2) to `/var/lib/dailyprophet/sta.creds` (mode 0600, root only).
2. Agent calls `bootstrap.sh client`.
3. bootstrap reads and deletes the creds file, creates the `dp-sta` NM profile, calls `nmcli --wait 40 con up dp-sta`.
4. **Success:** creates `/var/lib/dailyprophet/sta.enabled` marker, tears down AP. Returns 200.
5. **Failure** (bad password, SSID not found, 40 s timeout): deletes `dp-sta`, removes marker, restores `dp-ap`. Returns 500.

---

## Post-install verification

```bash
# All four should be "enabled"
systemctl is-enabled dailyprophet-network-bootstrap dailyprophet-network-agent lightdm avahi-daemon

# Network agent is responding
curl http://127.0.0.1:18765/status

# Xorg configs are present
cat /etc/X11/xorg.conf.d/99-dailyprophet.conf
cat /etc/X11/Xwrapper.config

# LightDM and X are running
systemctl is-active lightdm
DISPLAY=:0 XAUTHORITY=/var/run/lightdm/root/:0 xdpyinfo | head -5
```

---

## Known issues

### avahi advertising IPv6 (browser resolution fails)

Avahi advertises both IPv4 and IPv6. Windows and Android browsers prefer IPv6, which may not route on home networks — `http://dailyprophet.local` fails in browsers even though `ping -4 dailyprophet.local` works.

Fix (does not disable IPv6 system-wide):
```bash
sudo sed -i 's/^#use-ipv6=yes/use-ipv6=no/' /etc/avahi/avahi-daemon.conf
# if the line is absent instead:
echo "use-ipv6=no" | sudo tee -a /etc/avahi/avahi-daemon.conf
sudo systemctl restart avahi-daemon
```

**TODO:** Add to `install.sh`.

### LightDM accountsservice warnings

LightDM logs `Error getting user list from org.freedesktop.Accounts` and `Could not enumerate user data directory /var/lib/lightdm/data`. These are non-fatal — autologin works. Caused by `accountsservice` not being installed on Lite.

### DSI touchscreen (future deployment)

The current Xorg config targets the vc4-drm card by path, which still works with a DSI ribbon-cable display. However, DSI panels have no EDID so Xorg cannot auto-detect the resolution. You will need to add a `Monitor` section with an explicit `Modeline` and `Option "UseEdidFreqs" "false"` for the panel's native resolution.

### Plymouth splash screen

Not installed on Lite. The splash step in `install.sh` is skipped automatically. To enable:
```bash
sudo apt-get install -y plymouth plymouth-themes
sudo ./install.sh
```

---

## Reset Wi-Fi / force AP mode

```bash
sudo rm -f /var/lib/dailyprophet/sta.enabled
sudo nmcli con delete dp-sta
sudo reboot
```

Or without rebooting:
```bash
sudo rm -f /var/lib/dailyprophet/sta.enabled
sudo /usr/local/lib/dailyprophet/network/bootstrap.sh ap
```
