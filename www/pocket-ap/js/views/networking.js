// Networking View — Live interfaces, Ethernet WAN, LAN subnet, USB tethering devices, and Diagnostics.

import { esc, icon, fmtUptime, fmtBytes } from '../utils/dom.js';
import { saveWanConfig, saveLanConfig, runDiagnostic } from '../api/openwrt.js';
import { openRollback, pushToast } from '../state/store.js';

let activeTab = 'interfaces';
let diagOutput = '';
let diagBusy = false;

export const networkingView = {
  id: 'networking',
  title: 'Networking',

  render(container, state, { refresh }) {
    const snap = state.snapshot;
    if (!snap) {
      container.innerHTML = `<div class="card"><div class="card-body">Loading network interfaces…</div></div>`;
      return;
    }

    const wanCfg = snap.uciNet.wan || {};
    const lanCfg = snap.uciNet.lan || {};
    const wanProto = wanCfg.proto || 'dhcp';
    const wanDns = Array.isArray(wanCfg.dns) ? wanCfg.dns.join(' ') : (wanCfg.dns || '');

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">${icon('network')} Network Interfaces & Routing</div>
          <span class="pill ${snap.publicNet.up ? 'good' : 'warn'}">Primary: ${esc(snap.uplinks.primaryType)}</span>
        </div>

        <div class="card-body">
          <div class="tabs">
            <button type="button" class="tab-btn ${activeTab === 'interfaces' ? 'active' : ''}" data-tab="interfaces">Live Interfaces</button>
            <button type="button" class="tab-btn ${activeTab === 'wan' ? 'active' : ''}" data-tab="wan">Ethernet WAN</button>
            <button type="button" class="tab-btn ${activeTab === 'lan' ? 'active' : ''}" data-tab="lan">LAN Subnet</button>
            <button type="button" class="tab-btn ${activeTab === 'diag' ? 'active' : ''}" data-tab="diag">Diagnostics</button>
          </div>

          ${activeTab === 'interfaces' ? `
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Interface</th>
                    <th>Status</th>
                    <th>Protocol</th>
                    <th>Device</th>
                    <th>IPv4 Address</th>
                    <th>RX / TX</th>
                    <th>Uptime</th>
                  </tr>
                </thead>
                <tbody>
                  ${snap.interfaces.filter((i) => i.interface !== 'loopback').map((i) => {
                    const devName = i.l3_device || i.device || '';
                    const dev = snap.netDevs[devName];
                    const ip = i['ipv4-address']?.[0] ? `${i['ipv4-address'][0].address}/${i['ipv4-address'][0].mask}` : '—';
                    return `
                      <tr>
                        <td><strong>${esc(i.interface)}</strong></td>
                        <td><span class="pill ${i.up ? 'good' : ''}">${i.up ? 'UP' : 'DOWN'}</span></td>
                        <td class="mono">${esc(i.proto || '—')}</td>
                        <td class="mono">${esc(devName || '—')}</td>
                        <td class="mono">${esc(ip)}</td>
                        <td class="mono">${dev?.stats ? `${fmtBytes(dev.stats.rx_bytes)} / ${fmtBytes(dev.stats.tx_bytes)}` : '—'}</td>
                        <td>${i.up ? esc(fmtUptime(i.uptime)) : '—'}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>

            <div style="margin-top:18px;">
              <h4 style="margin-bottom:8px;">USB Tethering & Attached USB Devices</h4>
              ${snap.usbDevices.length === 0 ? `
                <p class="hint">No USB devices attached. Plug in an Android/iPhone tether or LTE modem to detect USB networking interfaces (install <code>kmod-usb-net-rndis</code> / <code>kmod-usb-net-ipheth</code> if needed).</p>
              ` : `
                <div class="table-wrap">
                  <table>
                    <thead><tr><th>Device</th><th>Vendor / Product</th><th>Speed</th></tr></thead>
                    <tbody>
                      ${snap.usbDevices.map((u) => `
                        <tr>
                          <td><strong>${esc(u.product || u.name || 'USB Device')}</strong></td>
                          <td class="mono">${esc(u.vendor || '')} ${esc(u.id || '')}</td>
                          <td>${esc(u.speed ? `${u.speed} Mbps` : '—')}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              `}
            </div>
          ` : ''}

          ${activeTab === 'wan' ? `
            <form id="wan-form">
              <div class="form-grid">
                <div class="field">
                  <label for="wan-proto">WAN Protocol</label>
                  <select id="wan-proto" name="proto">
                    <option value="dhcp" ${wanProto === 'dhcp' ? 'selected' : ''}>DHCP Client (Hotel / Home Ethernet)</option>
                    <option value="static" ${wanProto === 'static' ? 'selected' : ''}>Static IPv4</option>
                    <option value="pppoe" ${wanProto === 'pppoe' ? 'selected' : ''}>PPPoE</option>
                  </select>
                </div>
                <div class="field">
                  <label>DNS Mode</label>
                  <label class="check-row" style="margin-top:8px;">
                    <input type="checkbox" name="peerdns" ${wanCfg.peerdns !== '0' ? 'checked' : ''}>
                    Use DNS servers advertised by upstream WAN
                  </label>
                </div>
              </div>

              <div id="wan-static-fields" class="form-grid" style="display:${wanProto === 'static' ? 'grid' : 'none'}; margin-top:12px;">
                <div class="field"><label>Static IPv4</label><input name="ipaddr" type="text" value="${esc(wanCfg.ipaddr || '')}" placeholder="192.168.100.2"></div>
                <div class="field"><label>Netmask</label><input name="netmask" type="text" value="${esc(wanCfg.netmask || '255.255.255.0')}"></div>
                <div class="field"><label>Gateway</label><input name="gateway" type="text" value="${esc(wanCfg.gateway || '')}" placeholder="192.168.100.1"></div>
              </div>

              <div id="wan-pppoe-fields" class="form-grid" style="display:${wanProto === 'pppoe' ? 'grid' : 'none'}; margin-top:12px;">
                <div class="field"><label>PPPoE Username</label><input name="username" type="text" value="${esc(wanCfg.username || '')}"></div>
                <div class="field"><label>PPPoE Password</label><input name="password" type="password" value="${esc(wanCfg.password || '')}"></div>
              </div>

              <div class="field" style="margin-top:12px;">
                <label>Custom WAN DNS (when automatic WAN DNS is unchecked)</label>
                <input name="dns" type="text" value="${esc(wanDns)}" placeholder="1.1.1.1 9.9.9.9">
              </div>

              <div style="margin-top:16px; display:flex; justify-content:space-between; align-items:center;">
                <span class="hint">Applied with 90-second auto-rollback protection.</span>
                <button type="submit" class="btn btn-primary">Save WAN Config</button>
              </div>
            </form>
          ` : ''}

          ${activeTab === 'lan' ? `
            <div class="banner info">
              <div>
                <strong>Travel Router Tip:</strong> Many hotel networks use <code>192.168.1.0/24</code>. Setting your travel router LAN IP to a less common subnet like <code>192.168.8.1</code> or <code>10.3.141.1</code> avoids IP collisions when repeating hotel Wi-Fi!
              </div>
            </div>
            <form id="lan-form">
              <div class="form-grid">
                <div class="field">
                  <label for="lan-ip">Router LAN IPv4 Address</label>
                  <input id="lan-ip" name="ipaddr" type="text" value="${esc(snap.localNet.ip)}" required>
                </div>
                <div class="field">
                  <label for="lan-mask">LAN Netmask</label>
                  <input id="lan-mask" name="netmask" type="text" value="${esc(snap.localNet.mask || lanCfg.netmask || '255.255.255.0')}" required>
                </div>
              </div>
              <div style="margin-top:16px; display:flex; justify-content:space-between; align-items:center;">
                <span class="hint">Changing LAN IP applies with 90s auto-rollback. Reconnect at the new IP if you change it.</span>
                <button type="submit" class="btn btn-primary">Save LAN IP</button>
              </div>
            </form>
          ` : ''}

          ${activeTab === 'diag' ? `
            <form id="diag-form" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
              <select name="action" style="width:auto; min-width:160px;">
                <option value="ping">Ping (4 packets)</option>
                <option value="nslookup">DNS Lookup (nslookup)</option>
                <option value="traceroute">Traceroute (12 hops)</option>
                <option value="portal_check">Captive Portal Check</option>
              </select>
              <input name="target" type="text" value="1.1.1.1" placeholder="Host or IP (e.g. 1.1.1.1 or openwrt.org)" style="flex:1; min-width:200px;">
              <button type="submit" class="btn btn-primary" ${diagBusy ? 'disabled' : ''}>${diagBusy ? 'Running…' : 'Run'}</button>
            </form>
            ${diagOutput ? `<div class="log-box">${esc(diagOutput)}</div>` : `<p class="hint">Run a network diagnostic directly from the OpenWrt router.</p>`}
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

    container.querySelector('#wan-proto')?.addEventListener('change', (e) => {
      const p = e.target.value;
      const st = container.querySelector('#wan-static-fields');
      const pp = container.querySelector('#wan-pppoe-fields');
      if (st) st.style.display = p === 'static' ? 'grid' : 'none';
      if (pp) pp.style.display = p === 'pppoe' ? 'grid' : 'none';
    });

    container.querySelector('#wan-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      try {
        await saveWanConfig({
          proto: f.proto.value,
          peerdns: f.peerdns.checked,
          ipaddr: f.ipaddr.value,
          netmask: f.netmask.value,
          gateway: f.gateway.value,
          username: f.username.value,
          password: f.password.value,
          dns: f.dns.value
        });
        openRollback('Update Ethernet WAN configuration', 90);
        setTimeout(refresh, 1800);
      } catch (err) {
        pushToast(err.message, 'crit');
      }
    });

    container.querySelector('#lan-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      try {
        await saveLanConfig({ ipaddr: f.ipaddr.value, netmask: f.netmask.value });
        openRollback(`Change LAN IP to ${f.ipaddr.value}`, 90);
      } catch (err) {
        pushToast(err.message, 'crit');
      }
    });

    container.querySelector('#diag-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      diagBusy = true;
      diagOutput = 'Running diagnostic on router…';
      this.render(container, state, { refresh });
      try {
        const res = await runDiagnostic(f.action.value, f.target.value);
        diagOutput = res.error ? `Error: ${res.error}` : (res.output || JSON.stringify(res, null, 2));
      } catch (err) {
        diagOutput = `Failed: ${err.message}\n(Ensure the pocket-ap ucode plugin is deployed via ./scripts/deploy.sh)`;
      } finally {
        diagBusy = false;
        this.render(container, state, { refresh });
      }
    });
  },

  onUpdate(container, state, ctx) {
    if (activeTab === 'interfaces') this.render(container, state, ctx);
  }
};
