#!/usr/bin/env bash
set -euo pipefail

ROUTER="${1:-192.168.1.1}"
USER="${2:-root}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "==> Deploying Pocket-AP to ${USER}@${ROUTER} ..."

# 1. Deploy static web app to /www/pocket-ap (never touches /www/index.html or LuCI)
ssh -o StrictHostKeyChecking=accept-new "${USER}@${ROUTER}" 'mkdir -p /www/pocket-ap /usr/share/rpcd/acl.d /usr/share/rpcd/ucode /usr/libexec /etc/hotplug.d/iface /etc/rc.button'
tar -C "${ROOT_DIR}/www" -cf - pocket-ap | ssh "${USER}@${ROUTER}" 'rm -rf /www/pocket-ap && tar -C /www -xf - && chown -R root:root /www/pocket-ap'

# 2. Deploy rpcd ACL, ucode backend plugin, captive portal watchdog, and hardware switch handler
tar -C "${ROOT_DIR}/openwrt/files" -cf - \
  usr/share/rpcd/acl.d/pocket-ap.json \
  usr/share/rpcd/ucode/pocket-ap \
  usr/libexec/pocket-ap-portal \
  usr/libexec/pocket-ap-switch \
  etc/rc.button/BTN_0 \
  etc/hotplug.d/iface/95-pocket-ap-portal \
  | ssh "${USER}@${ROUTER}" 'tar -C / -xf -'

# 3. Enforce root ownership, permissions, and reload rpcd
ssh "${USER}@${ROUTER}" '
  chown root:root /usr/share/rpcd/acl.d/pocket-ap.json /usr/share/rpcd/ucode/pocket-ap /usr/libexec/pocket-ap-portal /usr/libexec/pocket-ap-switch /etc/rc.button/BTN_0 /etc/hotplug.d/iface/95-pocket-ap-portal
  chmod 644 /usr/share/rpcd/acl.d/pocket-ap.json /usr/share/rpcd/ucode/pocket-ap
  chmod 755 /usr/libexec/pocket-ap-portal /usr/libexec/pocket-ap-switch /etc/rc.button/BTN_0 /etc/hotplug.d/iface/95-pocket-ap-portal
  /etc/init.d/rpcd restart
  sleep 1
  ubus -v list pocket-ap
'

echo ""
echo "==> Pocket-AP deployed successfully!"
echo "    Pocket-AP URL: http://${ROUTER}/pocket-ap/"
echo "    Stock LuCI:    http://${ROUTER}/"
