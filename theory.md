# Pocket-AP — Theory & Architecture Guide

> **Audience**: Future engineers and AI agents continuing work on Pocket-AP.
> **Goal**: Bring **RaspAP-webgui's travel-router experience** (fast, mobile-first, hotspot + Wi-Fi repeater + tethering + VPN + adblock + live telemetry) natively to **OpenWrt (23.05 / 24.10 / 25.12+)** while maintaining **100% truthful synchronization with LuCI and OpenWrt runtime state**.

---

## 1. Why Pocket-AP Exists (Core Design Principles)

1. **RaspAP Travel-Router UX, OpenWrt Engine**
   - Stock LuCI is complete and rock-solid, but engineered as a deep configuration tree rather than a pocket/hotel travel-router console.
   - RaspAP nails the travel-router mental model: visual 3-column topology (Upstream WAN/Repeater/Tethering -> Router -> Connected Clients), sidebar status LEDs (AP / RAM / CPU Temp), quick Wi-Fi client scanning & repeater join, hotspot management with QR codes, VPN kill-switch visibility, and DNS ad-blocking.
   - Pocket-AP runs **alongside LuCI** at `/pocket-ap/` without modifying or replacing LuCI at `/`.

2. **LuCI-Truthful Dual-Source State (Fixing the "Untangled" Sync Bug)**
   - A common failure mode in alternative OpenWrt UIs (such as `untangled`) is reporting stale or false status compared to LuCI. On OpenWrt 25.12 (especially GL.iNet GL-MT3000 / MediaTek Filogic), three specific bugs cause UI/LuCI divergence:
     1. **Radio vs Interface `disabled` split**: Fresh OpenWrt sets `wireless.default_radio0.disabled='1'` on the `wifi-iface` while leaving `wireless.radio0` (the `wifi-device`) *without* a `disabled` option. Reading only `wifi-device.disabled` falsely reports the AP as ON when LuCI/hostapd have it OFF; toggling only `wifi-device.disabled` fails to start the AP.
     2. **`network.wireless.status` over HTTP `/ubus` breaks on OpenWrt 25.12**: OpenWrt 25.12 migrated `network.wireless` to ucode with strict argument validation; `uhttpd-mod-ubus` injects `ubus_rpc_session` into every JSON-RPC call, causing `INVALID_ARGUMENT` or `Access denied`. **Always use `luci-rpc.getWirelessDevices` first** (which runs router-side and includes live `interfaces[]` + `iwinfo` metadata).
     3. **Config != Runtime**: UCI describes *desired* configuration, not *live* kernel/daemon state. Pocket-AP **always merges UCI config with live runtime telemetry** (`luci-rpc.getWirelessDevices`, `network.interface.dump`, `luci-rpc.getNetworkDevices`, `luci-rpc.getDHCPLeases`, `hostapd.*`, `rc.list`, `uci.changes`) and explicitly surfaces mismatches (e.g., `Config: Enabled / Runtime: Down` or uncommitted UCI changes).

3. **Zero-Build, Zero-CDN, Offline-First**
   - Travel routers are frequently configured with **no internet access** (e.g., on an airplane or before passing a hotel captive portal).
   - Pocket-AP uses **pure ES2022 Modules + Vanilla JS + Modern CSS + Inline SVG icons**. No Node.js build step, no external fonts, no CDN scripts, <150 KB uncompressed. Any agent can edit files directly and deploy via SSH in ~1 second.

4. **Lockout Prevention via Native UCI Rollback**
   - Connectivity-risky changes (Hotspot AP, Wi-Fi Repeater STA, LAN IP, WAN, Bridged AP, Firewall) stage changes via `uci.set`/`uci.add`/`uci.delete` and apply via `uci.apply({ rollback: true, timeout: 90 })`.
   - The UI opens a countdown confirmation modal calling `uci.confirm`. If the user loses Wi-Fi/LAN connectivity, OpenWrt automatically rolls back to the last working config.

---

## 2. Repository & Code Section Map

```
pocket-ap/
├── theory.md                               # This file: architecture invariants, section goals, roadmap
├── README.md                               # Quick start, deploy commands, feature overview
├── openwrt/                                # Router-side OpenWrt package & rpcd integration
│   ├── Makefile                            # OpenWrt buildroot package definition (PKGARCH:=all)
│   └── files/
│       ├── usr/share/rpcd/acl.d/pocket-ap.json   # Scoped rpcd ACL for ubus/uci/pocket-ap
│       ├── usr/share/rpcd/ucode/pocket-ap        # Native ucode rpcd backend plugin (ubus object: pocket-ap)
│       ├── usr/libexec/pocket-ap-portal          # Captive Portal Login Mode & auto-restore watchdog script
│       ├── usr/libexec/pocket-ap-switch          # GL-MT3000 hardware side toggle switch handler (VPN/Wi-Fi/Reset)
│       ├── etc/rc.button/BTN_0                   # OpenWrt procd button trigger for side toggle switch (gpio-512)
│       ├── etc/hotplug.d/iface/95-pocket-ap-portal # Auto-probe captive portal on wwan ifup
│       └── etc/uci-defaults/90-pocket-ap         # Post-install hook to restart rpcd
├── www/pocket-ap/                          # Static SPA deployed to /www/pocket-ap/ on the router
│   ├── index.html                          # HTML shell, SVG sprite, app mount point
│   ├── styles/
│   │   ├── tokens.css                      # CSS custom properties for Light, Dark, and RaspAP themes
│   │   └── app.css                         # Layout, RaspAP sidebar LEDs, 3-col topology, mobile responsive UI
│   └── js/
│       ├── main.js                         # App bootstrap, auth check, hash router, polling scheduler
│       ├── api/
│       │   ├── ubus.js                     # Low-level JSON-RPC /ubus client, session, UCI staging/rollback
│       │   ├── openwrt.js                  # LuCI-truthful data normalization & write workflows
│       │   └── mock.js                     # Realistic GL-MT3000 OpenWrt 25.12 mock backend for offline dev
│       ├── state/
│       │   └── store.js                    # Reactive pub/sub state store (snapshot, route, theme, toasts, rollback)
│       ├── utils/
│       │   ├── dom.js                      # XSS-safe HTML helpers, formatters (bytes, uptime, dBm, bars)
│       │   ├── devices.js                  # Theme-matched isometric CAD SVGs keyed by OpenWrt board_name (GL-MT3000, generic)
│       │   └── qr.js                       # Zero-dependency Wi-Fi QR code SVG encoder (WIFI:T:WPA;...)
│       ├── components/
│       │   ├── sidebar.js                  # RaspAP-style sidebar with live AP/RAM/Temp status LEDs
│       │   ├── topbar.js                   # Header, uncommitted UCI warning, LuCI shortcut, theme & logout
│       │   ├── login.js                    # OpenWrt rpcd login (supports empty root password on fresh flash)
│       │   ├── rollback-modal.js           # Interactive uci.confirm / uci.rollback countdown modal
│       │   └── toast.js                    # Toast notification manager
│       └── views/
│           ├── dashboard.js                # 3-column travel topology (Uplinks -> Router -> Clients)
│           ├── hotspot.js                  # 2.4G/5G AP config, Start/Stop, Bridged AP, QR codes
│           ├── wifi-client.js              # Travel repeater: iwinfo scan, join wwan STA, captive portal helper
│           ├── dhcp.js                     # Live clients (leases+ARP+Wi-Fi signal), DHCP pool, static leases
│           ├── networking.js               # WAN/LAN/Tethering interfaces + ping/nslookup/traceroute tools
│           ├── vpn.js                      # WireGuard (.conf import/peer mgmt), OpenVPN, Tailscale detection
│           ├── adblock.js                  # Built-in dnsmasq blocklist + adblock/adblock-fast/AGH integration
│           ├── data-usage.js               # Live SVG RX/TX chart (luci.getRealtimeStats) + interface totals
│           ├── system.js                   # Board/CPU/RAM/Temp/Flash, init services, admin, logs, reboot
│           └── luci.js                     # GL.iNet-style LuCI Bridge: quick-jump tiles, embedded iframe, default landing toggle
├── scripts/
│   ├── deploy.sh                           # Deploy www + ucode plugin + ACL to router over SSH
│   ├── uninstall.sh                        # Cleanly remove Pocket-AP from router (LuCI untouched)
│   └── dev_server.py                       # Local HTTP dev server (--proxy http://192.168.1.1 or --mock)
└── tests/
    └── test_router_ubus.py                 # Live integration checks against the router's /ubus + HTTP endpoints
```

---

## 3. Code Section Goals & Contracts

### 3.1 Router-Side Backend (`openwrt/files/usr/share/rpcd/`)
- **Goal**: Fill the small gaps that stock `luci-rpc` does not expose over ubus, while staying tiny, secure, and read-safe.
- **`ucode/pocket-ap`** registers the `pocket-ap` ubus object with methods:
  - `telemetry`: Reads `/sys/class/thermal/thermal_zone*/temp` (CPU °C), `/proc/stat` (raw jiffies for accurate CPU%), `/proc/net/dev` (per-iface byte counters), installed travel-router capability flags (`wireguard`, `openvpn`, `adblock`, `adblock_fast`, `adguardhome`, `tailscale`, `vnstat`, `usb_tether`, `travelmate`), physical switch GPIO state (if present), and active WireGuard peer summary (`wg show all dump` if installed).
  - `diag`: Whitelisted safe diagnostics (`ping`, `nslookup`, `traceroute`, `portal_check` via `uclient-fetch`/`wget` connectivity probe) with strict argument sanitization (no shell interpolation!).
  - `adblock_get` / `adblock_set`: Manages Pocket-AP's lightweight dnsmasq custom blocklist (`/tmp/dnsmasq.*.d/pocket-ap-adblock.conf` + `/etc/pocket-ap/adblock-domains.txt`).
  - `wifi_profiles_get` / `wifi_profiles_save`: Persists Known/Saved upstream travel Wi-Fi profiles in `/etc/pocket-ap/wifi-profiles.json`.
  - `landing_get` / `landing_set`: Safely toggles `/www/index.html` between **Pocket-AP Default** (GL.iNet-style: `http://<router>/` redirects to `/pocket-ap/` while `/cgi-bin/luci/` stays untouched) and **Stock LuCI Default** (restores original `/etc/pocket-ap/index.html.luci-orig`).
- **`acl.d/pocket-ap.json`**: Grants `pocket-ap` full read/write access to `uci`, `luci`, `luci-rpc`, `iwinfo`, `network.*`, `hostapd.*`, `rc`, `log`, `system`, `session`, and `pocket-ap` for authenticated `root` sessions.
- **Graceful Degradation Contract**: Every frontend call to `pocket-ap.*` is wrapped in `.catch()` so Pocket-AP still loads and renders core LuCI-truthful status even if only `/www/pocket-ap/` was deployed without the ucode plugin.

### 3.2 Transport & Normalization Layer (`www/pocket-ap/js/api/`)
- **`ubus.js`**:
  - Speaks OpenWrt's JSON-RPC 2.0 `/ubus` protocol.
  - Manages `sessionStorage` token (`pocket-ap-session`), automatic session-expiry detection (distinguishing expired session vs ACL denial via `session.access`), and a tracked `staged` UCI config set that reverts partial changes on error.
  - Supports **mock mode** (`?mock=1` or when running `dev_server.py --mock`).
- **`openwrt.js`** (The Truth Engine):
  - **Single place** where raw OpenWrt ubus/UCI payloads are normalized into clean UI models. Views must NEVER parse raw UCI quirks themselves.
  - Key invariants enforced here:
    - **Wireless**: Combines `uci.get('wireless')`, `luci-rpc.getWirelessDevices`, and `hostapd.<ifname>.get_clients` / `iwinfo.assoclist`. Computes:
      - `configEnabled`: `!isTruthy(dev.disabled) && !isTruthy(ap.disabled)`
      - `runtimeUp`: `!!liveRadio.up && !!liveApIface && !liveRadio.pending`
      - `inSync`: `configEnabled === runtimeUp`
    - **Uplink Detection (Travel Router Topology)**: Inspects `network.interface.dump` + `luci-rpc.getNetworkDevices` + wireless `sta` interfaces to classify active upstream WAN into:
      1. `ethernet` (`wan` up on wired device like `eth0` with default route)
      2. `repeater` (`wwan` or wireless `sta` interface up with IPv4)
      3. `tethering` (USB netdev like `usb0`, `eth2`, `rndis0`, `ncm0` up with IPv4)
      4. `cellular` (modem protocol `qmi`/`mbim`/`ncm`/`3g`/`modemmanager` or `wwan0` up)
    - **Clients**: Merges `luci-rpc.getDHCPLeases`, `luci-rpc.getHostHints`, and per-AP wireless associated stations (`hostapd.*` / `iwinfo.assoclist`) so every client shows hostname, IP, MAC, lease expiry, connection type (`2.4 GHz` / `5 GHz` / `6 GHz` / `Wired`), and live dBm signal!
    - **Uncommitted UCI Changes**: Calls `uci.changes` so the topbar alerts the user if LuCI or another tool has uncommitted staged changes.

### 3.3 State & Polling (`www/pocket-ap/js/state/store.js`)
- Lightweight pub/sub store holding:
  - `auth`: `{ loggedIn, username, acls }`
  - `snapshot`: Latest normalized live router state (board, sysinfo, telemetry, radios, interfaces, uplinks, clients, dhcp, vpn, adblock, firewall, services, uciChanges, fetchedAt, error)
  - `theme`: `'light' | 'dark' | 'raspap'` (persisted in `localStorage`)
  - `route`: Current hash view (`dashboard`, `hotspot`, `wifi-client`, `dhcp`, `networking`, `vpn`, `adblock`, `data-usage`, `system`)
  - `rollback`: Active rollback confirmation state `{ active, deadline, label }`
- **Smart Polling**: Polls every 5 seconds while the tab is visible (`document.visibilityState === 'visible'`), pauses when backgrounded, and pauses DOM re-renders inside active form inputs unless the user clicks Refresh or saves!

### 3.4 UI Views (`www/pocket-ap/js/views/`)
Each view exports `{ id, title, icon, render(container, state), onUpdate?(container, state), cleanup?() }`:
- `dashboard.js`: RaspAP's 3-column visual topology + Local/WAN IP tab switcher + quick status pills (AP, Bridged, Adblock, VPN, Firewall) + 5G/2.4G band badges + mobile summary bar.
- `hotspot.js`: Dual-band AP cards (Basic: SSID/band/channel/width/enable; Security: WPA3/WPA2/Open + password + QR code; Advanced: Country/TX Power/Hidden/Isolate/802.11r/WMM; Bridged AP mode explanation & toggle).
- `wifi-client.js`: Upstream Wi-Fi repeater workflow — Scan across all radios via `iwinfo.scan`, signal-sorted network list, Join modal (auto-wires `wwan` DHCP interface + `sta` wifi-iface + `wan` firewall zone with rollback), live connected uplink card + Captive Portal detection button + Disconnect/Forget.
- `dhcp.js`: Connected Clients table (searchable, Wi-Fi/Wired badges, live dBm signal bars) + DHCP Server Pool editor + Static Lease add/delete.
- `networking.js`: Interface status cards (WAN/LAN/WWAN/Tethering), Ethernet WAN config (DHCP/Static/PPPoE), LAN IP/subnet config (with rollback!), USB devices list, and interactive Diagnostics (Ping / DNS lookup / Captive Portal check).
- `vpn.js`: Travel VPN hub — WireGuard interface/peer viewer & `.conf` importer, OpenVPN config overview, Tailscale status, plus one-click copyable `apk add` / `opkg install` commands for any missing VPN packages.
- `adblock.js`: Zero-extra-package built-in dnsmasq custom domain blocker (`address=/domain/0.0.0.0` via `pocket-ap` or UCI `dhcp.@dnsmasq[0].address`), plus live detection & control of OpenWrt `adblock` / `adblock-fast` / `AdGuardHome` if installed.
- `data-usage.js`: Real-time SVG RX/TX sparkline/area chart fed by `luci.getRealtimeStats` (selectable interface: WAN, LAN, WWAN, Wi-Fi APs) + cumulative interface RX/TX table.
- `system.js`: Hardware/firmware info, CPU/Memory/Temp/Overlay Flash meters, Init Services start/stop/restart/enable (`rc.list` + `luci.setInitAction`), Hostname/Timezone/Root Password (`luci.setPassword`), System Log viewer (`log.read`), and Reboot / Open LuCI actions.

---

## 4. Target Hardware & Verified Environment

- **Primary Test Device**: GL.iNet GL-MT3000 (Beryl AX) — `mediatek/filogic` (`aarch64_cortex-a53`), 512 MB RAM, ~200 MB free UBI overlay.
- **OS**: OpenWrt `25.12.6` (Linux 6.12, `apk` package manager, `uhttpd` + `rpcd` + `ucode` + `firewall4`/nftables).
- **Access**: `http://192.168.1.1/pocket-ap/` (LuCI remains untouched at `http://192.168.1.1/`).

---

## 5. Development, Deployment & Testing Workflow

```bash
# 1. Deploy to live router (copies /www/pocket-ap, rpcd ucode plugin, ACL, reloads rpcd)
./scripts/deploy.sh 192.168.1.1

# 2. Local dev server proxying /ubus to live router (instant edit-refresh loop!)
python3 scripts/dev_server.py --proxy http://192.168.1.1 --port 8080

# 3. Local dev server in offline mock mode (no router needed)
python3 scripts/dev_server.py --mock --port 8080

# 4. Run live integration tests against the router
python3 tests/test_router_ubus.py http://192.168.1.1
```

---

## 6. Multi-Day / Multi-Agent Roadmap

### Phase 1 — Core Foundation, RaspAP UI Parity & Travel Toolkit (Implemented)
- [x] Architecture & `theory.md`
- [x] Native `ucode` rpcd plugin (`pocket-ap` v0.2.0) + scoped rpcd ACL
- [x] LuCI-truthful `ubus.js` + `openwrt.js` normalization engine (dual UCI + live runtime state, 25.12 `luci-rpc.getWirelessDevices` fix, `wifi-device` + `wifi-iface` disabled sync)
- [x] Authentic RaspAP SB-Admin shell: top navbar with Dark Mode toggle, collapsible sidebar with vertical AP/RAM/Temp LEDs, `#2b8080` teal headers, warm `#faf9f6` canvas, 3 themes (RaspAP Teal / Dark / Crimson)
- [x] Authentic RaspAP 3-column Dashboard with dynamic orthogonal SVG bus lines + custom GL-MT3000 router graphic
- [x] GL.iNet-style **LuCI (Advanced)** bridge (`views/luci.js`): quick-jump tiles, embedded LuCI workspace iframe, and safe Default Landing Page toggle (`Pocket-AP` vs `Stock LuCI` at `/`)
- [x] Travel Toolkit: RaspAP card-grid Wi-Fi scanner + Saved/Known Wi-Fi profiles, Captive Portal redirect probe, DNS Rebind Protection 1-click toggle, WAN/WWAN MAC Address Cloning, Bridged AP mode, Dual-Band SSID mirroring, WireGuard `.conf` import + Firewall Kill-Switch
- [x] Deploy/uninstall scripts, local proxy/mock dev server, live router test suite

- [x] **GL-MT3000 Physical Side Switch Integration**: Maps `BTN_0` (`gpio-512 |mode`) via `/etc/rc.button/BTN_0` + `/usr/libexec/pocket-ap-switch` to toggle Hotspot Wi-Fi, WireGuard VPN (with optional Kill-Switch), OpenVPN, or Factory Reset (with 5-second blinking LED cancel window).
- [x] **Automatic Captive Portal Login Mode**: `/usr/libexec/pocket-ap-portal` + `95-pocket-ap-portal` hotplug hook temporarily relaxes DNS rebind/adblock/kill-switch, pins WWAN DHCP DNS + routes, and auto-restores safeguards when online.

### Phase 2 — Power-User Extensions (Next Agents)
- [ ] **Travelmate Auto-Failover Daemon Integration**: Hook Saved Wi-Fi Profiles into OpenWrt's `travelmate` service for headless auto-reconnect across hotels on boot.
- [ ] **In-Browser WireGuard Keypair Generator**: Generate Curve25519/X25519 keypairs + peer QR codes right in the browser for running Pocket-AP as a WireGuard server.
- [ ] **One-Click Package Installer (`apk` / `opkg`)**: Install `wireguard-tools`, `luci-proto-wireguard`, `adblock-fast`, `kmod-usb-net-rndis`, `tailscale` directly from Pocket-AP UI with live output stream.

### Phase 3 — Packaging & Release
- [ ] Build signed `.apk` (OpenWrt 25.12+) and `.ipk` (OpenWrt 23.05/24.10) packages via `openwrt/Makefile`.
- [ ] End-to-end Playwright/headless browser smoke test suite covering both live router and mock fixtures.
- [ ] Optional plugin API (RaspAP-style extensible sidebar/views).

---

## 7. Golden Rules for Contributing Agents

1. **Never trust UCI alone for live status.** Always read runtime state from `luci-rpc` / `network.interface.dump` / `iwinfo` / `hostapd.*` and reconcile against UCI.
2. **Never break LuCI.** Do not modify `/www/index.html`, `/www/cgi-bin/luci`, or existing `luci-*` ACL files.
3. **Never add a mandatory build toolchain** unless explicitly approved by the user — keeping `www/pocket-ap/` pure ES modules keeps iteration instant and offline-friendly.
4. **Always use rollback (`uciApplyRollback`)** for Hotspot, Wi-Fi Client, LAN, WAN, Bridged AP, and Firewall writes.
5. **Preserve existing form edits during background polling**: views with editable forms must not clobber active user input on the 5-second telemetry tick (update status widgets in place via `onUpdate`, only re-render forms on explicit Refresh/Save).
