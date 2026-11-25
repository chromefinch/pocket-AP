// GL.iNet-Style LuCI Advanced Bridge View — Quick-jump cards, embedded LuCI workspace, and Default Landing toggle.

import { esc, icon } from '../utils/dom.js';
import { setLandingMode } from '../api/openwrt.js';
import { pushToast } from '../state/store.js';

const LUCI_SHORTCUTS = [
  { label: 'Status Overview', path: '/cgi-bin/luci/admin/status/overview', desc: 'Full OpenWrt runtime diagnostics, leases, and kernel stats' },
  { label: 'Wireless Radios', path: '/cgi-bin/luci/admin/network/wireless', desc: 'Advanced hostapd, multi-SSID, mesh, and radio drivers' },
  { label: 'Interfaces & Routing', path: '/cgi-bin/luci/admin/network/network', desc: 'VLANs, bridges, static routes, IPv6, and protocols' },
  { label: 'Firewall (fw4)', path: '/cgi-bin/luci/admin/network/firewall', desc: 'Traffic rules, port forwards, zones, and nftables' },
  { label: 'Software (apk)', path: '/cgi-bin/luci/admin/system/package-manager', desc: 'Install WireGuard, OpenVPN, Tailscale, USB tether drivers' },
  { label: 'Backup & Flash', path: '/cgi-bin/luci/admin/system/flash', desc: 'Config archive backup, restore, and sysupgrade' }
];

let embedOpen = false;
let currentLuciPath = '/cgi-bin/luci/';

export const luciView = {
  id: 'luci',
  title: 'LuCI (Advanced)',

  render(container, state, { refresh }) {
    const snap = state.snapshot;
    const landingMode = snap?.landing?.mode || 'luci';
    const isPocketDefault = landingMode === 'pocket-ap';

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">${icon('sliders')} OpenWrt LuCI — Advanced Settings</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="btn btn-sm" id="btn-toggle-embed">
              ${embedOpen ? 'Hide Embedded LuCI' : 'Open LuCI Inside Pocket-AP'}
            </button>
            <a class="btn btn-sm" href="${esc(currentLuciPath)}" target="_blank" rel="noopener noreferrer">
              ${icon('external', 'icon-sm')} Open Full Tab
            </a>
          </div>
        </div>

        <div class="card-body">
          <div class="banner info">
            ${icon('sliders')}
            <div>
              <strong>Dual Interface Mode:</strong> Pocket-AP handles day-to-day travel router tasks (Hotspot, Hotel Wi-Fi Repeater, Captive Portals, VPN, Adblock), while full stock <strong>LuCI</strong> remains 100% untouched at <code>/cgi-bin/luci/</code>. Any changes you make in LuCI automatically sync back to Pocket-AP.
            </div>
          </div>

          <!-- Default Landing Page Switch (Pocket-AP vs Stock LuCI at http://router/) -->
          <div class="metric-card" style="margin-bottom:18px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
            <div>
              <div style="font-weight:700; font-size:0.95rem;">Default Router Landing Page (<code>http://${esc(location.host)}/</code>)</div>
              <div class="hint" style="margin-top:2px;">
                ${isPocketDefault
                  ? 'Visiting the router IP opens <strong>Pocket-AP</strong> by default. LuCI is always available here or at <code>/cgi-bin/luci/</code>.'
                  : 'Visiting the router IP opens <strong>Stock LuCI</strong> by default. Switch this ON to make Pocket-AP your main landing page.'}
              </div>
            </div>
            <label class="switch">
              <input type="checkbox" id="toggle-landing" ${isPocketDefault ? 'checked' : ''} ${!snap?.pluginOnline ? 'disabled' : ''}>
              <span class="switch-track"></span>
              <span><strong>${isPocketDefault ? 'Pocket-AP Default' : 'LuCI Default'}</strong></span>
            </label>
          </div>

          <!-- Direct LuCI Quick-Jump Grid -->
          <h4 style="margin-bottom:10px;">Quick-Jump to LuCI Sections</h4>
          <div class="grid-3" style="margin-bottom:${embedOpen ? '18px' : '0'};">
            ${LUCI_SHORTCUTS.map((s) => `
              <div class="metric-card" style="display:flex; flex-direction:column; gap:8px;">
                <div style="font-weight:700; font-size:0.93rem;">${esc(s.label)}</div>
                <div class="hint" style="flex:1;">${esc(s.desc)}</div>
                <div style="display:flex; gap:6px; margin-top:4px;">
                  <button type="button" class="btn btn-sm btn-primary" data-embed-path="${esc(s.path)}">Open Here</button>
                  <a class="btn btn-sm" href="${esc(s.path)}" target="_blank" rel="noopener noreferrer">${icon('external', 'icon-sm')} Tab</a>
                </div>
              </div>
            `).join('')}
          </div>

          <!-- Embedded LuCI Workspace -->
          ${embedOpen ? `
            <div style="margin-top:14px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
                <span class="hint">Embedded LuCI: <code>${esc(currentLuciPath)}</code></span>
                <div style="display:flex; gap:6px;">
                  <button type="button" class="btn btn-sm" id="btn-sync-from-luci">${icon('refresh', 'icon-sm')} Sync LuCI Changes to Pocket-AP</button>
                  <a class="btn btn-sm" href="${esc(currentLuciPath)}" target="_blank" rel="noopener noreferrer">${icon('external', 'icon-sm')} Pop Out</a>
                </div>
              </div>
              <div class="luci-frame-wrap">
                ${state.auth.mock
                  ? `<div style="padding:48px; text-align:center; color:#495057;">Embedded LuCI iframe loads <code>${esc(currentLuciPath)}</code> on the live OpenWrt router.</div>`
                  : `<iframe class="luci-frame" src="${esc(currentLuciPath)}" title="OpenWrt LuCI"></iframe>`}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    container.querySelector('#btn-toggle-embed')?.addEventListener('click', () => {
      embedOpen = !embedOpen;
      this.render(container, state, { refresh });
    });

    container.querySelectorAll('[data-embed-path]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentLuciPath = btn.dataset.embedPath;
        embedOpen = true;
        this.render(container, state, { refresh });
      });
    });

    container.querySelector('#btn-sync-from-luci')?.addEventListener('click', () => {
      refresh();
      pushToast('Synchronized latest live state from OpenWrt / LuCI.', 'good');
    });

    container.querySelector('#toggle-landing')?.addEventListener('change', async (e) => {
      const next = e.currentTarget.checked ? 'pocket-ap' : 'luci';
      try {
        await setLandingMode(next);
        pushToast(
          next === 'pocket-ap'
            ? 'Pocket-AP is now the default landing page at / (LuCI stays at /cgi-bin/luci/).'
            : 'Restored Stock LuCI as default landing page at / (Pocket-AP stays at /pocket-ap/).',
          'good',
          5500
        );
        refresh();
      } catch (err) {
        pushToast(`Failed to update landing page: ${err.message}`, 'crit');
        e.currentTarget.checked = !e.currentTarget.checked;
      }
    });
  },

  onUpdate() {}
};
