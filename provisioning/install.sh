#!/usr/bin/env bash
# Install Daily Prophet network bootstrap + localhost agent onto a Raspberry Pi.
# Requires NetworkManager (default on Raspberry Pi OS Bookworm/Trixie Lite).
# Run as root: sudo ./install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

REPO_DIR="$(dirname "${SCRIPT_DIR}")"
readonly REPO_DIR

KIOSK_USER="pi"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

# Verify NetworkManager is the active network stack
if ! systemctl is-active --quiet NetworkManager; then
  echo "ERROR: NetworkManager is not running. This installer requires NetworkManager." >&2
  echo "       If using dhcpcd, switch stacks or use a different provisioning method." >&2
  exit 1
fi

# Pi OS Lite ships with wpa_supplicant.service enabled as a standalone daemon.
# NetworkManager manages its own wpa_supplicant instance via D-Bus — a second
# standalone instance racing for wlan0 causes NM to mark the interface
# unavailable and the soft-block to persist across reboots.
# Disable auto-start but leave the unit unmasked so NM can D-Bus activate it.
systemctl disable wpa_supplicant 2>/dev/null || true
systemctl stop wpa_supplicant 2>/dev/null || true

export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y --no-install-recommends \
  avahi-daemon rfkill \
  xorg openbox firefox-esr lightdm unclutter \
  curl ca-certificates \
  ffmpeg

# Ensure Wi-Fi radio is unblocked
rfkill unblock wifi 2>/dev/null || true

# ── Network bootstrap ────────────────────────────────────────────────────────

install -d -m 0755 /usr/local/lib/dailyprophet/network
install -d -m 0750 /var/lib/dailyprophet

install -m 0755 "${SCRIPT_DIR}/scripts/bootstrap.sh" /usr/local/lib/dailyprophet/network/bootstrap.sh
install -m 0755 "${SCRIPT_DIR}/scripts/agent.py"     /usr/local/lib/dailyprophet/network/agent.py

install -m 0644 "${SCRIPT_DIR}/systemd/dailyprophet-network-bootstrap.service" /etc/systemd/system/
install -m 0644 "${SCRIPT_DIR}/systemd/dailyprophet-network-agent.service"     /etc/systemd/system/

if [[ ! -f /etc/default/dailyprophet-network ]]; then
  install -m 0644 "${SCRIPT_DIR}/templates/default-dailyprophet-network" /etc/default/dailyprophet-network
fi

# ── Hostname ─────────────────────────────────────────────────────────────────

hostnamectl set-hostname dailyprophet
sed -i "s/127\.0\.1\.1.*/127.0.1.1\tdailyprophet/" /etc/hosts
echo "Hostname set to dailyprophet"

# ── Splash screen ────────────────────────────────────────────────────────────

SPLASH_SRC="${SCRIPT_DIR}/imgs/splash.png"
SPLASH_DST="/usr/share/plymouth/themes/pix/splash.png"
if [[ ! -f "${SPLASH_SRC}" ]]; then
  echo "WARNING: ${SPLASH_SRC} not found — skipping splash screen"
elif [[ ! -d "$(dirname "${SPLASH_DST}")" ]]; then
  echo "WARNING: Plymouth pix theme not installed — skipping splash screen"
else
  install -m 0644 "${SPLASH_SRC}" "${SPLASH_DST}"
  update-initramfs -u
  echo "Splash screen installed"
fi

# ── Kiosk display ────────────────────────────────────────────────────────────

# LightDM: autologin as pi into an Openbox session
install -d -m 0755 /etc/lightdm/lightdm.conf.d
cat > /etc/lightdm/lightdm.conf.d/50-dailyprophet.conf << 'EOF'
[Seat:*]
autologin-user=pi
autologin-user-timeout=0
user-session=openbox
EOF

# Openbox autostart: blanking off, cursor hidden, Firefox kiosk with retry loop
install -d -m 0755 /etc/xdg/openbox
cat > /etc/xdg/openbox/autostart << 'EOF'
# Route output to DSI display; disable HDMI outputs.
# X defaults to HDMI-1 as primary (even when disconnected) because connector
# enumeration puts HDMI first. This forces the DSI panel as primary at its
# native 800x480 resolution.
xrandr --output DSI-1-2 --mode 800x480 --primary --output HDMI-1 --off --output HDMI-2 --off

# Disable screen blanking and power management
xset s off
xset s noblank
xset -dpms

# Hide cursor after 0.5s idle
unclutter -idle 0.5 -root &

# Wait for the app to be ready, then launch Firefox; restart if it ever exits
(
  while true; do
    until curl -sf http://localhost/kiosk-view > /dev/null 2>&1; do
      sleep 2
    done
    firefox-esr --kiosk http://localhost/kiosk-view
    sleep 2
  done
) &
EOF

# Firefox policies: suppress first-run dialogs and update prompts
install -d -m 0755 /usr/lib/firefox-esr/distribution
cat > /usr/lib/firefox-esr/distribution/policies.json << 'EOF'
{
  "policies": {
    "DisableAppUpdate": true,
    "OverrideFirstRunPage": "",
    "OverridePostUpdatePage": "",
    "DisableTelemetry": true,
    "DisplayBookmarksToolbar": false,
    "DisplayMenuBar": "never",
    "DisableFirefoxAccounts": true,
    "DisablePocket": true
  }
}
EOF

systemctl enable lightdm
systemctl set-default graphical.target

# ── Display: Xorg permissions + Pi 5 DRM card selection ──────────────────────

# Allow LightDM-launched X to run as pi with DRM master rights.
# Without this file the Xorg shim denies non-root launch and exits silently.
install -m 0644 /dev/stdin /etc/X11/Xwrapper.config << 'EOF'
allowed_users=anybody
needs_root_rights=yes
EOF

# Pi 5 exposes two DRM nodes: card0 = v3d (renderer, no connectors),
# card1 = vc4-drm (display controller). Xorg's modesetting driver walks them
# in order and gives up at card0. OutputClass + MatchDriver "vc4" + kmsdev
# pins it to the right card via the stable by-path symlink (immune to
# card0/card1 renumbering across kernel versions).
#

install -d -m 0755 /etc/X11/xorg.conf.d
# Remove any stale config from previous debug sessions
rm -f /etc/X11/xorg.conf.d/99-modesetting.conf
install -m 0644 /dev/stdin /etc/X11/xorg.conf.d/99-dailyprophet.conf << 'EOF'
Section "OutputClass"
    Identifier  "vc4"
    MatchDriver "vc4"
    Driver      "modesetting"
    Option      "PrimaryGPU" "true"
    Option      "kmsdev"     "/dev/dri/by-path/platform-axi:gpu-card"
EndSection
EOF

# ── Docker ───────────────────────────────────────────────────────────────────

if ! command -v docker &>/dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
else
  echo "Docker already installed: $(docker --version)"
fi

# Add kiosk user to docker group so they can manage containers without sudo
usermod -aG docker "${KIOSK_USER}"

systemctl enable docker
systemctl start docker

# ── Docker Compose services ───────────────────────────────────────────────────

# Ensure the clips bind-mount directory exists with correct ownership before
# compose creates it as root.
install -d -m 0755 "${REPO_DIR}/data/clips"
chown "${KIOSK_USER}:${KIOSK_USER}" "${REPO_DIR}/data"
chown "${KIOSK_USER}:${KIOSK_USER}" "${REPO_DIR}/data/clips"

echo "Building and starting Docker Compose services..."
docker compose -f "${REPO_DIR}/docker-compose.yml" up --build -d

# ── Finalise ─────────────────────────────────────────────────────────────────

systemctl daemon-reload

systemctl enable dailyprophet-network-bootstrap.service
systemctl enable dailyprophet-network-agent.service
systemctl enable avahi-daemon.service

echo ""
echo "Install finished. Reboot recommended:"
echo "  sudo reboot"
echo ""
echo "Docker services are running. Check status with:"
echo "  docker compose -f ${REPO_DIR}/docker-compose.yml ps"
echo ""
echo "After reboot: setup AP = DailyProphet-Setup (when no STA profile saved),"
echo "agent on 172.17.0.1:18765 (Docker bridge only) — see provisioning/README.md"
