#!/usr/bin/env bash
# Install Daily Prophet network bootstrap + localhost agent onto a Raspberry Pi.
# Requires NetworkManager (default on Raspberry Pi OS Bookworm/Trixie Lite).
# Run as root: sudo ./install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

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

export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y --no-install-recommends \
  avahi-daemon rfkill \
  xorg openbox firefox-esr lightdm unclutter

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
if [[ -f "${SPLASH_SRC}" ]]; then
  install -m 0644 "${SPLASH_SRC}" "${SPLASH_DST}"
  update-initramfs -u
  echo "Splash screen installed"
else
  echo "WARNING: ${SPLASH_SRC} not found — skipping splash screen"
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

# ── Finalise ─────────────────────────────────────────────────────────────────

systemctl daemon-reload

systemctl enable dailyprophet-network-bootstrap.service
systemctl enable dailyprophet-network-agent.service
systemctl enable avahi-daemon.service

echo ""
echo "Install finished. Reboot recommended:"
echo "  sudo reboot"
echo ""
echo "After reboot: setup AP = DailyProphet-Setup (when no STA profile saved),"
echo "agent on 127.0.0.1:18765 — see provisioning/README.md"
