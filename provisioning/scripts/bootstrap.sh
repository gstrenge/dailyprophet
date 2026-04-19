#!/usr/bin/env bash
# Daily Prophet network bootstrap — AP (setup) vs STA (home Wi-Fi).
# Uses NetworkManager (nmcli). Requires NM ≥ 1.x (Raspberry Pi OS Bookworm default).

set -euo pipefail

STATE_DIR="/var/lib/dailyprophet"
MARKER_STA="${STATE_DIR}/sta.enabled"
CREDS_FILE="${STATE_DIR}/sta.creds"

AP_CON="dp-ap"
STA_CON="dp-sta"
AP_SSID="DailyProphet-Setup"
AP_PASS="dailyprophet-setup"
AP_IP="192.168.4.1/24"
STA_TIMEOUT=40   # seconds for nmcli --wait

log() { echo "[dailyprophet-network] $*" >&2; }

load_defaults() {
  if [[ -f /etc/default/dailyprophet-network ]]; then
    # shellcheck source=/dev/null
    source /etc/default/dailyprophet-network
  fi
  WLAN_IF="${WLAN_IF:-wlan0}"
}

_ensure_ap_profile() {
  if nmcli con show "${AP_CON}" &>/dev/null; then
    return
  fi
  nmcli con add \
    type wifi ifname "${WLAN_IF}" con-name "${AP_CON}" \
    ssid "${AP_SSID}" \
    802-11-wireless.mode ap \
    802-11-wireless.band bg \
    ipv4.method shared \
    ipv4.addresses "${AP_IP}" \
    wifi-sec.key-mgmt wpa-psk \
    wifi-sec.psk "${AP_PASS}" \
    connection.autoconnect no
  log "Created AP profile '${AP_CON}'"
}

apply_ap_mode() {
  load_defaults
  log "Activating AP mode (SSID: ${AP_SSID})"
  _ensure_ap_profile
  nmcli con down "${STA_CON}" 2>/dev/null || true
  nmcli con up "${AP_CON}"
  rm -f "${MARKER_STA}"
  log "AP mode active"
}

apply_sta_mode() {
  load_defaults

  if [[ ! -f "${CREDS_FILE}" ]]; then
    log "No credentials file ${CREDS_FILE}"
    return 1
  fi

  local ssid pass
  ssid=$(sed -n '1p' "${CREDS_FILE}")
  pass=$(sed -n '2p' "${CREDS_FILE}")
  rm -f "${CREDS_FILE}"

  if [[ -z "${ssid}" ]]; then
    log "Empty SSID — aborting STA"
    return 1
  fi

  log "Connecting to '${ssid}'"

  nmcli con delete "${STA_CON}" 2>/dev/null || true

  if [[ -n "${pass}" ]]; then
    nmcli con add \
      type wifi ifname "${WLAN_IF}" con-name "${STA_CON}" \
      ssid "${ssid}" \
      wifi-sec.key-mgmt wpa-psk \
      wifi-sec.psk "${pass}" \
      connection.autoconnect yes \
      connection.autoconnect-priority 10
  else
    nmcli con add \
      type wifi ifname "${WLAN_IF}" con-name "${STA_CON}" \
      ssid "${ssid}" \
      connection.autoconnect yes \
      connection.autoconnect-priority 10
  fi

  nmcli con down "${AP_CON}" 2>/dev/null || true

  if nmcli --wait "${STA_TIMEOUT}" con up "${STA_CON}"; then
    : >"${MARKER_STA}"
    log "STA mode active"
    return 0
  else
    log "STA failed — removing profile, restoring AP"
    nmcli con delete "${STA_CON}" 2>/dev/null || true
    rm -f "${MARKER_STA}"
    apply_ap_mode
    return 1
  fi
}

cmd_boot() {
  load_defaults
  if [[ -f "${MARKER_STA}" ]] && nmcli con show "${STA_CON}" &>/dev/null; then
    log "Boot: STA profile found — connecting"
    nmcli con down "${AP_CON}" 2>/dev/null || true
    if nmcli --wait "${STA_TIMEOUT}" con up "${STA_CON}"; then
      log "Boot: connected to home Wi-Fi"
    else
      log "Boot: STA failed — falling back to AP"
      nmcli con delete "${STA_CON}" 2>/dev/null || true
      rm -f "${MARKER_STA}"
      apply_ap_mode
    fi
  else
    log "Boot: no STA profile — AP mode"
    rm -f "${MARKER_STA}"
    apply_ap_mode
  fi
}

usage() {
  echo "Usage: $0 {boot|ap|client}" >&2
  exit 1
}

main() {
  case "${1:-}" in
    boot)   cmd_boot ;;
    ap)     apply_ap_mode ;;
    client) apply_sta_mode ;;
    *)      usage ;;
  esac
}

main "$@"
