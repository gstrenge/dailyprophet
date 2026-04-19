#!/usr/bin/env bash
# Daily Prophet network bootstrap — AP (setup) vs STA (home Wi-Fi).
# Intended for dhcpcd + wpa_supplicant on Raspberry Pi OS Lite.

set -euo pipefail

STATE_DIR="/var/lib/dailyprophet"
MARKER_STA="${STATE_DIR}/sta.enabled"
FRAGMENT="${STATE_DIR}/sta.network.fragment"
AP_IP="192.168.4.1"
DNSMASQ_DROPIN="/etc/dnsmasq.d/99-dailyprophet-ap.conf"
HOSTAPD_RUN="/etc/hostapd/hostapd.conf"
HOSTAPD_SRC="/etc/dailyprophet/hostapd.conf"
DHCPCD_MARKER_BEGIN="# BEGIN DAILYPROPHET AP"
DHCPCD_MARKER_END="# END DAILYPROPHET AP"

log() { echo "[dailyprophet-network] $*" >&2; }

load_defaults() {
  if [[ -f /etc/default/dailyprophet-network ]]; then
    # shellcheck source=/dev/null
    source /etc/default/dailyprophet-network
  fi
  WLAN_IF="${WLAN_IF:-wlan0}"
  WIFI_COUNTRY="${WIFI_COUNTRY:-US}"
}

remove_dhcpcd_ap_block() {
  if [[ ! -f /etc/dhcpcd.conf ]]; then
    return 0
  fi
  if grep -qF "${DHCPCD_MARKER_BEGIN}" /etc/dhcpcd.conf 2>/dev/null; then
    sed -i "/${DHCPCD_MARKER_BEGIN}/,/${DHCPCD_MARKER_END}/d" /etc/dhcpcd.conf
    log "Removed dhcpcd AP block"
  fi
}

add_dhcpcd_ap_block() {
  remove_dhcpcd_ap_block
  {
    echo "${DHCPCD_MARKER_BEGIN}"
    sed -e "s/IFACE/${WLAN_IF}/g" -e "s|IP|${AP_IP}|g" /etc/dailyprophet/dhcpcd-ap-snippet.conf
    echo "${DHCPCD_MARKER_END}"
  } >> /etc/dhcpcd.conf
  log "Added dhcpcd AP block for ${WLAN_IF}"
}

write_hostapd_conf() {
  install -d /etc/hostapd
  sed -e "s/^interface=.*/interface=${WLAN_IF}/" \
    -e "s/^country_code=.*/country_code=${WIFI_COUNTRY}/" \
    "${HOSTAPD_SRC}" > "${HOSTAPD_RUN}"
  printf 'DAEMON_CONF="%s"\n' "${HOSTAPD_RUN}" >/etc/default/hostapd
  log "Wrote ${HOSTAPD_RUN}"
}

apply_ap_mode() {
  load_defaults
  log "Switching to AP mode (setup SSID)"

  systemctl stop "wpa_supplicant@${WLAN_IF}.service" 2>/dev/null || true
  systemctl disable "wpa_supplicant@${WLAN_IF}.service" 2>/dev/null || true
  systemctl mask "wpa_supplicant@${WLAN_IF}.service" 2>/dev/null || true

  rm -f "${MARKER_STA}" "${FRAGMENT}"

  write_hostapd_conf
  install -m0644 /etc/dailyprophet/dnsmasq-dailyprophet.conf "${DNSMASQ_DROPIN}"
  sed -i "s/^interface=.*/interface=${WLAN_IF}/" "${DNSMASQ_DROPIN}" || true

  add_dhcpcd_ap_block

  systemctl unmask hostapd 2>/dev/null || true
  systemctl enable hostapd
  systemctl restart dhcpcd
  systemctl restart dnsmasq
  systemctl restart hostapd
  log "AP mode active"
}

apply_sta_mode() {
  load_defaults
  log "Switching to STA mode (home Wi-Fi)"

  if [[ ! -f "${FRAGMENT}" ]]; then
    log "Missing ${FRAGMENT}; cannot enter STA mode"
    return 1
  fi

  systemctl stop hostapd 2>/dev/null || true
  systemctl disable hostapd 2>/dev/null || true
  systemctl unmask hostapd 2>/dev/null || true

  rm -f "${DNSMASQ_DROPIN}"
  remove_dhcpcd_ap_block

  install -d /etc/wpa_supplicant
  local out="/etc/wpa_supplicant/wpa_supplicant-${WLAN_IF}.conf"
  {
    echo "country=${WIFI_COUNTRY}"
    echo "ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev"
    echo "update_config=1"
    echo
    cat "${FRAGMENT}"
  } > "${out}"
  chmod 600 "${out}"
  log "Wrote ${out}"

  systemctl unmask "wpa_supplicant@${WLAN_IF}.service" 2>/dev/null || true
  systemctl enable "wpa_supplicant@${WLAN_IF}.service"
  systemctl restart dhcpcd
  systemctl restart "wpa_supplicant@${WLAN_IF}.service"

  : >"${MARKER_STA}"
  log "STA mode configured"
}

cmd_boot() {
  load_defaults
  if [[ -f "${MARKER_STA}" ]] && [[ -f "/etc/wpa_supplicant/wpa_supplicant-${WLAN_IF}.conf" ]]; then
    log "Boot: STA profile present"
    # Ensure AP services are down; STA up
    rm -f "${DNSMASQ_DROPIN}"
    remove_dhcpcd_ap_block
    systemctl stop hostapd 2>/dev/null || true
    systemctl disable hostapd 2>/dev/null || true
    systemctl unmask "wpa_supplicant@${WLAN_IF}.service" 2>/dev/null || true
    systemctl enable "wpa_supplicant@${WLAN_IF}.service" 2>/dev/null || true
    systemctl restart dhcpcd || true
    systemctl restart "wpa_supplicant@${WLAN_IF}.service" || true
  else
    log "Boot: no STA profile — AP mode"
    apply_ap_mode
  fi
}

usage() {
  echo "Usage: $0 {boot|ap|client}" >&2
  exit 1
}

main() {
  case "${1:-}" in
    boot) cmd_boot ;;
    ap) apply_ap_mode ;;
    client) apply_sta_mode ;;
    *) usage ;;
  esac
}

main "$@"
