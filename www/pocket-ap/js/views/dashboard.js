// Dashboard View — Authentic RaspAP 3-column topology with orthogonal SVG bus connectors and live OpenWrt runtime state.

import { esc, icon, fmtUptime } from '../utils/dom.js';
import { renderDeviceIllustration } from '../utils/devices.js';
import { navigate } from '../state/store.js';

let ipTab = 'local'; // 'local' | 'public'

function renderLeftBusSvg(uplinks) {
  // 4 left rows aligned to .topo-endpoint icon centers -> converge on x=55 -> router at y=174, x=110
  const ys = [
    { key: 'ethernet', y: 28, on: !!uplinks.ethernet.up },
    { key: 'repeater', y: 125, on: !!uplinks.repeater.up },
    { key: 'tethering', y: 223, on: !!uplinks.tethering.up },
    { key: 'cellular', y: 320, on: !!uplinks.cellular.up }
  ];
  const anyOn = ys.some((r) => r.on);

  // Dashed background skeleton (exact RaspAP dashed.svg geometry)
  const baseLines = `
    <line x1="55" y1="28" x2="55" y2="320" stroke="var(--line-inactive)" stroke-width="2.5" stroke-dasharray="6 4"/>
    ${ys.map((r) => `<line x1="0" y1="${r.y}" x2="55" y2="${r.y}" stroke="var(--line-inactive)" stroke-width="2.5" stroke-dasharray="6 4"/>`).join('')}
    <line x1="55" y1="174" x2="110" y2="174" stroke="var(--line-inactive)" stroke-width="2.5" stroke-dasharray="6 4"/>
  `;

  // Solid active overlay for each live upstream link
  const activeLines = ys.filter((r) => r.on).map((r) => `
    <path d="M0 ${r.y} H55 V174 H110" fill="none" stroke="var(--line-active)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
  `).join('');

  return `
    <svg class="topo-bus" viewBox="0 0 110 348" preserveAspectRatio="none" aria-hidden="true">
      ${baseLines}
      ${activeLines}
      ${anyOn ? `<circle cx="107" cy="174" r="4" fill="var(--line-active)"/>` : ''}
    </svg>
  `;
}

function renderRightBusSvg(wifiActive, wiredActive) {
  // Router at x=0, y=174 -> spine x=55 -> top y=87 (wireless), bottom y=261 (wired)
  const anyOn = wifiActive || wiredActive;
  const baseLines = `
    <line x1="0" y1="174" x2="55" y2="174" stroke="var(--line-inactive)" stroke-width="2.5" stroke-dasharray="6 4"/>
    <line x1="55" y1="87" x2="55" y2="261" stroke="var(--line-inactive)" stroke-width="2.5" stroke-dasharray="6 4"/>
    <line x1="55" y1="87" x2="110" y2="87" stroke="var(--line-inactive)" stroke-width="2.5" stroke-dasharray="6 4"/>
    <line x1="55" y1="261" x2="110" y2="261" stroke="var(--line-inactive)" stroke-width="2.5" stroke-dasharray="6 4"/>
  `;
  const activeLines = `
    ${wifiActive ? `<path d="M0 174 H55 V87 H110" fill="none" stroke="var(--line-active)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${wiredActive ? `<path d="M0 174 H55 V261 H110" fill="none" stroke="var(--line-active)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${anyOn ? `<circle cx="3" cy="174" r="4" fill="var(--line-active)"/>` : ''}
  `;
  return `
    <svg class="topo-bus" viewBox="0 0 110 348" preserveAspectRatio="none" aria-hidden="true">
      ${baseLines}
      ${activeLines}
    </svg>
  `;
}

export const dashboardView = {
  id: 'dashboard',
  title: 'Dashboard',

  render(container, state, { refresh }) {
    const snap = state.snapshot;
    if (!snap) {
      container.innerHTML = `<div class="card"><div class="card-body">Loading live router status from OpenWrt…</div></div>`;
      return;
    }

    const wifiClients = snap.clients.filter((c) => c.isWifi);
    const wiredClients = snap.clients.filter((c) => !c.isWifi);
    const hs = snap.hotspotSummary;
    const up = snap.uplinks;

    const ipDetails = ipTab === 'local'
      ? `
        <div>IP Address: <a href="#dhcp" data-go="dhcp">${esc(snap.localNet.ip)}</a></div>
        <div>Netmask: <a href="#dhcp" data-go="dhcp">${esc(snap.localNet.mask)}</a></div>
        <div>MAC Address: <strong>${esc(snap.localNet.mac)}</strong></div>
        <div>SSID: <a href="#hotspot" data-go="hotspot">${esc(hs.primarySsid)}</a></div>
      `
      : `
        <div>Uplink IP: <a href="#networking" data-go="networking">${esc(snap.publicNet.ip)}</a></div>
        <div>Netmask: <strong>${esc(snap.publicNet.mask)}</strong></div>
        <div>Gateway: <strong>${esc(snap.publicNet.gateway)}</strong></div>
        <div>Upstream SSID: <a href="#wifi-client" data-go="wifi-client">${esc(snap.publicNet.ssid)}</a></div>
      `;

    container.innerHTML = `
      ${hs.anyApOutOfSync ? `
        <div class="banner warn">
          ${icon('alert')}
          <div>
            <strong>Hotspot Config vs Live State Mismatch:</strong>
            UCI wireless settings differ from live <code>hostapd</code> state. Open <a href="#hotspot" data-go="hotspot">Hotspot</a> to reconcile.
          </div>
        </div>
      ` : ''}

      <!-- RaspAP Signature Dashboard Card -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">${icon('dashboard')} Dashboard</div>
          <div style="display:flex; gap:8px; align-items:center;">
            <span class="pill ${snap.publicNet.up ? 'good' : 'warn'}">
              ${snap.publicNet.up ? `Online (${esc(up.primaryType)})` : 'No WAN Uplink'}
            </span>
            <button type="button" class="btn btn-sm" id="dash-refresh">${icon('refresh', 'icon-sm')} Refresh</button>
          </div>
        </div>

        <div class="card-body">
          <div class="raspap-topo">
            <!-- LEFT: Upstream Connections -->
            <div class="topo-side">
              <a href="#networking" class="topo-endpoint left ${up.ethernet.up ? 'active' : ''}" data-go="networking">
                <div>
                  <div class="topo-endpoint-label">Ethernet</div>
                  <div class="topo-endpoint-sub">${up.ethernet.up ? esc(up.ethernet.ip) : esc(up.ethernet.device)}</div>
                </div>
                <div class="topo-endpoint-icon">${icon('ethernet')}</div>
              </a>

              <a href="#wifi-client" class="topo-endpoint left ${up.repeater.up ? 'active' : ''}" data-go="wifi-client">
                <div>
                  <div class="topo-endpoint-label">Repeater</div>
                  <div class="topo-endpoint-sub">${up.repeater.up ? esc(up.repeater.ssid) : (snap.sta.configured ? 'Configured' : 'Scan Wi-Fi')}</div>
                </div>
                <div class="topo-endpoint-icon">${icon('wifi')}</div>
              </a>

              <a href="#networking" class="topo-endpoint left ${up.tethering.up ? 'active' : ''}" data-go="networking">
                <div>
                  <div class="topo-endpoint-label">Tethering</div>
                  <div class="topo-endpoint-sub">${up.tethering.up ? esc(up.tethering.ip) : 'USB Phone'}</div>
                </div>
                <div class="topo-endpoint-icon">${icon('usb')}</div>
              </a>

              <a href="#networking" class="topo-endpoint left ${up.cellular.up ? 'active' : ''}" data-go="networking">
                <div>
                  <div class="topo-endpoint-label">Cellular</div>
                  <div class="topo-endpoint-sub">${up.cellular.up ? esc(up.cellular.ip) : 'LTE / 5G'}</div>
                </div>
                <div class="topo-endpoint-icon">${icon('cell')}</div>
              </a>
            </div>

            <!-- LEFT ORTHOGONAL BUS -->
            ${renderLeftBusSvg(up)}

            <!-- CENTER DEVICE HUB (Exact RaspAP Structure) -->
            <div class="center-device">
              <a href="#system" data-go="system" class="device-svg-wrap" title="System Info">
                ${renderDeviceIllustration(snap.board, { online: snap.publicNet.up, apUp: hs.anyApRuntimeUp })}
              </a>
              <div>
                <div class="device-label"><a href="#system" data-go="system" style="color:inherit;">${esc(snap.board.model)}</a></div>
                <div class="device-sub">${esc(snap.board.firmware)} • Up ${esc(fmtUptime(snap.system.uptimeSec))}</div>
              </div>

              <div class="ip-info-toggle" role="tablist">
                <button type="button" class="${ipTab === 'public' ? 'active' : ''}" data-iptab="public">Public</button>
                <button type="button" class="${ipTab === 'local' ? 'active' : ''}" data-iptab="local">Local</button>
              </div>

              <div class="center-kv">${ipDetails}</div>

              <div class="device-status-row">
                <a href="#hotspot" class="status-item ${hs.anyApOutOfSync ? 'warn' : hs.anyApRuntimeUp ? 'active' : ''}" data-go="hotspot">
                  ${icon('hotspot', 'icon-lg')}
                  <span>AP</span>
                </a>
                <a href="#hotspot" class="status-item ${hs.bridgedAp ? 'active' : ''}" data-go="hotspot">
                  ${icon('bridge', 'icon-lg')}
                  <span>Bridged</span>
                </a>
                <a href="#adblock" class="status-item ${snap.adblock.active ? 'active' : ''}" data-go="adblock">
                  ${icon('adblock', 'icon-lg')}
                  <span>Adblock</span>
                </a>
                <a href="#vpn" class="status-item ${snap.vpn.active ? 'active' : ''}" data-go="vpn">
                  ${icon('vpn', 'icon-lg')}
                  <span>${esc(snap.vpn.label)}</span>
                </a>
                <a href="#networking" class="status-item ${snap.firewall.active ? 'active' : ''}" data-go="networking">
                  ${icon('flame', 'icon-lg')}
                  <span>Firewall</span>
                </a>
              </div>

              <div class="wifi-bands">
                <a href="#hotspot" class="band ${hs.band5Up ? 'active' : ''}" data-go="hotspot">5G</a>
                <a href="#hotspot" class="band ${hs.band24Up ? 'active' : ''}" data-go="hotspot">2.4G</a>
              </div>

              <!-- Mobile Compact Summary -->
              <div class="clients-mobile">
                <a href="#wifi-client" class="mobile-bubble" data-go="wifi-client" title="Uplink: ${esc(up.primaryType)}">
                  ${icon('globe', 'icon-lg')}
                  <span class="mobile-bubble-badge">${snap.publicNet.up ? 'ON' : '—'}</span>
                </a>
                <a href="#dhcp" class="mobile-bubble" data-go="dhcp" title="Connected Clients">
                  ${icon('laptop', 'icon-lg')}
                  <span class="mobile-bubble-badge">${snap.clients.length}</span>
                </a>
              </div>
            </div>

            <!-- RIGHT ORTHOGONAL BUS -->
            ${renderRightBusSvg(wifiClients.length > 0, wiredClients.length > 0)}

            <!-- RIGHT: Connected Clients -->
            <div class="topo-side topo-side-right">
              <a href="#dhcp" class="topo-endpoint right ${wifiClients.length > 0 ? 'active' : ''}" data-go="dhcp">
                <div class="topo-endpoint-icon">${icon('wifi')}</div>
                <div>
                  <div class="topo-endpoint-label">${wifiClients.length} Wireless</div>
                  <div class="topo-endpoint-sub">${wifiClients.length > 0 ? esc(wifiClients[0].hostname) : (hs.anyApRuntimeUp ? 'Hotspot ready' : 'AP stopped')}</div>
                </div>
              </a>

              <a href="#dhcp" class="topo-endpoint right ${wiredClients.length > 0 ? 'active' : ''}" data-go="dhcp">
                <div class="topo-endpoint-icon">${icon('laptop')}</div>
                <div>
                  <div class="topo-endpoint-label">${wiredClients.length} Wired</div>
                  <div class="topo-endpoint-sub">${wiredClients.length > 0 ? esc(wiredClients[0].hostname) : 'LAN Ethernet'}</div>
                </div>
              </a>
            </div>
          </div>
        </div>

        <div class="card-footer">
          <span>
            Live OpenWrt state via <code>luci-rpc</code> + <code>uci</code> —
            ${snap.radios.map((r) => `${esc(r.bandShort)}: <strong>${r.runtimeUp ? `UP (Ch ${esc(r.liveChannel)})` : 'OFF'}</strong>`).join(' · ')}
          </span>
          <span>Updated ${new Date(snap.fetchedAt).toLocaleTimeString()}</span>
        </div>
      </div>

      <!-- Compact Telemetry Row -->
      <div class="grid-4">
        <div class="metric-card">
          <div class="metric-label">Memory Used</div>
          <div class="metric-val">${snap.system.memUsedPct}%</div>
          <div class="metric-sub">${Math.round((snap.system.memTotal - snap.system.memAvail) / 1048576)} / ${Math.round(snap.system.memTotal / 1048576)} MB</div>
          <div class="meter"><div class="meter-fill ${snap.system.memUsedPct >= 85 ? 'crit' : snap.system.memUsedPct >= 70 ? 'warn' : ''}" style="width:${snap.system.memUsedPct}%"></div></div>
        </div>
        <div class="metric-card">
          <div class="metric-label">CPU Load</div>
          <div class="metric-val">${snap.system.cpuUsedPct != null ? `${snap.system.cpuUsedPct}%` : esc(snap.system.loadAvg[0])}</div>
          <div class="metric-sub">1m/5m/15m: ${esc(snap.system.loadAvg.join(' / '))}</div>
          <div class="meter"><div class="meter-fill" style="width:${snap.system.cpuUsedPct ?? Math.min(100, Number(snap.system.loadAvg[0]) * 50)}%"></div></div>
        </div>
        <div class="metric-card">
          <div class="metric-label">CPU Temp</div>
          <div class="metric-val">${snap.system.tempC != null ? `${snap.system.tempC.toFixed(1)} °C` : 'N/A'}</div>
          <div class="metric-sub">${snap.pluginOnline ? 'Hardware thermal sensor' : 'ucode plugin inactive'}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Travel Safeguards</div>
          <div class="metric-val">${snap.vpn.killSwitch ? 'Kill-Switch' : snap.travel.rebindProtection ? 'Protected' : 'Portal Mode'}</div>
          <div class="metric-sub">DNS Rebind: ${snap.travel.rebindProtection ? 'On' : 'Off (Captive Portal)'}</div>
        </div>
      </div>
    `;

    container.querySelector('#dash-refresh')?.addEventListener('click', refresh);
    container.querySelectorAll('[data-iptab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        ipTab = btn.dataset.iptab;
        this.render(container, state, { refresh });
      });
    });
    container.querySelectorAll('[data-go]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        navigate(el.dataset.go);
      });
    });
  },

  onUpdate(container, state, ctx) {
    this.render(container, state, ctx);
  }
};
