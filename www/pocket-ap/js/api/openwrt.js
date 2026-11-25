// LuCI-Truthful OpenWrt Data Normalization & Write Workflows.
//
// Core invariant:
//   NEVER infer live operational status solely from UCI config.
//   Every radio, interface, uplink, and client merges UCI desired config
//   with live OpenWrt runtime state (`luci-rpc`, `network.interface`, `hostapd`, `iwinfo`, `rc`).

import {
  ubusCall, uciGet, uciSet, uciAdd, uciDelete, uciChanges,
  uciApply, uciApplyRollback
} from './ubus.js';
import { cidrToNetmask, isTruthy } from '../utils/dom.js';

let prevCpuSample = null;

function computeCpuPct(sample) {
  if (!sample || typeof sample.total !== 'number') return null;
  const prev = prevCpuSample;
  prevCpuSample = sample;
  if (!prev || sample.total <= prev.total) return null;
  const pct = ((sample.busy - prev.busy) / (sample.total - prev.total)) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)));
}

function normBand(devCfg, liveRadio) {
  const b = String(devCfg?.band ?? liveRadio?.config?.band ?? '').toLowerCase();
  if (b.includes('6')) return { key: '6', label: '6 GHz', short: '6G' };
  if (b.includes('5')) return { key: '5', label: '5 GHz', short: '5G' };
  if (b.includes('2')) return { key: '24', label: '2.4 GHz', short: '2.4G' };
  const ch = Number(devCfg?.channel ?? liveRadio?.config?.channel ?? 0);
  if (ch >= 36) return { key: '5', label: '5 GHz', short: '5G' };
  if (ch > 0) return { key: '24', label: '2.4 GHz', short: '2.4G' };
  return { key: '?', label: 'Wi-Fi', short: 'Wi-Fi' };
}

function uciEncFromScan(enc) {
  if (!enc?.enabled) return 'none';
  const auth = (Array.isArray(enc.authentication) ? enc.authentication : []).map((a) => String(a).toLowerCase());
  const sae = auth.includes('sae');
  const psk = auth.includes('psk');
  if (sae && psk) return 'sae-mixed';
  if (sae) return 'sae';
  return 'psk2';
}

export function validateWifiKey(encryption, key) {
  if (!encryption || encryption === 'none') return '';
  if (!key || key.length < 8) return 'Wi-Fi passphrase must be at least 8 characters.';
  if (key.length > 63) return 'Wi-Fi passphrase must be at most 63 characters.';
  return '';
}

function validIpv4(ip) {
  const m = String(ip || '').trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  return m.slice(1).every((oct) => Number(oct) >= 0 && Number(oct) <= 255);
}

function validMac(mac) {
  return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(String(mac || '').trim());
}

// ---- Snapshot Fetch (Dual-Source Truth) ------------------------------------

export async function fetchSnapshot() {
  const [
    board,
    sysinfo,
    telemetry,
    liveWireless,
    uciWirelessRaw,
    ifaceDump,
    netDevs,
    dhcpLeasesRaw,
    hostHints,
    uciDhcpRaw,
    uciNetRaw,
    uciFwRaw,
    uciSysRaw,
    rcServices,
    uciChangesRaw,
    adblockCustom,
    usbRaw,
    wifiProfilesRaw
  ] = await Promise.all([
    ubusCall('system', 'board').catch(() => ({})),
    ubusCall('system', 'info').catch(() => ({})),
    ubusCall('pocket-ap', 'telemetry').catch(() => null),
    // OpenWrt 25.12: ALWAYS prefer luci-rpc.getWirelessDevices over network.wireless.status!
    ubusCall('luci-rpc', 'getWirelessDevices').catch(() => ({})),
    uciGet('wireless').catch(() => ({ values: {} })),
    ubusCall('network.interface', 'dump').catch(() => ({ interface: [] })),
    ubusCall('luci-rpc', 'getNetworkDevices').catch(() => ({})),
    ubusCall('luci-rpc', 'getDHCPLeases').catch(() => ({ dhcp_leases: [], dhcp6_leases: [] })),
    ubusCall('luci-rpc', 'getHostHints').catch(() => ({})),
    uciGet('dhcp').catch(() => ({ values: {} })),
    uciGet('network').catch(() => ({ values: {} })),
    uciGet('firewall').catch(() => ({ values: {} })),
    uciGet('system').catch(() => ({ values: {} })),
    ubusCall('rc', 'list').catch(() => ({})),
    uciChanges().catch(() => ({ changes: {} })),
    ubusCall('pocket-ap', 'adblock_get').catch(() => null),
    ubusCall('luci', 'getUSBDevices').catch(() => ({ devices: [] })),
    ubusCall('pocket-ap', 'wifi_profiles_get').catch(() => ({ profiles: [] }))
  ]);

  const uciWireless = uciWirelessRaw?.values ?? {};
  const uciDhcp = uciDhcpRaw?.values ?? {};
  const uciNet = uciNetRaw?.values ?? {};
  const uciFw = uciFwRaw?.values ?? {};
  const uciSys = uciSysRaw?.values ?? {};
  const ifaces = ifaceDump?.interface ?? [];

  // ---- 1. Radios, APs & STA (Merged UCI + Live Runtime) --------------------
  const uciDevices = [];
  const uciWifiIfaces = [];
  for (const [secName, sec] of Object.entries(uciWireless)) {
    if (!sec || typeof sec !== 'object') continue;
    if (sec['.type'] === 'wifi-device') uciDevices.push({ id: secName, ...sec });
    else if (sec['.type'] === 'wifi-iface') uciWifiIfaces.push({ id: secName, ...sec });
  }

  // Collect live AP ifnames so we can query associated clients via hostapd / iwinfo
  const liveApIfaces = [];
  const radios = uciDevices.map((dev) => {
    const live = liveWireless?.[dev.id] ?? {};
    const band = normBand(dev, live);
    const apCfg =
      uciWifiIfaces.find((i) => i.device === dev.id && (!i.mode || i.mode === 'ap')) ||
      uciWifiIfaces.find((i) => i.device === dev.id && i.mode !== 'sta') ||
      null;

    const liveIfaces = Array.isArray(live.interfaces) ? live.interfaces : [];
    const liveAp = liveIfaces.find((i) => (i?.config?.mode || 'ap') === 'ap' && (!apCfg || i.section === apCfg.id)) ||
                   liveIfaces.find((i) => (i?.config?.mode || 'ap') === 'ap') ||
                   null;

    const radioDisabled = isTruthy(dev.disabled);
    const ifaceDisabled = apCfg ? isTruthy(apCfg.disabled) : true;
    // CRITICAL LuCI-truthfulness rule: AP is only config-enabled if BOTH radio AND wifi-iface are enabled!
    const configEnabled = !radioDisabled && !ifaceDisabled && !!apCfg;
    const runtimeUp = !!live.up && !!liveAp && !!liveAp.ifname && !live.pending;
    const inSync = configEnabled === runtimeUp;

    if (liveAp?.ifname) {
      liveApIfaces.push({ ifname: liveAp.ifname, band: band.label, radioId: dev.id });
    }

    return {
      id: dev.id,
      band: band.key,
      bandLabel: band.label,
      bandShort: band.short,
      channel: String(dev.channel ?? 'auto'),
      liveChannel: liveAp?.iwinfo?.channel ?? live.config?.channel ?? dev.channel ?? '—',
      htmode: String(dev.htmode ?? live.config?.htmode ?? ''),
      country: String(dev.country ?? live.iwinfo?.country ?? ''),
      txpower: String(dev.txpower ?? ''),
      liveTxpower: live.iwinfo?.txpower ?? null,
      radioDisabled,
      ifaceDisabled,
      configEnabled,
      runtimeUp,
      pending: !!live.pending,
      inSync,
      activeIfname: liveAp?.ifname || '',
      bssid: liveAp?.iwinfo?.bssid || '',
      ifaceId: apCfg?.id || '',
      ssid: apCfg?.ssid ?? '',
      liveSsid: liveAp?.iwinfo?.ssid || liveAp?.config?.ssid || '',
      encryption: apCfg?.encryption ?? 'none',
      key: apCfg?.key ?? '',
      network: apCfg?.network ?? 'lan',
      hidden: isTruthy(apCfg?.hidden),
      isolate: isTruthy(apCfg?.isolate),
      wmm: apCfg?.wmm === undefined ? true : isTruthy(apCfg.wmm),
      roaming: isTruthy(apCfg?.ieee80211r),
      clientCount: 0
    };
  });

  // Query associated Wi-Fi stations across active AP interfaces
  const wifiClientMap = {}; // lowercase mac -> { band, signal, ifname, radioId }
  await Promise.all(liveApIfaces.map(async ({ ifname, band, radioId }) => {
    let found = false;
    try {
      const h = await ubusCall(`hostapd.${ifname}`, 'get_clients');
      if (h && typeof h.clients === 'object') {
        found = true;
        let count = 0;
        for (const [mac, info] of Object.entries(h.clients)) {
          count++;
          wifiClientMap[mac.toLowerCase()] = {
            band,
            signal: Number(info?.signal ?? 0),
            ifname,
            radioId
          };
        }
        const r = radios.find((x) => x.id === radioId);
        if (r) r.clientCount += count;
      }
    } catch { /* fallback to iwinfo */ }

    if (!found) {
      try {
        const iw = await ubusCall('iwinfo', 'assoclist', { device: ifname });
        const list = iw?.results ?? [];
        const r = radios.find((x) => x.id === radioId);
        if (r) r.clientCount += list.length;
        for (const st of list) {
          if (!st.mac) continue;
          wifiClientMap[st.mac.toLowerCase()] = {
            band,
            signal: Number(st.signal ?? 0),
            ifname,
            radioId
          };
        }
      } catch { /* ignore */ }
    }
  }));

  // Repeater / Wi-Fi Client (STA) status
  const staConfigs = uciWifiIfaces.filter((i) => i.mode === 'sta');
  let liveSta = null;
  for (const [radioId, live] of Object.entries(liveWireless ?? {})) {
    const found = (live?.interfaces ?? []).find((i) => i?.config?.mode === 'sta');
    if (found) {
      liveSta = { radioId, ...found };
      break;
    }
  }
  const primaryStaCfg = staConfigs[0] || null;
  const wwanIface = ifaces.find((i) => i.interface === 'wwan') || null;
  const staStatus = {
    configured: !!primaryStaCfg,
    sectionId: primaryStaCfg?.id || null,
    device: primaryStaCfg?.device || liveSta?.radioId || '',
    ssid: liveSta?.iwinfo?.ssid || primaryStaCfg?.ssid || '',
    bssid: liveSta?.iwinfo?.bssid || '',
    encryption: primaryStaCfg?.encryption || 'none',
    disabled: primaryStaCfg ? isTruthy(primaryStaCfg.disabled) : true,
    associated: !!(liveSta && liveSta.ifname && (liveSta.iwinfo?.bssid || liveSta.iwinfo?.ssid)),
    ifname: liveSta?.ifname || wwanIface?.l3_device || '',
    signal: liveSta?.iwinfo?.signal ?? 0,
    channel: liveSta?.iwinfo?.channel ?? null,
    bitrate: liveSta?.iwinfo?.bitrate ?? 0,
    wwanUp: !!wwanIface?.up,
    ipv4: wwanIface?.['ipv4-address']?.[0]?.address || null,
    netmask: wwanIface?.['ipv4-address']?.[0] ? cidrToNetmask(wwanIface['ipv4-address'][0].mask) : null,
    gateway: (wwanIface?.route ?? []).find((r) => r.target === '0.0.0.0')?.nexthop || null,
    uptime: wwanIface?.uptime || 0
  };

  // ---- 2. Interfaces & Travel Router Uplink Classification -----------------
  const lanIface = ifaces.find((i) => i.interface === 'lan') || null;
  const wanIface = ifaces.find((i) => i.interface === 'wan') || null;

  const tetherIface = ifaces.find((i) =>
    i.up && /^(usb|rndis|ncm|eth[2-9]|tether)/i.test(i.l3_device || i.device || i.interface)
  ) || null;

  const cellularIface = ifaces.find((i) =>
    i.up && (
      ['qmi', 'mbim', 'ncm', '3g', 'modemmanager'].includes(i.proto) ||
      /^(wwan\d|qmimux|rmnet)/i.test(i.l3_device || i.device || '')
    )
  ) || null;

  const ethWanUp = !!(wanIface?.up && wanIface['ipv4-address']?.length);
  const repeaterUp = !!(staStatus.wwanUp && staStatus.ipv4);
  const tetherUp = !!tetherIface;
  const cellularUp = !!cellularIface;

  // Determine primary active WAN (whichever has default route 0.0.0.0)
  const defaultRouteIface =
    ifaces.find((i) => i.up && (i.route ?? []).some((r) => r.target === '0.0.0.0' && r.mask === 0)) ||
    (ethWanUp ? wanIface : repeaterUp ? wwanIface : tetherIface || cellularIface || wanIface);

  const primaryUplinkType =
    defaultRouteIface?.interface === 'wwan' || (repeaterUp && !ethWanUp) ? 'repeater' :
    (tetherIface && defaultRouteIface?.interface === tetherIface.interface) ? 'tethering' :
    (cellularIface && defaultRouteIface?.interface === cellularIface.interface) ? 'cellular' :
    ethWanUp ? 'ethernet' : 'none';

  const lanDev = netDevs?.[lanIface?.l3_device || 'br-lan'] || {};
  const wanDev = netDevs?.[defaultRouteIface?.l3_device || defaultRouteIface?.device || 'eth0'] || {};

  // Bridged AP detection: LAN DHCP ignored & LAN proto dhcp or bridge includes eth0
  const dhcpLan = uciDhcp.lan || {};
  const bridgedAp = isTruthy(dhcpLan.ignore) && (uciNet.lan?.proto === 'dhcp' || !ethWanUp);

  // ---- 3. Connected Clients (Leases + Host Hints + Wi-Fi Assoc) ------------
  const leases = dhcpLeasesRaw?.dhcp_leases ?? [];
  const clientByMac = new Map();

  for (const l of leases) {
    const mac = String(l.macaddr || '').toUpperCase();
    if (!mac) continue;
    const wifi = wifiClientMap[mac.toLowerCase()];
    clientByMac.set(mac, {
      mac,
      ip: l.ipaddr || '—',
      hostname: l.hostname || hostHints?.[mac]?.name || 'Unknown device',
      expires: l.expires ?? 0,
      isWifi: !!wifi,
      band: wifi ? wifi.band : 'Wired',
      signal: wifi ? wifi.signal : null,
      ifname: wifi ? wifi.ifname : 'br-lan'
    });
  }
  // Include any associated Wi-Fi stations that haven't taken a DHCP lease (static IP)
  for (const [macLower, wifi] of Object.entries(wifiClientMap)) {
    const mac = macLower.toUpperCase();
    if (clientByMac.has(mac)) continue;
    const hint = hostHints?.[mac] || {};
    clientByMac.set(mac, {
      mac,
      ip: hint.ipaddrs?.[0] || 'Static / Pending',
      hostname: hint.name || 'Wi-Fi Client',
      expires: 0,
      isWifi: true,
      band: wifi.band,
      signal: wifi.signal,
      ifname: wifi.ifname
    });
  }

  const clients = [...clientByMac.values()].sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));

  // Static leases from UCI dhcp
  const staticLeases = Object.entries(uciDhcp)
    .filter(([, s]) => s && s['.type'] === 'host')
    .map(([id, s]) => ({
      id,
      name: s.name || '',
      mac: Array.isArray(s.mac) ? s.mac[0] : (s.mac || ''),
      ip: s.ip || ''
    }));

  const dnsmasqSec = Object.entries(uciDhcp).find(([, s]) => s && s['.type'] === 'dnsmasq');

  // ---- 4. VPN (WireGuard + OpenVPN + Tailscale) ----------------------------
  const wgUciIfaces = Object.entries(uciNet)
    .filter(([, s]) => s && s['.type'] === 'interface' && s.proto === 'wireguard')
    .map(([name, s]) => {
      const liveIf = ifaces.find((i) => i.interface === name);
      const liveWg = telemetry?.wireguard?.interfaces?.[name] || null;
      const peers = Object.entries(uciNet)
        .filter(([, p]) => p && p['.type'] === `wireguard_${name}`)
        .map(([pid, p]) => {
          const livePeer = (liveWg?.peers ?? []).find((lp) => lp.public_key === p.public_key) || null;
          return {
            id: pid,
            description: p.description || '',
            publicKey: p.public_key || '',
            endpoint: p.endpoint_host ? `${p.endpoint_host}:${p.endpoint_port || 51820}` : (livePeer?.endpoint || ''),
            allowedIps: Array.isArray(p.allowed_ips) ? p.allowed_ips.join(', ') : (p.allowed_ips || ''),
            live: livePeer
          };
        });
      return {
        name,
        up: !!liveIf?.up,
        addresses: Array.isArray(s.addresses) ? s.addresses : (s.addresses ? [s.addresses] : []),
        listenPort: s.listen_port || liveWg?.listen_port || '',
        publicKey: liveWg?.public_key || '',
        peers,
        livePeers: liveWg?.peers ?? []
      };
    });

  const wgAnyUp = wgUciIfaces.some((w) => w.up);
  const tsRunning = !!telemetry?.tailscale?.running;
  const ovpnRunning = !!rcServices?.openvpn?.running;
  const vpnActive = wgAnyUp || tsRunning || ovpnRunning;
  const vpnLabel = wgAnyUp ? 'WireGuard' : tsRunning ? 'Tailscale' : ovpnRunning ? 'OpenVPN' : 'VPN';

  // ---- 5. Adblock & Firewall -----------------------------------------------
  const adblockPkgRunning =
    !!rcServices?.adblock?.running ||
    !!rcServices?.['adblock-fast']?.running ||
    !!rcServices?.adguardhome?.running;
  const adblockActive = adblockPkgRunning || !!adblockCustom?.enabled;

  const fwRunning = rcServices?.firewall ? (rcServices.firewall.enabled !== false) : true;
  const fwForwardings = Object.entries(uciFw)
    .filter(([, s]) => s && s['.type'] === 'forwarding')
    .map(([id, s]) => ({ id, ...s }));
  const lanToWanFwd = fwForwardings.find((f) => f.src === 'lan' && f.dest === 'wan');
  const vpnKillSwitch = !!lanToWanFwd && (lanToWanFwd.enabled === '0' || lanToWanFwd.enabled === 0);

  const rebindProtection = dnsmasqSec?.[1]?.rebind_protection !== '0';
  const wanMacaddr = uciNet.wan?.macaddr || '';
  const wwanMacaddr = uciNet.wwan?.macaddr || '';

  // ---- 6. System & Telemetry -----------------------------------------------
  const mem = sysinfo?.memory ?? {};
  const memTotal = Number(mem.total || 0);
  const memAvail = Number(mem.available ?? mem.free ?? 0);
  const memUsedPct = memTotal ? Math.round(((memTotal - memAvail) / memTotal) * 100) : 0;

  const rootFs = sysinfo?.root ?? {};
  const rootTotal = Number(rootFs.total || 0);
  const rootUsed = Number(rootFs.used || 0);
  const rootUsedPct = rootTotal ? Math.round((rootUsed / rootTotal) * 100) : 0;

  const cpuUsedPct = computeCpuPct(telemetry?.cpu);
  const tempC = telemetry?.thermal?.max_c ?? null;
  const loadAvg = Array.isArray(sysinfo?.load)
    ? sysinfo.load.map((v) => (Number(v) / 65536).toFixed(2))
    : ['0.00', '0.00', '0.00'];

  const sysSectionEntry = Object.entries(uciSys).find(([, s]) => s && s['.type'] === 'system');
  const pendingChanges = uciChangesRaw?.changes ?? {};
  const pendingChangeCount = Object.values(pendingChanges).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);

  const anyApRuntimeUp = radios.some((r) => r.runtimeUp);
  const anyApConfigEnabled = radios.some((r) => r.configEnabled);
  const anyApOutOfSync = radios.some((r) => !r.inSync);
  const band5Up = radios.some((r) => r.band === '5' && r.runtimeUp);
  const band24Up = radios.some((r) => r.band === '24' && r.runtimeUp);

  return {
    fetchedAt: Date.now(),
    pluginOnline: !!telemetry,
    pluginVersion: telemetry?.version || null,
    board: {
      model: board?.model || board?.board_name || 'OpenWrt Router',
      boardName: board?.board_name || '',
      hostname: board?.hostname || sysSectionEntry?.[1]?.hostname || 'OpenWrt',
      kernel: board?.kernel || '—',
      target: board?.release?.target || '—',
      firmware: board?.release?.description || [board?.release?.distribution, board?.release?.version].filter(Boolean).join(' ') || 'OpenWrt'
    },
    system: {
      sectionId: sysSectionEntry?.[0] || '@system[0]',
      hostname: sysSectionEntry?.[1]?.hostname || board?.hostname || 'OpenWrt',
      zonename: sysSectionEntry?.[1]?.zonename || 'UTC',
      timezone: sysSectionEntry?.[1]?.timezone || 'GMT0',
      uptimeSec: Number(sysinfo?.uptime || 0),
      loadAvg,
      cpuUsedPct,
      memTotal,
      memAvail,
      memUsedPct,
      rootTotalKb: rootTotal,
      rootUsedKb: rootUsed,
      rootUsedPct,
      tempC
    },
    capabilities: telemetry?.capabilities ?? {
      pkg_manager: 'apk',
      wireguard: wgUciIfaces.length > 0,
      openvpn: !!rcServices?.openvpn,
      tailscale: !!rcServices?.tailscale,
      adblock: !!rcServices?.adblock,
      adblock_fast: !!rcServices?.['adblock-fast'],
      adguardhome: !!rcServices?.adguardhome
    },
    radios,
    hotspotSummary: {
      anyApRuntimeUp,
      anyApConfigEnabled,
      anyApOutOfSync,
      band5Up,
      band24Up,
      bridgedAp,
      primarySsid: radios.find((r) => r.runtimeUp)?.liveSsid || radios.find((r) => r.ssid)?.ssid || 'Disabled'
    },
    sta: staStatus,
    uplinks: {
      primaryType: primaryUplinkType,
      ethernet: { up: ethWanUp, ip: wanIface?.['ipv4-address']?.[0]?.address || null, proto: wanIface?.proto || uciNet.wan?.proto || 'dhcp', device: wanIface?.l3_device || uciNet.wan?.device || 'eth0' },
      repeater: { up: repeaterUp, ssid: staStatus.ssid, ip: staStatus.ipv4, signal: staStatus.signal },
      tethering: { up: tetherUp, ip: tetherIface?.['ipv4-address']?.[0]?.address || null, device: tetherIface?.l3_device || '' },
      cellular: { up: cellularUp, ip: cellularIface?.['ipv4-address']?.[0]?.address || null, device: cellularIface?.l3_device || '' }
    },
    localNet: {
      ip: lanIface?.['ipv4-address']?.[0]?.address || uciNet.lan?.ipaddr?.split('/')[0] || '192.168.1.1',
      mask: lanIface?.['ipv4-address']?.[0] ? cidrToNetmask(lanIface['ipv4-address'][0].mask) : (uciNet.lan?.netmask || '255.255.255.0'),
      prefix: lanIface?.['ipv4-address']?.[0]?.mask ?? 24,
      mac: lanDev?.mac || '—',
      device: lanIface?.l3_device || 'br-lan'
    },
    publicNet: {
      up: !!(defaultRouteIface?.up && defaultRouteIface?.['ipv4-address']?.length),
      iface: defaultRouteIface?.interface || 'wan',
      ip: defaultRouteIface?.['ipv4-address']?.[0]?.address || 'Not connected',
      mask: defaultRouteIface?.['ipv4-address']?.[0] ? cidrToNetmask(defaultRouteIface['ipv4-address'][0].mask) : '—',
      gateway: (defaultRouteIface?.route ?? []).find((r) => r.target === '0.0.0.0')?.nexthop || '—',
      mac: wanDev?.mac || '—',
      dns: defaultRouteIface?.['dns-server'] ?? [],
      ssid: primaryUplinkType === 'repeater' ? staStatus.ssid : '—'
    },
    interfaces: ifaces,
    netDevs: netDevs ?? {},
    uciNet,
    clients,
    dhcp: {
      lanSection: dhcpLan,
      dnsmasqId: dnsmasqSec?.[0] || null,
      dnsmasq: dnsmasqSec?.[1] || {},
      staticLeases
    },
    vpn: {
      active: vpnActive,
      label: vpnLabel,
      killSwitch: vpnKillSwitch,
      wireguard: wgUciIfaces,
      tailscale: telemetry?.tailscale ?? { installed: false },
      openvpnInstalled: !!(telemetry?.capabilities?.openvpn || rcServices?.openvpn),
      openvpnRunning: ovpnRunning
    },
    travel: {
      rebindProtection,
      wanMacaddr,
      wwanMacaddr,
      wifiProfiles: wifiProfilesRaw?.profiles ?? []
    },
    landing: telemetry?.landing ?? { mode: 'luci', luci_url: '/cgi-bin/luci/', pocket_ap_url: '/pocket-ap/' },
    portal: telemetry?.portal ?? { active: false, wwan_up: repeaterUp, online: false, portal_detected: false },
    hwSwitch: telemetry?.hw_switch ?? { supported: false, position: 'unknown', action: 'none', wg_iface: 'wg0', vpn_killswitch: false, invert: false, last: { at: 0, state: '', action: '', result: '' } },
    adblock: {
      active: adblockActive,
      pkgRunning: adblockPkgRunning,
      custom: adblockCustom || { enabled: false, count: 0, domains: [] }
    },
    firewall: {
      active: fwRunning,
      zones: Object.entries(uciFw).filter(([, s]) => s && s['.type'] === 'zone').map(([id, s]) => ({ id, ...s }))
    },
    services: rcServices ?? {},
    usbDevices: usbRaw?.devices ?? [],
    uciChanges: {
      count: pendingChangeCount,
      raw: pendingChanges
    }
  };
}

// ---- Write Workflows -------------------------------------------------------

/**
 * Save Hotspot AP configuration for one radio.
 * Explicitly syncs BOTH `wifi-device.disabled` AND `wifi-iface.disabled`
 * so OpenWrt / LuCI / hostapd always agree!
 */
export async function saveHotspotRadio(radio, form) {
  const keyErr = validateWifiKey(form.encryption, form.key);
  if (keyErr) throw new Error(keyErr);

  const enabled = !!form.enabled;
  const devPatch = {
    disabled: enabled ? '0' : '1',
    channel: form.channel || 'auto',
    htmode: form.htmode || radio.htmode
  };
  if (form.country && form.country.trim()) devPatch.country = form.country.trim().toUpperCase();

  await uciSet('wireless', radio.id, devPatch);
  if (form.txpower && String(form.txpower).trim()) {
    await uciSet('wireless', radio.id, { txpower: String(form.txpower).trim() });
  } else {
    await uciDelete('wireless', radio.id, 'txpower').catch(() => {});
  }

  const ifaceValues = {
    device: radio.id,
    mode: 'ap',
    network: radio.network || 'lan',
    disabled: enabled ? '0' : '1',
    ssid: form.ssid.trim() || 'Pocket-AP',
    encryption: form.encryption || 'sae-mixed',
    key: form.encryption === 'none' ? '' : form.key,
    hidden: form.hidden ? '1' : '0',
    isolate: form.isolate ? '1' : '0',
    wmm: form.wmm ? '1' : '0',
    ieee80211r: form.roaming ? '1' : '0'
  };

  if (radio.ifaceId) {
    await uciSet('wireless', radio.ifaceId, ifaceValues);
  } else {
    await uciAdd('wireless', 'wifi-iface', `default_${radio.id}`, ifaceValues);
  }

  await uciApplyRollback(95);
}

export async function toggleRadioPower(radio, enable) {
  await uciSet('wireless', radio.id, { disabled: enable ? '0' : '1' });
  if (radio.ifaceId) {
    await uciSet('wireless', radio.ifaceId, { disabled: enable ? '0' : '1' });
  }
  await uciApplyRollback(95);
}

/**
 * Scan nearby Wi-Fi networks across all radios using `iwinfo.scan`.
 */
export async function scanWifiNetworks(radios) {
  const results = new Map();
  let scannedCount = 0;
  let lastErr = null;

  for (const r of radios) {
    const targets = [r.activeIfname, r.id].filter(Boolean);
    let ok = false;
    for (const dev of targets) {
      try {
        const res = await ubusCall('iwinfo', 'scan', { device: dev });
        scannedCount++;
        ok = true;
        for (const item of res?.results ?? []) {
          const ssid = item.ssid || '';
          if (!ssid) continue;
          const entry = {
            ssid,
            bssid: item.bssid || '',
            channel: item.channel ?? '?',
            signal: Number(item.signal ?? -90),
            locked: !!item?.encryption?.enabled,
            encryption: uciEncFromScan(item.encryption),
            encDesc: item?.encryption?.description || (item?.encryption?.enabled ? 'WPA/WPA2' : 'Open'),
            radioId: r.id,
            bandLabel: r.bandLabel
          };
          const key = `${ssid}__${r.id}`;
          const prev = results.get(key);
          if (!prev || entry.signal > prev.signal) results.set(key, entry);
        }
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!ok && !lastErr) lastErr = new Error(`Could not scan ${r.id}`);
  }

  if (scannedCount === 0) {
    throw lastErr || new Error('No Wi-Fi radio responded to iwinfo.scan. Ensure rpcd-mod-iwinfo is installed and at least one radio is up.');
  }

  return [...results.values()].sort((a, b) => b.signal - a.signal);
}

/**
 * Join an upstream Wi-Fi network as a routed travel repeater (`wwan` DHCP client).
 */
export async function joinWifiRepeater(network, key) {
  if (network.locked) {
    const err = validateWifiKey(network.encryption, key);
    if (err) throw new Error(err);
  }

  const netUci = (await uciGet('network'))?.values ?? {};
  if (!netUci.wwan) {
    await uciAdd('network', 'interface', 'wwan', { proto: 'dhcp' });
  } else {
    await uciSet('network', 'wwan', { proto: 'dhcp' });
  }

  // Ensure the radio hosting the STA client is enabled!
  await uciSet('wireless', network.radioId, { disabled: '0' });

  const wUci = (await uciGet('wireless'))?.values ?? {};
  let existingSta = null;
  for (const [id, s] of Object.entries(wUci)) {
    if (s && s['.type'] === 'wifi-iface' && s.mode === 'sta') {
      existingSta = id;
      break;
    }
  }

  const staCfg = {
    device: network.radioId,
    mode: 'sta',
    network: 'wwan',
    disabled: '0',
    ssid: network.ssid,
    encryption: network.locked ? network.encryption : 'none',
    key: network.locked ? key : ''
  };
  if (existingSta) await uciSet('wireless', existingSta, staCfg);
  else await uciAdd('wireless', 'wifi-iface', 'pocket_wwan_sta', staCfg);

  // Wire `wwan` into the masqueraded `wan` firewall zone
  const fwUci = (await uciGet('firewall'))?.values ?? {};
  const wanZone = Object.entries(fwUci).find(([, s]) => s && s['.type'] === 'zone' && s.name === 'wan');
  if (wanZone) {
    const [zoneId, z] = wanZone;
    const nets = Array.isArray(z.network) ? [...z.network] : (z.network ? [z.network] : []);
    if (!nets.includes('wwan')) {
      nets.push('wwan');
      await uciSet('firewall', zoneId, { network: nets });
    }
  }

  await uciApplyRollback(95);
}

export async function disconnectWifiRepeater(sectionId, forget = false) {
  if (!sectionId) return;
  if (forget) {
    await uciDelete('wireless', sectionId);
  } else {
    await uciSet('wireless', sectionId, { disabled: '1' });
  }
  await uciApplyRollback(95);
}

// ---- DHCP & Static Leases --------------------------------------------------

export async function saveDhcpSettings(cfg, dnsmasqId) {
  await uciSet('dhcp', 'lan', {
    ignore: cfg.enabled ? '0' : '1',
    start: String(cfg.start || 100),
    limit: String(cfg.limit || 150),
    leasetime: cfg.leasetime || '12h'
  });

  if (dnsmasqId) {
    const servers = (cfg.dnsServers || '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (servers.length > 0) {
      await uciSet('dhcp', dnsmasqId, { server: servers });
    } else {
      await uciDelete('dhcp', dnsmasqId, 'server').catch(() => {});
    }
  }

  await uciApply();
}

export async function addStaticLease(name, mac, ip) {
  const cleanMac = String(mac || '').trim().toUpperCase();
  const cleanIp = String(ip || '').trim();
  if (!validMac(cleanMac)) throw new Error('MAC address must be in XX:XX:XX:XX:XX:XX format.');
  if (!validIpv4(cleanIp)) throw new Error('IPv4 address must be a valid dotted-quad address.');
  await uciAdd('dhcp', 'host', undefined, {
    name: String(name || '').trim(),
    mac: cleanMac,
    ip: cleanIp
  });
  await uciApply();
}

export async function deleteStaticLease(sectionId) {
  await uciDelete('dhcp', sectionId);
  await uciApply();
}

// ---- Networking (WAN / LAN / Bridged AP) -----------------------------------

export async function saveWanConfig(cfg) {
  const vals = {
    proto: cfg.proto || 'dhcp',
    peerdns: cfg.peerdns ? '1' : '0'
  };
  if (cfg.proto === 'static') {
    const ip = cfg.ipaddr.trim();
    const mask = cfg.netmask.trim() || '255.255.255.0';
    const gw = cfg.gateway.trim();
    if (!validIpv4(ip)) throw new Error('Static WAN IPv4 address is invalid.');
    if (!validIpv4(mask)) throw new Error('Static WAN netmask is invalid.');
    if (gw && !validIpv4(gw)) throw new Error('Static WAN gateway IPv4 is invalid.');
    vals.ipaddr = ip;
    vals.netmask = mask;
    vals.gateway = gw;
  } else if (cfg.proto === 'pppoe') {
    vals.username = cfg.username.trim();
    vals.password = cfg.password;
  }
  const dns = !cfg.peerdns ? cfg.dns.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) : [];
  if (dns.length) vals.dns = dns;

  await uciSet('network', 'wan', vals);
  if (!dns.length) await uciDelete('network', 'wan', 'dns').catch(() => {});
  await uciApplyRollback(95);
}

export async function saveLanConfig(cfg) {
  const ip = String(cfg.ipaddr || '').trim().split('/')[0];
  const mask = String(cfg.netmask || '').trim() || '255.255.255.0';
  if (!validIpv4(ip)) throw new Error('LAN IPv4 address is invalid (e.g. 192.168.8.1).');
  if (!validIpv4(mask)) throw new Error('LAN netmask is invalid (e.g. 255.255.255.0).');
  await uciSet('network', 'lan', {
    proto: 'static',
    ipaddr: ip,
    netmask: mask
  });
  await uciApplyRollback(95);
}

// ---- WireGuard .conf Importer ----------------------------------------------

export function parseWireguardConf(text) {
  const out = { iface: {}, peers: [] };
  let cur = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    if (/^\[Interface\]$/i.test(line)) { cur = out.iface; continue; }
    if (/^\[Peer\]$/i.test(line)) { cur = {}; out.peers.push(cur); continue; }
    const idx = line.indexOf('=');
    if (idx < 0 || !cur) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    cur[k] = v;
  }
  return out;
}

export async function importWireguardProfile(ifName, confText) {
  const name = ifName.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 15) || 'wg0';
  const parsed = parseWireguardConf(confText);
  if (!parsed.iface.privatekey) throw new Error('WireGuard config is missing PrivateKey under [Interface].');

  const addresses = (parsed.iface.address || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!addresses.length) throw new Error('WireGuard config is missing Address under [Interface].');

  const ifaceVals = {
    proto: 'wireguard',
    private_key: parsed.iface.privatekey,
    addresses
  };
  if (parsed.iface.listenport) ifaceVals.listen_port = parsed.iface.listenport;
  if (parsed.iface.mtu) ifaceVals.mtu = parsed.iface.mtu;

  const netUci = (await uciGet('network'))?.values ?? {};
  if (netUci[name]) await uciSet('network', name, ifaceVals);
  else await uciAdd('network', 'interface', name, ifaceVals);

  // Remove old peers for this interface before adding imported peers
  for (const [secId, sec] of Object.entries(netUci)) {
    if (sec && sec['.type'] === `wireguard_${name}`) {
      await uciDelete('network', secId).catch(() => {});
    }
  }

  for (const p of parsed.peers) {
    if (!p.publickey) continue;
    const peerVals = {
      public_key: p.publickey,
      allowed_ips: (p.allowedips || '0.0.0.0/0').split(',').map((s) => s.trim()).filter(Boolean),
      route_allowed_ips: '1',
      persistent_keepalive: p.persistentkeepalive || '25'
    };
    if (p.presharedkey) peerVals.preshared_key = p.presharedkey;
    if (p.endpoint) {
      const m = p.endpoint.match(/^\[?([^\]]+)\]?:(\d+)$/);
      if (m) { peerVals.endpoint_host = m[1]; peerVals.endpoint_port = m[2]; }
    }
    await uciAdd('network', `wireguard_${name}`, undefined, peerVals);
  }

  // Add WG interface to WAN firewall zone so LAN traffic NATs through VPN tunnel
  const fwUci = (await uciGet('firewall'))?.values ?? {};
  const wanZone = Object.entries(fwUci).find(([, s]) => s && s['.type'] === 'zone' && s.name === 'wan');
  if (wanZone) {
    const [zoneId, z] = wanZone;
    const nets = Array.isArray(z.network) ? [...z.network] : (z.network ? [z.network] : []);
    if (!nets.includes(name)) {
      nets.push(name);
      await uciSet('firewall', zoneId, { network: nets });
    }
  }

  await uciApplyRollback(95);
}

export async function deleteWireguardInterface(name) {
  const netUci = (await uciGet('network'))?.values ?? {};
  for (const [secId, sec] of Object.entries(netUci)) {
    if (sec && sec['.type'] === `wireguard_${name}`) {
      await uciDelete('network', secId).catch(() => {});
    }
  }
  await uciDelete('network', name);
  await uciApply();
}

// ---- Adblock, Diagnostics, Realtime Stats & System -------------------------

export function saveAdblock(enabled, domains) {
  return ubusCall('pocket-ap', 'adblock_set', { enabled: !!enabled, domains });
}

export function runDiagnostic(action, target = '1.1.1.1') {
  return ubusCall('pocket-ap', 'diag', { action, target });
}

export function getRealtimeStats(mode = 'interface', device = 'br-lan') {
  return ubusCall('luci', 'getRealtimeStats', { mode, device });
}

export async function saveSystemSettings(sectionId, cfg) {
  await uciSet('system', sectionId, {
    hostname: cfg.hostname.trim() || 'OpenWrt',
    zonename: cfg.zonename.trim() || 'UTC',
    timezone: cfg.timezone.trim() || 'GMT0'
  });
  await uciApply();
}

export function changeRootPassword(password) {
  return ubusCall('luci', 'setPassword', { username: 'root', password });
}

export function controlService(name, action) {
  return ubusCall('luci', 'setInitAction', { name, action });
}

export async function readSystemLog(lines = 80) {
  const res = await ubusCall('log', 'read', { lines, oneshot: true }).catch(() => null);
  return res?.log ?? [];
}

export function rebootRouter() {
  return ubusCall('system', 'reboot', {});
}

// ---- Travel Router Enhancements (Saved Wi-Fi, Captive Portal, MAC Clone, Bridged AP, Kill-Switch, LuCI Landing) ---

export function saveWifiProfiles(profiles) {
  return ubusCall('pocket-ap', 'wifi_profiles_save', { profiles });
}

export function setLandingMode(mode) {
  return ubusCall('pocket-ap', 'landing_set', { mode });
}

export function startPortalMode(timeout = 600) {
  return ubusCall('pocket-ap', 'portal_start', { timeout });
}

export function stopPortalMode() {
  return ubusCall('pocket-ap', 'portal_stop', {});
}

export function probePortalMode() {
  return ubusCall('pocket-ap', 'portal_probe', {});
}

export function saveSwitchConfig(cfg) {
  return ubusCall('pocket-ap', 'switch_set', {
    action: cfg.action || 'none',
    wg_iface: cfg.wg_iface || 'wg0',
    vpn_killswitch: !!cfg.vpn_killswitch,
    invert: !!cfg.invert
  });
}

export async function setDnsRebindProtection(dnsmasqId, enabled) {
  if (!dnsmasqId) throw new Error('dnsmasq UCI section not found');
  await uciSet('dhcp', dnsmasqId, { rebind_protection: enabled ? '1' : '0' });
  await uciApply();
}

export async function cloneMacAddress(ifaceName, mac) {
  const clean = String(mac || '').trim().toUpperCase();
  if (clean && !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(clean)) {
    throw new Error('MAC address must be in XX:XX:XX:XX:XX:XX format.');
  }
  const target = ifaceName === 'wwan' ? 'wwan' : 'wan';
  const netUci = (await uciGet('network'))?.values ?? {};
  if (!netUci[target]) {
    await uciAdd('network', 'interface', target, { proto: 'dhcp' });
  }
  if (clean) {
    await uciSet('network', target, { macaddr: clean });
  } else {
    await uciDelete('network', target, 'macaddr').catch(() => {});
  }
  await uciApplyRollback(95);
}

export async function mirrorDualBandHotspot(sourceRadio, allRadios) {
  for (const r of allRadios) {
    if (r.id === sourceRadio.id) continue;
    await uciSet('wireless', r.id, { disabled: sourceRadio.configEnabled ? '0' : '1' });
    const vals = {
      device: r.id,
      mode: 'ap',
      network: sourceRadio.network || 'lan',
      disabled: sourceRadio.configEnabled ? '0' : '1',
      ssid: sourceRadio.ssid,
      encryption: sourceRadio.encryption,
      key: sourceRadio.encryption === 'none' ? '' : sourceRadio.key,
      hidden: sourceRadio.hidden ? '1' : '0',
      isolate: sourceRadio.isolate ? '1' : '0'
    };
    if (r.ifaceId) await uciSet('wireless', r.ifaceId, vals);
    else await uciAdd('wireless', 'wifi-iface', `default_${r.id}`, vals);
  }
  await uciApplyRollback(95);
}

export async function setBridgedApMode(enable) {
  // Bridged AP: disable LAN DHCP server so upstream router assigns IPs;
  // Routed AP: re-enable LAN DHCP server.
  await uciSet('dhcp', 'lan', { ignore: enable ? '1' : '0' });
  await uciSet('network', 'lan', { proto: enable ? 'dhcp' : 'static' });
  await uciApplyRollback(95);
}

export async function setVpnKillSwitch(enable, wgIfaceName) {
  const fwUci = (await uciGet('firewall'))?.values ?? {};
  const fwZones = Object.entries(fwUci).filter(([, s]) => s && s['.type'] === 'zone');
  const fwFwds = Object.entries(fwUci).filter(([, s]) => s && s['.type'] === 'forwarding');
  const lanToWan = fwFwds.find(([, f]) => f.src === 'lan' && f.dest === 'wan');

  if (enable) {
    if (!wgIfaceName) throw new Error('Configure a WireGuard interface before enabling the VPN Kill-Switch.');
    // Remove WG interface from `wan` zone if present so firewall4 has unambiguous zone membership
    const wanZone = fwZones.find(([, z]) => z.name === 'wan');
    if (wanZone) {
      const [wzid, wz] = wanZone;
      const wnets = Array.isArray(wz.network) ? wz.network : (wz.network ? [wz.network] : []);
      if (wnets.includes(wgIfaceName)) {
        await uciSet('firewall', wzid, { network: wnets.filter((n) => n !== wgIfaceName) });
      }
    }
    // Ensure dedicated `vpn` firewall zone exists for WireGuard
    let vpnZone = fwZones.find(([, z]) => z.name === 'vpn');
    if (!vpnZone) {
      await uciAdd('firewall', 'zone', undefined, {
        name: 'vpn',
        network: [wgIfaceName],
        input: 'REJECT',
        output: 'ACCEPT',
        forward: 'REJECT',
        masq: '1',
        mtu_fix: '1'
      });
    } else {
      const [zid, z] = vpnZone;
      const nets = Array.isArray(z.network) ? [...z.network] : (z.network ? [z.network] : []);
      if (!nets.includes(wgIfaceName)) {
        nets.push(wgIfaceName);
        await uciSet('firewall', zid, { network: nets });
      }
    }
    const lanToVpn = fwFwds.find(([, f]) => f.src === 'lan' && f.dest === 'vpn');
    if (!lanToVpn) {
      await uciAdd('firewall', 'forwarding', undefined, { src: 'lan', dest: 'vpn' });
    }
    if (lanToWan) {
      await uciSet('firewall', lanToWan[0], { enabled: '0' });
    }
  } else {
    if (lanToWan) {
      await uciSet('firewall', lanToWan[0], { enabled: '1' });
    }
  }
  await uciApplyRollback(95);
}
