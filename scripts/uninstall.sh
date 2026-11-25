#!/usr/bin/env bash
set -euo pipefail

ROUTER="${1:-192.168.1.1}"
USER="${2:-root}"

echo "==> Removing Pocket-AP from ${USER}@${ROUTER} (LuCI will remain untouched)..."
ssh "${USER}@${ROUTER}" '
  if [ -x /usr/libexec/pocket-ap-portal ]; then
    /usr/libexec/pocket-ap-portal stop >/dev/null 2>&1 || true
  fi
  if [ -f /etc/pocket-ap/index.html.luci-orig ]; then
    cp /etc/pocket-ap/index.html.luci-orig /www/index.html
  fi
  rm -rf /www/pocket-ap
  rm -f /usr/share/rpcd/acl.d/pocket-ap.json
  rm -f /usr/share/rpcd/ucode/pocket-ap
  rm -f /usr/libexec/pocket-ap-portal
  rm -f /usr/libexec/pocket-ap-switch
  rm -f /etc/rc.button/BTN_0
  rm -f /etc/hotplug.d/iface/95-pocket-ap-portal
  rm -f /tmp/dnsmasq.*.d/pocket-ap-adblock.conf /tmp/dnsmasq.d/pocket-ap-adblock.conf
  rm -f /tmp/dnsmasq.*.d/pocket-ap-portal.conf /tmp/dnsmasq.d/pocket-ap-portal.conf
  /etc/init.d/rpcd restart
  /etc/init.d/dnsmasq reload >/dev/null 2>&1 || true
'
echo "==> Pocket-AP removed cleanly."
