#!/usr/bin/env bash
# Install Daily Prophet network bootstrap + localhost agent onto a Raspberry Pi.
# Run as root: sudo ./install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y --no-install-recommends \
  hostapd dnsmasq avahi-daemon rfkill wpasupplicant

install -d -m 0755 /usr/local/lib/dailyprophet/network
install -d -m 0750 /var/lib/dailyprophet
install -d -m 0755 /etc/dailyprophet

install -m 0755 "${SCRIPT_DIR}/scripts/bootstrap.sh" /usr/local/lib/dailyprophet/network/bootstrap.sh
install -m 0755 "${SCRIPT_DIR}/scripts/agent.py" /usr/local/lib/dailyprophet/network/agent.py

install -m 0644 "${SCRIPT_DIR}/templates/hostapd.conf" /etc/dailyprophet/hostapd.conf
install -m 0644 "${SCRIPT_DIR}/templates/dnsmasq-dailyprophet.conf" /etc/dailyprophet/dnsmasq-dailyprophet.conf
install -m 0644 "${SCRIPT_DIR}/templates/dhcpcd-ap-snippet.conf" /etc/dailyprophet/dhcpcd-ap-snippet.conf

install -m 0644 "${SCRIPT_DIR}/systemd/dailyprophet-network-bootstrap.service" /etc/systemd/system/
install -m 0644 "${SCRIPT_DIR}/systemd/dailyprophet-network-agent.service" /etc/systemd/system/

if [[ ! -f /etc/default/dailyprophet-network ]]; then
  install -m 0644 "${SCRIPT_DIR}/templates/default-dailyprophet-network" /etc/default/dailyprophet-network
fi

# hostapd is often masked on Raspberry Pi OS until explicitly configured.
systemctl unmask hostapd 2>/dev/null || true

systemctl daemon-reload

systemctl enable dailyprophet-network-bootstrap.service
systemctl enable dailyprophet-network-agent.service

systemctl enable avahi-daemon.service

echo ""
echo "Install finished. Reboot recommended:"
echo "  sudo reboot"
echo ""
echo "After reboot: setup AP = DailyProphet-Setup (when no STA profile enabled),"
echo "agent on 127.0.0.1:18765 — see provisioning/README.md"
