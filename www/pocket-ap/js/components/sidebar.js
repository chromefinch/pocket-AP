// Authentic RaspAP-inspired Sidebar with vertical Status LEDs + GL.iNet-style LuCI section.

import { esc, icon } from '../utils/dom.js';
import { navigate } from '../state/store.js';

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'hotspot', label: 'Hotspot', icon: 'hotspot' },
  { id: 'wifi-client', label: 'Wi-Fi Client', icon: 'wifi' },
  { id: 'dhcp', label: 'DHCP Server', icon: 'dhcp' },
  { id: 'networking', label: 'Networking', icon: 'network' },
  { id: 'vpn', label: 'VPN', icon: 'vpn' },
  { id: 'adblock', label: 'Ad Blocking', icon: 'adblock' },
  { id: 'data-usage', label: 'Data Usage', icon: 'chart' },
  { id: 'system', label: 'System', icon: 'system' }
];

export const ADVANCED_ITEMS = [
  { id: 'luci', label: 'LuCI (Advanced)', icon: 'sliders' }
];

function ledState(snap) {
  if (!snap) {
    return {
      apCls: '', apText: 'Hotspot …',
      memCls: '', memText: 'Memory …',
      tempCls: '', tempText: 'CPU Temp …'
    };
  }
  const apUp = snap.hotspotSummary.anyApRuntimeUp;
  const apWarn = snap.hotspotSummary.anyApOutOfSync;
  const apCls = apWarn ? 'warn' : apUp ? 'good' : 'crit';
  const apText = apWarn ? 'Hotspot sync!' : apUp ? 'Hotspot up' : 'Hotspot down';

  const mem = snap.system.memUsedPct;
  const memCls = mem >= 85 ? 'crit' : mem >= 70 ? 'warn' : 'good';

  const t = snap.system.tempC;
  const tempCls = t == null ? '' : t >= 75 ? 'crit' : t >= 62 ? 'warn' : 'good';
  const tempText = t == null ? 'CPU Temp N/A' : `CPU Temp ${Math.round(t)}°C`;

  return { apCls, apText, memCls, memText: `Memory ${mem}%`, tempCls, tempText };
}

function navBadge(id, snap) {
  if (!snap) return '';
  if (id === 'hotspot') {
    const upCount = snap.radios.filter((r) => r.runtimeUp).length;
    if (snap.hotspotSummary.anyApOutOfSync) return `<span class="nav-badge warn">sync</span>`;
    return upCount > 0 ? `<span class="nav-badge good">${upCount} up</span>` : `<span class="nav-badge">off</span>`;
  }
  if (id === 'wifi-client' && snap.uplinks.repeater.up) {
    return `<span class="nav-badge good">up</span>`;
  }
  if (id === 'dhcp') {
    return `<span class="nav-badge">${snap.clients.length}</span>`;
  }
  if (id === 'vpn' && snap.vpn.active) {
    return `<span class="nav-badge good">${snap.vpn.killSwitch ? 'KS' : 'on'}</span>`;
  }
  if (id === 'adblock' && snap.adblock.active) {
    return `<span class="nav-badge good">on</span>`;
  }
  return '';
}

export function renderSidebar(state) {
  const snap = state.snapshot;
  const leds = ledState(snap);
  const model = snap?.board?.model || 'OpenWrt Router';
  const fw = snap?.board?.firmware || '';

  return `
    <div class="sidebar-backdrop ${state.sidebarOpen ? 'open' : ''}" data-action="close-sidebar"></div>
    <aside class="sidebar ${state.sidebarOpen ? 'open' : ''}" aria-label="Primary navigation">
      <!-- RaspAP Signature Vertical LED Status Strip -->
      <div class="sb-status-box" title="Live OpenWrt runtime telemetry">
        <div class="sb-status-model" title="${esc(model)}">${esc(model)}</div>
        <div class="sb-status-row"><span class="led-dot ${leds.apCls}"></span><span>${esc(leds.apText)}</span></div>
        <div class="sb-status-row"><span class="led-dot ${leds.memCls}"></span><span>${esc(leds.memText)}</span></div>
        <div class="sb-status-row"><span class="led-dot ${leds.tempCls}"></span><span>${esc(leds.tempText)}</span></div>
      </div>

      <nav class="sidebar-nav">
        ${NAV_ITEMS.map((item) => `
          <a href="#${item.id}" class="nav-link ${state.route === item.id ? 'active' : ''}" data-nav="${item.id}">
            ${icon(item.icon)}
            <span>${esc(item.label)}</span>
            ${navBadge(item.id, snap)}
          </a>
        `).join('')}

        <div class="nav-section-label">OpenWrt Advanced</div>
        ${ADVANCED_ITEMS.map((item) => `
          <a href="#${item.id}" class="nav-link ${state.route === item.id ? 'active' : ''}" data-nav="${item.id}">
            ${icon(item.icon)}
            <span>${esc(item.label)}</span>
          </a>
        `).join('')}
      </nav>

      <div class="sidebar-footer">
        <span title="${esc(fw)}">${esc(fw.slice(0, 22) || 'OpenWrt')}</span>
        <span>${state.auth.mock ? 'DEMO' : 'v0.2'}</span>
      </div>
    </aside>
  `;
}

export function bindSidebarEvents(root, onClose) {
  root.querySelector('[data-action="close-sidebar"]')?.addEventListener('click', onClose);
  root.querySelectorAll('[data-nav]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(a.dataset.nav);
    });
  });
}
