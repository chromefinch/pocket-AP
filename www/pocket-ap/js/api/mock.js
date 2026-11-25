// Realistic offline/demo ubus mock matching GL.iNet GL-MT3000 on OpenWrt 25.12.6.
// Activated via `?mock=1` in URL or when served by `scripts/dev_server.py --mock`.

const state = {
  hostname: 'AX3000-Demo',
  landingMode: 'pocket-ap',
  wifiProfiles: [
    { ssid: 'GrandHotel_Guest', radioId: 'radio1', bandLabel: '5 GHz', encryption: 'psk2', key: 'guest2026', locked: true, bssid: 'AA:BB:CC:11:22:33', savedAt: 1795600000 },
    { ssid: 'CafeEspresso_5G', radioId: 'radio1', bandLabel: '5 GHz', encryption: 'sae-mixed', key: 'latte1234', locked: true, bssid: 'AA:BB:CC:77:88:99', savedAt: 1795500000 }
  ],
  adblockEnabled: true,
  adblockDomains: ['doubleclick.net', 'googlesyndication.com', 'ads.facebook.com', 'telemetry.example.com'],
  wireless: {
    radio0: { '.type': 'wifi-device', '.name': 'radio0', type: 'mac80211', band: '2g', channel: '6', htmode: 'HE20', country: 'US', disabled: '0' },
    default_radio0: { '.type': 'wifi-iface', '.name': 'default_radio0', device: 'radio0', network: 'lan', mode: 'ap', ssid: 'Pocket-AP-2.4G', encryption: 'sae-mixed', key: 'travelrouter123', disabled: '0', hidden: '0', isolate: '0', wmm: '1' },
    radio1: { '.type': 'wifi-device', '.name': 'radio1', type: 'mac80211', band: '5g', channel: '36', htmode: 'HE80', country: 'US', disabled: '0' },
    default_radio1: { '.type': 'wifi-iface', '.name': 'default_radio1', device: 'radio1', network: 'lan', mode: 'ap', ssid: 'Pocket-AP-5G', encryption: 'sae-mixed', key: 'travelrouter123', disabled: '0', hidden: '0', isolate: '0', wmm: '1' },
    wifinet_sta: { '.type': 'wifi-iface', '.name': 'wifinet_sta', device: 'radio1', network: 'wwan', mode: 'sta', ssid: 'GrandHotel_Guest', encryption: 'psk2', key: 'guest2026', disabled: '0' }
  },
  network: {
    loopback: { '.type': 'interface', '.name': 'loopback', device: 'lo', proto: 'static', ipaddr: '127.0.0.1/8' },
    lan: { '.type': 'interface', '.name': 'lan', device: 'br-lan', proto: 'static', ipaddr: '192.168.8.1', netmask: '255.255.255.0' },
    wan: { '.type': 'interface', '.name': 'wan', device: 'eth0', proto: 'dhcp' },
    wwan: { '.type': 'interface', '.name': 'wwan', proto: 'dhcp' },
    wg0: { '.type': 'interface', '.name': 'wg0', proto: 'wireguard', private_key: 'MOCK_PRIVATE_KEY', addresses: ['10.66.66.2/32'] }
  },
  dhcp: {
    cfg01411c: { '.type': 'dnsmasq', '.name': 'cfg01411c', domain: 'lan', local: '/lan/', rebind_protection: '1', server: ['1.1.1.1', '9.9.9.9'] },
    lan: { '.type': 'dhcp', '.name': 'lan', interface: 'lan', start: '100', limit: '150', leasetime: '12h', ignore: '0' },
    host_laptop: { '.type': 'host', '.name': 'host_laptop', name: 'Work-Laptop', mac: '00:24:27:15:5D:28', ip: '192.168.8.120' }
  },
  firewall: {
    cfg01e63d: { '.type': 'defaults', '.name': 'cfg01e63d', input: 'REJECT', output: 'ACCEPT', forward: 'REJECT' },
    cfg02dc81: { '.type': 'zone', '.name': 'cfg02dc81', name: 'lan', network: ['lan'], input: 'ACCEPT', output: 'ACCEPT', forward: 'ACCEPT' },
    cfg03dc81: { '.type': 'zone', '.name': 'cfg03dc81', name: 'wan', network: ['wan', 'wan6', 'wwan'], input: 'REJECT', output: 'ACCEPT', forward: 'DROP', masq: '1', mtu_fix: '1' }
  },
  system: {
    cfg01e48a: { '.type': 'system', '.name': 'cfg01e48a', hostname: 'AX3000-Demo', zonename: 'America/New_York', timezone: 'EST5EDT,M3.2.0,M11.1.0' }
  },
  services: {
    dnsmasq: { start: 19, enabled: true, running: true },
    firewall: { start: 19, enabled: true, running: true },
    uhttpd: { start: 50, enabled: true, running: true },
    dropbear: { start: 19, enabled: true, running: true },
    network: { start: 20, enabled: true, running: true }
  },
  rxCounter: 148200000,
  txCounter: 42600000
};

let tick = 0;

function isOff(v) {
  return v === '1' || v === 1 || v === true;
}

export function mockUbusCall(object, method, params = {}) {
  tick++;
  if (object === 'session') {
    if (method === 'login') {
      return {
        ubus_rpc_session: 'mock0000000000000000000000000001',
        timeout: 3600,
        expires: 3600,
        acls: { 'access-group': { 'pocket-ap': ['read', 'write'] } },
        data: { username: params.username || 'root' }
      };
    }
    if (method === 'access') return { access: true };
    if (method === 'get') return { values: { username: 'root' } };
    if (method === 'destroy') return {};
  }

  if (object === 'system' && method === 'board') {
    return {
      kernel: '6.12.112',
      hostname: state.system.cfg01e48a.hostname,
      system: 'ARMv8 Processor rev 4',
      model: 'GL.iNet GL-MT3000 (Mock)',
      board_name: 'glinet,gl-mt3000',
      rootfs_type: 'squashfs',
      release: {
        distribution: 'OpenWrt',
        version: '25.12.6',
        revision: 'r33311-mock',
        target: 'mediatek/filogic',
        description: 'OpenWrt 25.12.6 (Demo Mode)'
      }
    };
  }

  if (object === 'system' && method === 'info') {
    return {
      localtime: Math.floor(Date.now() / 1000),
      uptime: 18420 + tick * 5,
      load: [11800, 9400, 7200],
      memory: { total: 508645376, free: 356000000, available: 382000000, cached: 28000000, shared: 300000, buffered: 0 },
      root: { total: 209876, free: 198120, used: 11756, avail: 194000 },
      tmp: { total: 248360, free: 245000, used: 3360, avail: 245000 }
    };
  }

  if (object === 'pocket-ap') {
    if (method === 'telemetry') {
      return {
        version: '0.1.0',
        cpu: { busy: 12000 + tick * 42, total: 100000 + tick * 300 },
        thermal: { max_c: 48.2 + (tick % 4) * 0.4, zones: [{ name: 'cpu_thermal', temp_c: 48.2 }] },
        capabilities: {
          pkg_manager: 'apk',
          wireguard: true,
          openvpn: false,
          tailscale: false,
          adblock: false,
          adblock_fast: false,
          adguardhome: false,
          travelmate: false,
          vnstat: false,
          usb_tether: false,
          ping: true,
          nslookup: true,
          traceroute: true
        },
        wireguard: {
          installed: true,
          interfaces: {
            wg0: {
              public_key: 'p0cketAPDemoPublicKey9876543210abcdef123456=',
              listen_port: 51820,
              peers: [
                {
                  public_key: 'HomeServerPeerKey1234567890abcdef1234567890=',
                  endpoint: '203.0.113.42:51820',
                  allowed_ips: '0.0.0.0/0, ::/0',
                  latest_handshake: Math.floor(Date.now() / 1000) - 38,
                  rx_bytes: 94210000 + tick * 24000,
                  tx_bytes: 18400000 + tick * 6500,
                  keepalive: 25
                }
              ]
            }
          }
        },
        tailscale: { installed: false },
        landing: { mode: state.landingMode, luci_url: '/cgi-bin/luci/', pocket_ap_url: '/pocket-ap/' },
        portal: {
          active: !!state.portalActive,
          remaining_sec: state.portalActive ? 540 : 0,
          wwan_up: true,
          wwan_dns: '10.52.1.196',
          wwan_search: 'guest.hotel.local',
          online: !state.portalActive,
          portal_detected: false,
          portal_url: '',
          probe_at: Math.floor(Date.now() / 1000),
          adblock_paused: !!state.portalActive,
          killswitch_paused: false,
          route_switched: false,
          last_restored_at: 0,
          last_reason: ''
        },
        hw_switch: state.hwSwitch || {
          supported: true,
          raw_position: 'off',
          position: 'off',
          action: 'wifi',
          wg_iface: 'wg0',
          vpn_killswitch: false,
          invert: false,
          last: { at: 0, state: '', action: '', result: '' }
        }
      };
    }
    if (method === 'switch_get') {
      return state.hwSwitch || { supported: true, position: 'off', action: 'wifi', wg_iface: 'wg0', vpn_killswitch: false, invert: false, last: { at: 0, state: '', action: '', result: '' } };
    }
    if (method === 'switch_set') {
      state.hwSwitch = {
        supported: true,
        raw_position: 'off',
        position: params.invert ? 'on' : 'off',
        action: params.action || 'none',
        wg_iface: params.wg_iface || 'wg0',
        vpn_killswitch: !!params.vpn_killswitch,
        invert: !!params.invert,
        last: { at: 0, state: '', action: '', result: '' }
      };
      return state.hwSwitch;
    }
    if (method === 'portal_start') {
      state.portalActive = true;
      return { active: true, remaining_sec: 600, portal_url: 'http://neverssl.com/' };
    }
    if (method === 'portal_stop') {
      state.portalActive = false;
      return { active: false, last_reason: 'manual' };
    }
    if (method === 'portal_probe') {
      return { active: !!state.portalActive, online: !state.portalActive, portal_detected: false };
    }
    if (method === 'wifi_profiles_get') {
      return { profiles: [...state.wifiProfiles] };
    }
    if (method === 'wifi_profiles_save') {
      state.wifiProfiles = Array.isArray(params.profiles) ? [...params.profiles] : [];
      return { ok: true, profiles: [...state.wifiProfiles] };
    }
    if (method === 'landing_get') {
      return { mode: state.landingMode, luci_url: '/cgi-bin/luci/', pocket_ap_url: '/pocket-ap/' };
    }
    if (method === 'landing_set') {
      state.landingMode = params.mode === 'pocket-ap' ? 'pocket-ap' : 'luci';
      return { ok: true, mode: state.landingMode };
    }
    if (method === 'adblock_get') {
      return { enabled: state.adblockEnabled, count: state.adblockDomains.length, domains: [...state.adblockDomains] };
    }
    if (method === 'adblock_set') {
      state.adblockEnabled = !!params.enabled;
      state.adblockDomains = Array.isArray(params.domains) ? params.domains : [];
      return { ok: true, enabled: state.adblockEnabled, count: state.adblockDomains.length, domains: [...state.adblockDomains] };
    }
    if (method === 'diag') {
      if (params.action === 'portal_check') {
        return { action: 'portal_check', ok: true, captive_suspected: false, rc: 0, output: 'success\n' };
      }
      return {
        action: params.action,
        target: params.target,
        ok: true,
        rc: 0,
        output: `PING ${params.target || '1.1.1.1'}: 56 data bytes\n64 bytes from ${params.target || '1.1.1.1'}: seq=0 ttl=57 time=14.2 ms\n64 bytes from ${params.target || '1.1.1.1'}: seq=1 ttl=57 time=13.8 ms\n--- ${params.target || '1.1.1.1'} ping statistics ---\n2 packets transmitted, 2 received, 0% packet loss`
      };
    }
  }

  if (object === 'uci') {
    if (method === 'get') {
      const cfg = state[params.config] || {};
      if (params.section) return { values: cfg[params.section] || {} };
      return { values: JSON.parse(JSON.stringify(cfg)) };
    }
    if (method === 'changes') return { changes: {} };
    if (method === 'set') {
      const cfg = (state[params.config] = state[params.config] || {});
      cfg[params.section] = { ...(cfg[params.section] || {}), ...(params.values || {}) };
      return {};
    }
    if (method === 'add') {
      const cfg = (state[params.config] = state[params.config] || {});
      const sec = params.name || `cfg_${Math.random().toString(36).slice(2, 8)}`;
      cfg[sec] = { '.type': params.type, '.name': sec, ...(params.values || {}) };
      return { section: sec };
    }
    if (method === 'delete') {
      const cfg = state[params.config] || {};
      if (params.option && cfg[params.section]) delete cfg[params.section][params.option];
      else delete cfg[params.section];
      return {};
    }
    if (['commit', 'apply', 'confirm', 'rollback', 'revert'].includes(method)) return {};
  }

  if (object === 'luci-rpc' && method === 'getWirelessDevices') {
    const out = {};
    for (const [k, s] of Object.entries(state.wireless)) {
      if (s['.type'] !== 'wifi-device') continue;
      const ifaces = [];
      for (const [ik, isec] of Object.entries(state.wireless)) {
        if (isec['.type'] === 'wifi-iface' && isec.device === k && !isOff(s.disabled) && !isOff(isec.disabled)) {
          const isSta = isec.mode === 'sta';
          ifaces.push({
            section: ik,
            ifname: isSta ? 'phy1-sta0' : (k === 'radio0' ? 'phy0-ap0' : 'phy1-ap0'),
            config: { ...isec },
            iwinfo: {
              ssid: isec.ssid,
              bssid: isSta ? 'AA:BB:CC:11:22:33' : (k === 'radio0' ? '94:83:C4:58:7E:D1' : '94:83:C4:58:7E:D2'),
              mode: isSta ? 'Client' : 'Master',
              channel: Number(s.channel) || (k === 'radio0' ? 6 : 36),
              signal: isSta ? -58 : -44,
              noise: -92,
              bitrate: isSta ? 866700 : 1201000
            }
          });
        }
      }
      out[k] = {
        up: !isOff(s.disabled),
        pending: false,
        autostart: true,
        disabled: isOff(s.disabled),
        config: { ...s },
        interfaces: ifaces,
        iwinfo: { country: s.country || 'US', phy: k === 'radio0' ? 'phy0' : 'phy1', txpower: 20 }
      };
    }
    return out;
  }

  if (object === 'network.interface' && method === 'dump') {
    const staActive = Object.values(state.wireless).some((s) => s['.type'] === 'wifi-iface' && s.mode === 'sta' && !isOff(s.disabled));
    const list = [
      {
        interface: 'lan',
        up: true,
        proto: 'static',
        device: 'br-lan',
        l3_device: 'br-lan',
        uptime: 18400,
        'ipv4-address': [{ address: state.network.lan.ipaddr || '192.168.8.1', mask: 24 }],
        route: [],
        'dns-server': []
      },
      {
        interface: 'wan',
        up: false,
        proto: 'dhcp',
        device: 'eth0',
        l3_device: 'eth0',
        uptime: 0,
        'ipv4-address': [],
        route: [],
        'dns-server': []
      }
    ];
    if (staActive) {
      list.push({
        interface: 'wwan',
        up: true,
        proto: 'dhcp',
        device: 'phy1-sta0',
        l3_device: 'phy1-sta0',
        uptime: 4120 + tick * 5,
        'ipv4-address': [{ address: '172.24.19.88', mask: 22 }],
        route: [{ target: '0.0.0.0', mask: 0, nexthop: '172.24.16.1' }],
        'dns-server': ['1.1.1.1', '9.9.9.9']
      });
    }
    if (state.network.wg0) {
      list.push({
        interface: 'wg0',
        up: true,
        proto: 'wireguard',
        device: 'wg0',
        l3_device: 'wg0',
        uptime: 4100 + tick * 5,
        'ipv4-address': [{ address: '10.66.66.2', mask: 32 }],
        route: [],
        'dns-server': []
      });
    }
    return { interface: list };
  }

  if (object === 'luci-rpc' && method === 'getNetworkDevices') {
    state.rxCounter += 42000;
    state.txCounter += 11500;
    return {
      'br-lan': { name: 'br-lan', up: true, mac: '94:83:C4:58:7E:D0', wireless: false, stats: { rx_bytes: state.txCounter, tx_bytes: state.rxCounter } },
      eth0: { name: 'eth0', up: false, mac: '94:83:C4:58:7E:CF', wireless: false, stats: { rx_bytes: 0, tx_bytes: 0 } },
      eth1: { name: 'eth1', up: true, mac: '94:83:C4:58:7E:D0', wireless: false, stats: { rx_bytes: 28000000, tx_bytes: 91000000 } },
      'phy1-sta0': { name: 'phy1-sta0', up: true, mac: '94:83:C4:58:7E:D3', wireless: true, stats: { rx_bytes: state.rxCounter, tx_bytes: state.txCounter } },
      'phy1-ap0': { name: 'phy1-ap0', up: true, mac: '94:83:C4:58:7E:D2', wireless: true, stats: { rx_bytes: 18500000, tx_bytes: 79400000 } },
      'phy0-ap0': { name: 'phy0-ap0', up: true, mac: '94:83:C4:58:7E:D1', wireless: true, stats: { rx_bytes: 5200000, tx_bytes: 14800000 } }
    };
  }

  if (object === 'luci-rpc' && method === 'getDHCPLeases') {
    return {
      dhcp_leases: [
        { expires: 38200, hostname: 'XPS-16-9640', macaddr: '00:24:27:15:5D:28', ipaddr: '192.168.8.120' },
        { expires: 41100, hostname: 'Pixel-9-Pro', macaddr: '3C:28:6D:44:AA:10', ipaddr: '192.168.8.144' },
        { expires: 35600, hostname: 'iPad-Air', macaddr: 'F0:18:98:11:BC:22', ipaddr: '192.168.8.163' }
      ],
      dhcp6_leases: []
    };
  }

  if (object === 'luci-rpc' && method === 'getHostHints') {
    return {
      '00:24:27:15:5D:28': { ipaddrs: ['192.168.8.120'], name: 'XPS-16-9640' },
      '3C:28:6D:44:AA:10': { ipaddrs: ['192.168.8.144'], name: 'Pixel-9-Pro' },
      'F0:18:98:11:BC:22': { ipaddrs: ['192.168.8.163'], name: 'iPad-Air' }
    };
  }

  if (object.startsWith('hostapd.') && method === 'get_clients') {
    if (object === 'hostapd.phy1-ap0') {
      return {
        freq: 5180,
        clients: {
          '3c:28:6d:44:aa:10': { signal: -49, authorized: true },
          'f0:18:98:11:bc:22': { signal: -61, authorized: true }
        }
      };
    }
    return { freq: 2437, clients: {} };
  }

  if (object === 'iwinfo' && method === 'scan') {
    return {
      results: [
        { ssid: 'GrandHotel_Guest', bssid: 'AA:BB:CC:11:22:33', channel: 36, signal: -54, encryption: { enabled: true, authentication: ['psk'] } },
        { ssid: 'Airport_Free_WiFi', bssid: 'AA:BB:CC:44:55:66', channel: 6, signal: -62, encryption: { enabled: false } },
        { ssid: 'CafeEspresso_5G', bssid: 'AA:BB:CC:77:88:99', channel: 149, signal: -69, encryption: { enabled: true, authentication: ['sae', 'psk'] } },
        { ssid: 'ConferenceHall', bssid: 'AA:BB:CC:99:00:11', channel: 11, signal: -78, encryption: { enabled: true, authentication: ['psk'] } }
      ]
    };
  }

  if (object === 'rc' && method === 'list') return state.services;
  if (object === 'luci' && method === 'getUSBDevices') return { devices: [] };
  if (object === 'luci' && method === 'getRealtimeStats') {
    const now = Math.floor(Date.now() / 1000);
    const pts = [];
    for (let i = 30; i >= 0; i--) {
      pts.push([now - i * 2, 12000000 + (30 - i) * 350000 + Math.sin(i) * 80000, 0, 3200000 + (30 - i) * 95000]);
    }
    return { result: pts };
  }
  if (object === 'luci' && (method === 'setInitAction' || method === 'setPassword')) return { result: true };
  if (object === 'log' && method === 'read') {
    return {
      log: [
        { time: Date.now() - 12000, priority: 6, msg: 'daemon.info hostapd: phy1-ap0: STA 3c:28:6d:44:aa:10 IEEE 802.11: associated' },
        { time: Date.now() - 8000, priority: 6, msg: 'daemon.info dnsmasq-dhcp[1402]: DHCPACK(br-lan) 192.168.8.144 3c:28:6d:44:aa:10 Pixel-9-Pro' },
        { time: Date.now() - 2000, priority: 6, msg: 'daemon.notice netifd: Interface "wwan" is now up (172.24.19.88)' }
      ]
    };
  }

  return {};
}
