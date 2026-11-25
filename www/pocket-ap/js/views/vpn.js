// VPN View — WireGuard (live peers + .conf importer), OpenVPN, and Tailscale management.

import { esc, icon, fmtBytes } from '../utils/dom.js';
import { importWireguardProfile, deleteWireguardInterface, setVpnKillSwitch } from '../api/openwrt.js';
import { openRollback, pushToast } from '../state/store.js';

let activeTab = 'wireguard';

function fmtHandshake(unixSec) {
  if (!unixSec) return 'No handshake yet';
  const ago = Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  if (ago < 60) return `${ago}s ago`;
  if (ago < 3600) return `${Math.floor(ago / 60)}m ago`;
  return `${Math.floor(ago / 3600)}h ago`;
}

export const vpnView = {
  id: 'vpn',
  title: 'VPN',

  render(container, state, { refresh }) {
    const snap = state.snapshot;
    if (!snap) {
      container.innerHTML = `<div class="card"><div class="card-body">Loading VPN status…</div></div>`;
      return;
    }

    const pm = snap.capabilities.pkg_manager === 'opkg' ? 'opkg install' : 'apk add';
    const wgInstalled = snap.capabilities.wireguard;
    const wgList = snap.vpn.wireguard;

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">${icon('vpn')} Travel VPN Tunnel</div>
          <span class="pill ${snap.vpn.active ? 'good' : ''}">
            ${snap.vpn.active ? `${esc(snap.vpn.label)} Active` : 'Disconnected'}
          </span>
        </div>

        <div class="card-body">
          <div class="tabs">
            <button type="button" class="tab-btn ${activeTab === 'wireguard' ? 'active' : ''}" data-tab="wireguard">WireGuard (${wgList.length})</button>
            <button type="button" class="tab-btn ${activeTab === 'import' ? 'active' : ''}" data-tab="import">Import WireGuard .conf</button>
            <button type="button" class="tab-btn ${activeTab === 'other' ? 'active' : ''}" data-tab="other">OpenVPN & Tailscale</button>
          </div>

          ${activeTab === 'wireguard' ? `
            ${wgList.length > 0 ? `
              <div class="metric-card" style="margin-bottom:14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                <div>
                  <div style="font-weight:700;">Travel VPN Kill-Switch (Block Non-VPN Leaks)</div>
                  <div class="hint">Disables direct <code>lan → wan</code> firewall forwarding so travel devices can only reach the internet through your WireGuard tunnel (<code>${esc(wgList[0].name)}</code>). Applied with 90s auto-rollback.</div>
                </div>
                <label class="switch">
                  <input type="checkbox" id="wg-killswitch" ${snap.vpn.killSwitch ? 'checked' : ''}>
                  <span class="switch-track"></span>
                  <span><strong>${snap.vpn.killSwitch ? 'Kill-Switch ON' : 'Kill-Switch OFF'}</strong></span>
                </label>
              </div>
            ` : ''}

            ${!wgInstalled ? `
              <div class="banner info">
                <div>
                  <strong>WireGuard packages are not installed yet on this OpenWrt router.</strong><br>
                  Install them via SSH (or LuCI Software) to enable kernel-accelerated WireGuard on your GL-MT3000:
                  <pre class="log-box" style="margin-top:8px; padding:10px;">${pm === 'apk add' ? 'apk update && apk add wireguard-tools kmod-wireguard luci-proto-wireguard' : 'opkg update && opkg install wireguard-tools kmod-wireguard luci-proto-wireguard'}</pre>
                </div>
              </div>
            ` : ''}

            ${wgList.length === 0 ? `
              <p style="color:var(--text-muted);">
                No WireGuard interfaces configured yet. Switch to the <strong>Import WireGuard .conf</strong> tab to paste or upload a VPN client profile from Mullvad, Proton, IVPN, or your home router.
              </p>
            ` : wgList.map((wg) => `
              <div class="card" style="margin-bottom:14px;">
                <div class="card-header">
                  <div class="card-title">${icon('vpn')} Interface <code>${esc(wg.name)}</code></div>
                  <div style="display:flex; gap:8px; align-items:center;">
                    <span class="pill ${wg.up ? 'good' : ''}">${wg.up ? 'UP' : 'DOWN'}</span>
                    <button type="button" class="btn btn-sm btn-danger" data-del-wg="${esc(wg.name)}">Delete</button>
                  </div>
                </div>
                <div class="card-body">
                  <div class="kv-box" style="margin-bottom:12px;">
                    <div class="kv-row"><span class="kv-k">Tunnel Address</span><span class="kv-v">${esc(wg.addresses.join(', ') || '—')}</span></div>
                    <div class="kv-row"><span class="kv-k">Public Key</span><span class="kv-v">${esc(wg.publicKey || '—')}</span></div>
                    <div class="kv-row"><span class="kv-k">Listen Port</span><span class="kv-v">${esc(wg.listenPort || 'Auto')}</span></div>
                  </div>
                  ${wg.peers.length === 0 ? '<div class="hint">No peers configured.</div>' : `
                    <div class="table-wrap">
                      <table>
                        <thead><tr><th>Peer Public Key</th><th>Endpoint</th><th>Allowed IPs</th><th>Handshake</th><th>RX / TX</th></tr></thead>
                        <tbody>
                          ${wg.peers.map((p) => `
                            <tr>
                              <td class="mono" title="${esc(p.publicKey)}">${esc(p.publicKey.slice(0, 18))}…</td>
                              <td class="mono">${esc(p.endpoint || '—')}</td>
                              <td class="mono">${esc(p.allowedIps || '—')}</td>
                              <td>${p.live ? esc(fmtHandshake(p.live.latest_handshake)) : '—'}</td>
                              <td class="mono">${p.live ? `${fmtBytes(p.live.rx_bytes)} / ${fmtBytes(p.live.tx_bytes)}` : '—'}</td>
                            </tr>
                          `).join('')}
                        </tbody>
                      </table>
                    </div>
                  `}
                </div>
              </div>
            `).join('')}
          ` : ''}

          ${activeTab === 'import' ? `
            <form id="wg-import-form">
              <div class="form-grid">
                <div class="field">
                  <label for="wg-name">OpenWrt Interface Name</label>
                  <input id="wg-name" name="name" type="text" value="wg0" maxlength="15" required>
                </div>
                <div class="field">
                  <label for="wg-file">Load from .conf file (optional)</label>
                  <input id="wg-file" type="file" accept=".conf,.txt">
                </div>
              </div>
              <div class="field">
                <label for="wg-conf">WireGuard Configuration (.conf)</label>
                <textarea id="wg-conf" name="conf" rows="10" required placeholder="[Interface]&#10;PrivateKey = ...&#10;Address = 10.66.66.2/32&#10;&#10;[Peer]&#10;PublicKey = ...&#10;Endpoint = vpn.example.com:51820&#10;AllowedIPs = 0.0.0.0/0, ::/0"></textarea>
                <div class="hint">Pocket-AP creates the UCI <code>network</code> interface + peers and attaches it to the <code>wan</code> firewall masquerade zone with rollback safety.</div>
              </div>
              <div style="margin-top:14px; display:flex; justify-content:flex-end;">
                <button type="submit" class="btn btn-primary" ${!wgInstalled ? 'title="Install wireguard-tools first"' : ''}>Import & Apply WireGuard</button>
              </div>
            </form>
          ` : ''}

          ${activeTab === 'other' ? `
            <div class="grid-2">
              <div class="card">
                <div class="card-header">
                  <div class="card-title">OpenVPN</div>
                  <span class="pill ${snap.vpn.openvpnRunning ? 'good' : ''}">${snap.vpn.openvpnRunning ? 'Running' : snap.vpn.openvpnInstalled ? 'Installed' : 'Not Installed'}</span>
                </div>
                <div class="card-body">
                  ${snap.vpn.openvpnInstalled ? `
                    <p>OpenVPN is installed on this router. Manage active client services under <a href="#system">System → Services</a> or LuCI.</p>
                  ` : `
                    <p style="color:var(--text-muted);">Install OpenVPN to use <code>.ovpn</code> client profiles:</p>
                    <pre class="log-box" style="padding:10px;">${pm} openvpn-openssl luci-app-openvpn</pre>
                  `}
                </div>
              </div>

              <div class="card">
                <div class="card-header">
                  <div class="card-title">Tailscale</div>
                  <span class="pill ${snap.vpn.tailscale.running ? 'good' : ''}">${snap.vpn.tailscale.running ? 'Connected' : snap.vpn.tailscale.installed ? esc(snap.vpn.tailscale.state || 'Stopped') : 'Not Installed'}</span>
                </div>
                <div class="card-body">
                  ${snap.vpn.tailscale.installed ? `
                    <div class="kv-box">
                      <div class="kv-row"><span class="kv-k">State</span><span class="kv-v">${esc(snap.vpn.tailscale.state || 'Unknown')}</span></div>
                      <div class="kv-row"><span class="kv-k">Hostname</span><span class="kv-v">${esc(snap.vpn.tailscale.hostname || '—')}</span></div>
                      <div class="kv-row"><span class="kv-k">Tailscale IPs</span><span class="kv-v">${esc((snap.vpn.tailscale.ips || []).join(', ') || '—')}</span></div>
                    </div>
                  ` : `
                    <p style="color:var(--text-muted);">Install Tailscale for zero-config exit-node routing back to your home network while traveling:</p>
                    <pre class="log-box" style="padding:10px;">${pm} tailscale</pre>
                  `}
                </div>
              </div>
            </div>
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

    container.querySelector('#wg-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const ta = container.querySelector('#wg-conf');
      if (ta) ta.value = text;
    });

    container.querySelector('#wg-import-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      try {
        await importWireguardProfile(f.name.value, f.conf.value);
        openRollback(`Import WireGuard profile (${f.name.value})`, 90);
        activeTab = 'wireguard';
        setTimeout(refresh, 2000);
      } catch (err) {
        pushToast(err.message, 'crit');
      }
    });

    container.querySelector('#wg-killswitch')?.addEventListener('change', async (e) => {
      const enable = e.currentTarget.checked;
      try {
        await setVpnKillSwitch(enable, wgList[0]?.name);
        openRollback(enable ? 'Enable WireGuard VPN Kill-Switch' : 'Disable WireGuard VPN Kill-Switch', 90);
        setTimeout(refresh, 1800);
      } catch (err) {
        pushToast(err.message, 'crit');
        e.currentTarget.checked = !enable;
      }
    });

    container.querySelectorAll('[data-del-wg]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.delWg;
        if (!confirm(`Delete WireGuard interface "${name}" and all its peers?`)) return;
        try {
          await deleteWireguardInterface(name);
          pushToast(`Removed WireGuard interface ${name}.`, 'info');
          refresh();
        } catch (err) {
          pushToast(err.message, 'crit');
        }
      });
    });
  },

  onUpdate() {}
};
