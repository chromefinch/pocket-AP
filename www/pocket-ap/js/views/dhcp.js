// DHCP & Connected Clients View — Live leases + Wi-Fi signal/band + DHCP pool + static reservations.

import { esc, icon, fmtLeaseRemaining, renderSignalBars, isTruthy } from '../utils/dom.js';
import { saveDhcpSettings, addStaticLease, deleteStaticLease } from '../api/openwrt.js';
import { pushToast } from '../state/store.js';

let activeTab = 'clients';

export const dhcpView = {
  id: 'dhcp',
  title: 'DHCP & Clients',

  render(container, state, { refresh }) {
    const snap = state.snapshot;
    if (!snap) {
      container.innerHTML = `<div class="card"><div class="card-body">Loading DHCP and client data…</div></div>`;
      return;
    }

    const lanDhcp = snap.dhcp.lanSection || {};
    const dhcpEnabled = !isTruthy(lanDhcp.ignore);
    const dnsList = Array.isArray(snap.dhcp.dnsmasq?.server)
      ? snap.dhcp.dnsmasq.server.join(', ')
      : (snap.dhcp.dnsmasq?.server || '');

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">${icon('dhcp')} DHCP Server & Connected Clients</div>
          <div style="display:flex; gap:8px; align-items:center;">
            <span class="pill ${dhcpEnabled ? 'good' : 'warn'}">DHCP ${dhcpEnabled ? 'Active' : 'Disabled'}</span>
            <span class="pill accent">${snap.clients.length} client${snap.clients.length === 1 ? '' : 's'}</span>
          </div>
        </div>

        <div class="card-body">
          <div class="tabs">
            <button type="button" class="tab-btn ${activeTab === 'clients' ? 'active' : ''}" data-tab="clients">Connected Clients (${snap.clients.length})</button>
            <button type="button" class="tab-btn ${activeTab === 'settings' ? 'active' : ''}" data-tab="settings">DHCP & DNS Settings</button>
            <button type="button" class="tab-btn ${activeTab === 'static' ? 'active' : ''}" data-tab="static">Static Leases (${snap.dhcp.staticLeases.length})</button>
          </div>

          ${activeTab === 'clients' ? `
            ${snap.clients.length === 0 ? `
              <p style="color:var(--text-muted);">No active DHCP leases or associated Wi-Fi stations detected right now.</p>
            ` : `
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Device</th>
                      <th>IP Address</th>
                      <th>MAC Address</th>
                      <th>Connection</th>
                      <th>Lease</th>
                      <th style="text-align:right;">Quick Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${snap.clients.map((c) => `
                      <tr>
                        <td><strong>${esc(c.hostname)}</strong></td>
                        <td class="mono">${esc(c.ip)}</td>
                        <td class="mono">${esc(c.mac)}</td>
                        <td>
                          ${c.isWifi
                            ? `<span class="pill accent">${esc(c.band)}</span> ${c.signal ? `${renderSignalBars(c.signal)} <span class="mono">${c.signal} dBm</span>` : ''}`
                            : `<span class="pill">Wired</span>`}
                        </td>
                        <td>${esc(fmtLeaseRemaining(c.expires))}</td>
                        <td style="text-align:right;">
                          <button type="button" class="btn btn-sm" data-pin-mac="${esc(c.mac)}" data-pin-ip="${esc(c.ip)}" data-pin-name="${esc(c.hostname)}">
                            Reserve IP
                          </button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          ` : ''}

          ${activeTab === 'settings' ? `
            <form id="dhcp-form">
              <div class="field" style="margin-bottom:14px;">
                <label class="switch">
                  <input type="checkbox" name="enabled" ${dhcpEnabled ? 'checked' : ''}>
                  <span class="switch-track"></span>
                  <span><strong>Enable DHCPv4 Server on LAN</strong> (disable only in Bridged AP mode)</span>
                </label>
              </div>
              <div class="form-grid">
                <div class="field">
                  <label for="dhcp-start">Pool Start Offset</label>
                  <input id="dhcp-start" name="start" type="number" min="2" max="250" value="${esc(lanDhcp.start ?? 100)}">
                  <div class="hint">Lowest leased host offset (e.g. 100 -> .100).</div>
                </div>
                <div class="field">
                  <label for="dhcp-limit">Max Pool Size (Limit)</label>
                  <input id="dhcp-limit" name="limit" type="number" min="1" max="250" value="${esc(lanDhcp.limit ?? 150)}">
                  <div class="hint">Maximum number of concurrent DHCP addresses.</div>
                </div>
                <div class="field">
                  <label for="dhcp-lease">Lease Time</label>
                  <input id="dhcp-lease" name="leasetime" type="text" value="${esc(lanDhcp.leasetime ?? '12h')}" placeholder="12h">
                  <div class="hint">Format: e.g. <code>12h</code>, <code>24h</code>, <code>60m</code>.</div>
                </div>
                <div class="field">
                  <label for="dhcp-dns">Custom Upstream DNS Forwarders</label>
                  <input id="dhcp-dns" name="dnsServers" type="text" value="${esc(dnsList)}" placeholder="Leave blank for WAN DNS (e.g. 1.1.1.1, 9.9.9.9)">
                  <div class="hint">Space or comma separated DNS servers for dnsmasq.</div>
                </div>
              </div>
              <div style="margin-top:16px; display:flex; justify-content:flex-end;">
                <button type="submit" class="btn btn-primary" id="dhcp-save">Save DHCP Settings</button>
              </div>
            </form>
          ` : ''}

          ${activeTab === 'static' ? `
            <form id="static-lease-form" style="margin-bottom:18px; padding:14px; background:var(--surface-alt); border:1px solid var(--border); border-radius:var(--radius-md);">
              <div style="font-weight:600; margin-bottom:10px;">Add Static Lease Reservation</div>
              <div class="grid-3">
                <div class="field"><label>Hostname</label><input name="name" type="text" required placeholder="My-Laptop"></div>
                <div class="field"><label>MAC Address</label><input name="mac" type="text" required placeholder="AA:BB:CC:DD:EE:FF"></div>
                <div class="field"><label>IPv4 Address</label><input name="ip" type="text" required placeholder="${esc(snap.localNet.ip.replace(/\.\d+$/, '.50'))}"></div>
              </div>
              <div style="margin-top:10px; display:flex; justify-content:flex-end;">
                <button type="submit" class="btn btn-primary btn-sm">Add Static Lease</button>
              </div>
            </form>

            ${snap.dhcp.staticLeases.length === 0 ? `
              <p style="color:var(--text-muted);">No static DHCP leases configured yet.</p>
            ` : `
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Name</th><th>MAC Address</th><th>Reserved IP</th><th style="text-align:right;">Action</th></tr></thead>
                  <tbody>
                    ${snap.dhcp.staticLeases.map((s) => `
                      <tr>
                        <td><strong>${esc(s.name || '(unnamed)')}</strong></td>
                        <td class="mono">${esc(s.mac)}</td>
                        <td class="mono">${esc(s.ip)}</td>
                        <td style="text-align:right;">
                          <button type="button" class="btn btn-sm btn-danger" data-del-lease="${esc(s.id)}">Remove</button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          ` : ''}
        </div>
      </div>
    `;

    container.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        this.render(container, state, { refresh });
      });
    });

    container.querySelectorAll('[data-pin-mac]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await addStaticLease(btn.dataset.pinName, btn.dataset.pinMac, btn.dataset.pinIp);
          pushToast(`Reserved ${btn.dataset.pinIp} for ${btn.dataset.pinName}.`, 'good');
          refresh();
        } catch (err) {
          pushToast(err.message, 'crit');
          btn.disabled = false;
        }
      });
    });

    container.querySelector('#dhcp-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const btn = container.querySelector('#dhcp-save');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        await saveDhcpSettings({
          enabled: f.enabled.checked,
          start: f.start.value,
          limit: f.limit.value,
          leasetime: f.leasetime.value,
          dnsServers: f.dnsServers.value
        }, snap.dhcp.dnsmasqId);
        pushToast('DHCP & DNS settings saved.', 'good');
        refresh();
      } catch (err) {
        pushToast(err.message, 'crit');
        btn.disabled = false;
        btn.textContent = 'Save DHCP Settings';
      }
    });

    container.querySelector('#static-lease-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      try {
        await addStaticLease(f.name.value, f.mac.value, f.ip.value);
        pushToast('Static lease added.', 'good');
        refresh();
      } catch (err) {
        pushToast(err.message, 'crit');
      }
    });

    container.querySelectorAll('[data-del-lease]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await deleteStaticLease(btn.dataset.delLease);
          pushToast('Static lease removed.', 'info');
          refresh();
        } catch (err) {
          pushToast(err.message, 'crit');
        }
      });
    });
  },

  onUpdate(container, state, ctx) {
    if (activeTab === 'clients') this.render(container, state, ctx);
  }
};
