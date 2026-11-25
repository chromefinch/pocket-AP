// System & Administration View — Hardware/Telemetry, Toggle Switch, Hostname/Password, Services, Logs, Reboot.

import { esc, icon, fmtUptime } from '../utils/dom.js';
import {
  saveSystemSettings, changeRootPassword, controlService,
  readSystemLog, rebootRouter, saveSwitchConfig
} from '../api/openwrt.js';
import { setTheme, pushToast } from '../state/store.js';

let activeTab = 'overview';
let sysLogs = [];
let loadingLogs = false;

const KEY_SERVICES = ['dnsmasq', 'firewall', 'network', 'uhttpd', 'dropbear', 'rpcd', 'openvpn', 'adblock', 'adblock-fast', 'travelmate', 'tailscale'];

const SWITCH_ACTIONS = [
  { id: 'none', label: 'No Action (Disabled)', desc: 'Hardware toggle switch does nothing.' },
  { id: 'wifi', label: 'Hotspot Wi-Fi (On / Off)', desc: 'Slide ON to enable 2.4G/5G Access Points; slide OFF to turn Hotspot Wi-Fi off.' },
  { id: 'vpn_wireguard', label: 'WireGuard VPN (Enable / Disable)', desc: 'Slide ON to bring up your WireGuard tunnel; slide OFF to disconnect.' },
  { id: 'vpn_openvpn', label: 'OpenVPN Client (Start / Stop)', desc: 'Slide ON to start the OpenVPN service; slide OFF to stop it.' },
  { id: 'reset_defaults', label: 'Reset Configuration to Defaults', desc: 'Slide ON and leave ON for 5 seconds (LED blinks rapidly) to factory-reset OpenWrt. Slide back OFF within 5s to cancel.' }
];

export const systemView = {
  id: 'system',
  title: 'System',

  render(container, state, { refresh }) {
    const snap = state.snapshot;
    if (!snap) {
      container.innerHTML = `<div class="card"><div class="card-body">Loading system details…</div></div>`;
      return;
    }

    const sw = snap.hwSwitch || { supported: false, position: 'unknown', action: 'none', wg_iface: 'wg0', vpn_killswitch: false, invert: false, last: {} };
    const wgNames = snap.vpn.wireguard.map((w) => w.name);
    if (sw.wg_iface && !wgNames.includes(sw.wg_iface)) wgNames.unshift(sw.wg_iface);
    if (!wgNames.length) wgNames.push('wg0');

    const svcNames = Object.keys(snap.services || {}).sort((a, b) => {
      const ia = KEY_SERVICES.indexOf(a), ib = KEY_SERVICES.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">${icon('system')} System & Administration</div>
          <div style="display:flex; gap:8px;">
            <a href="/cgi-bin/luci/" target="_blank" rel="noopener noreferrer" class="btn btn-sm">${icon('external', 'icon-sm')} Open LuCI</a>
            <button type="button" class="btn btn-sm btn-danger" id="btn-reboot">Reboot Router</button>
          </div>
        </div>

        <div class="card-body">
          <div class="tabs">
            <button type="button" class="tab-btn ${activeTab === 'overview' ? 'active' : ''}" data-tab="overview">Hardware & Theme</button>
            <button type="button" class="tab-btn ${activeTab === 'switch' ? 'active' : ''}" data-tab="switch">Toggle Switch</button>
            <button type="button" class="tab-btn ${activeTab === 'admin' ? 'active' : ''}" data-tab="admin">Hostname & Password</button>
            <button type="button" class="tab-btn ${activeTab === 'services' ? 'active' : ''}" data-tab="services">Services (${svcNames.length})</button>
            <button type="button" class="tab-btn ${activeTab === 'logs' ? 'active' : ''}" data-tab="logs">System Log</button>
          </div>

          ${activeTab === 'overview' ? `
            <div class="grid-2">
              <div class="kv-box">
                <div class="kv-row"><span class="kv-k">Model</span><span class="kv-v">${esc(snap.board.model)}</span></div>
                <div class="kv-row"><span class="kv-k">Hostname</span><span class="kv-v">${esc(snap.board.hostname)}</span></div>
                <div class="kv-row"><span class="kv-k">Firmware</span><span class="kv-v">${esc(snap.board.firmware)}</span></div>
                <div class="kv-row"><span class="kv-k">Target</span><span class="kv-v">${esc(snap.board.target)}</span></div>
                <div class="kv-row"><span class="kv-k">Kernel</span><span class="kv-v">${esc(snap.board.kernel)}</span></div>
                <div class="kv-row"><span class="kv-k">Uptime</span><span class="kv-v">${esc(fmtUptime(snap.system.uptimeSec))}</span></div>
                <div class="kv-row"><span class="kv-k">Package Manager</span><span class="kv-v">${esc(snap.capabilities.pkg_manager)}</span></div>
              </div>

              <div>
                <h4 style="margin-bottom:10px;">Appearance Theme</h4>
                <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;">
                  <button type="button" class="btn ${state.theme === 'light' ? 'btn-primary' : ''}" data-set-theme="light">Pocket Teal (Default)</button>
                  <button type="button" class="btn ${state.theme === 'dark' ? 'btn-primary' : ''}" data-set-theme="dark">Dark Mode</button>
                  <button type="button" class="btn ${state.theme === 'crimson' ? 'btn-primary' : ''}" data-set-theme="crimson">Crimson</button>
                </div>

                <h4 style="margin-bottom:8px;">Backend Integration Status</h4>
                <div class="kv-box">
                  <div class="kv-row"><span class="kv-k">OpenWrt /ubus</span><span class="kv-v" style="color:var(--good)">Connected</span></div>
                  <div class="kv-row"><span class="kv-k">Pocket-AP Telemetry</span><span class="kv-v" style="color:${snap.pluginOnline ? 'var(--good)' : 'var(--warn)'}">${snap.pluginOnline ? `Active (v${esc(snap.pluginVersion || '0.2')})` : 'Fallback Mode'}</span></div>
                  <div class="kv-row"><span class="kv-k">Hardware Side Switch</span><span class="kv-v">${sw.supported ? `${sw.position.toUpperCase()} (${esc(sw.action)})` : 'Not detected'}</span></div>
                  <div class="kv-row"><span class="kv-k">Uncommitted UCI changes</span><span class="kv-v">${snap.uciChanges.count}</span></div>
                </div>
              </div>
            </div>
          ` : ''}

          ${activeTab === 'switch' ? `
            <div class="grid-2" style="margin-bottom:16px;">
              <div class="metric-card">
                <div class="metric-label">Hardware Side Switch (BTN_0)</div>
                <div style="display:flex; align-items:center; gap:10px; margin-top:4px;">
                  <span class="metric-val">${sw.supported ? (sw.position === 'on' ? 'ON' : sw.position === 'off' ? 'OFF' : 'UNKNOWN') : 'Not Detected'}</span>
                  <span class="pill ${sw.position === 'on' ? 'good' : ''}">${sw.supported ? 'Live GPIO' : 'Unavailable'}</span>
                </div>
                <div class="metric-sub">Current physical slide position on the router side panel.</div>
              </div>

              <div class="metric-card">
                <div class="metric-label">Last Switch Event</div>
                <div class="metric-val" style="font-size:1rem; margin-top:6px;">
                  ${sw.last?.result ? esc(sw.last.result) : 'No toggle recorded since boot'}
                </div>
                <div class="metric-sub">
                  ${sw.last?.at ? `${new Date(sw.last.at * 1000).toLocaleTimeString()} • State: ${esc(sw.last.state).toUpperCase()}` : 'Flip the physical side switch after saving below to test.'}
                </div>
              </div>
            </div>

            <form id="switch-form">
              <div class="field">
                <label for="sw-action">Physical Toggle Switch Function</label>
                <select id="sw-action" name="action">
                  ${SWITCH_ACTIONS.map((a) => `<option value="${a.id}" ${sw.action === a.id ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}
                </select>
                <div class="hint" id="sw-action-desc">
                  ${esc((SWITCH_ACTIONS.find((a) => a.id === sw.action) || SWITCH_ACTIONS[0]).desc)}
                </div>
              </div>

              <div id="sw-wg-opts" style="display:${sw.action === 'vpn_wireguard' ? 'block' : 'none'}; padding:12px 14px; background:var(--surface-alt); border:1px solid var(--border); border-radius:var(--radius-md); margin-bottom:14px;">
                <div class="form-grid">
                  <div class="field">
                    <label for="sw-wg-iface">WireGuard Interface</label>
                    <select id="sw-wg-iface" name="wg_iface">
                      ${wgNames.map((n) => `<option value="${esc(n)}" ${sw.wg_iface === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
                    </select>
                  </div>
                  <div class="field" style="justify-content:center;">
                    <label class="check-row" style="margin-top:14px;">
                      <input type="checkbox" name="vpn_killswitch" ${sw.vpn_killswitch ? 'checked' : ''}>
                      Also toggle VPN Kill-Switch (block non-VPN leaks when ON)
                    </label>
                  </div>
                </div>
              </div>

              <div id="sw-reset-warn" class="banner crit" style="display:${sw.action === 'reset_defaults' ? 'flex' : 'none'};">
                ${icon('alert')}
                <div>
                  <strong>Factory Reset Mode Safety Guard:</strong>
                  When slid <strong>ON</strong>, the router LED will blink rapidly for <strong>5 seconds</strong> before resetting OpenWrt to defaults and rebooting. Slide the switch back <strong>OFF</strong> within 5 seconds to cancel an accidental bump.
                  <label class="check-row" style="margin-top:8px;">
                    <input type="checkbox" id="sw-reset-confirm" ${sw.action === 'reset_defaults' ? 'checked' : ''}>
                    I understand sliding the switch ON for 5 seconds will erase router settings
                  </label>
                </div>
              </div>

              <div class="field" style="margin-top:12px;">
                <label class="check-row">
                  <input type="checkbox" name="invert" ${sw.invert ? 'checked' : ''}>
                  Invert physical ON / OFF switch direction
                </label>
              </div>

              <div style="margin-top:16px; display:flex; justify-content:flex-end;">
                <button type="submit" class="btn btn-primary" id="sw-save" ${!snap.pluginOnline ? 'disabled' : ''}>Save Toggle Switch Action</button>
              </div>
            </form>
          ` : ''}

          ${activeTab === 'admin' ? `
            <div class="grid-2">
              <form id="sys-basic-form">
                <h4 style="margin-bottom:10px;">Device Identity & Time</h4>
                <div class="field">
                  <label for="sys-host">Router Hostname</label>
                  <input id="sys-host" name="hostname" type="text" value="${esc(snap.system.hostname)}" required>
                </div>
                <div class="field">
                  <label for="sys-zone">Timezone Name</label>
                  <input id="sys-zone" name="zonename" type="text" value="${esc(snap.system.zonename)}" placeholder="America/New_York">
                </div>
                <div class="field">
                  <label for="sys-tz">POSIX TZ String</label>
                  <input id="sys-tz" name="timezone" type="text" value="${esc(snap.system.timezone)}" placeholder="UTC / GMT0">
                </div>
                <button type="submit" class="btn btn-primary" style="margin-top:8px;">Save System Settings</button>
              </form>

              <form id="sys-pw-form">
                <h4 style="margin-bottom:10px;">Change Root Administrator Password</h4>
                <p class="hint" style="margin-bottom:10px;">Updates the OpenWrt <code>root</code> password for Pocket-AP, LuCI, and SSH simultaneously.</p>
                <div class="field">
                  <label for="pw-1">New Password</label>
                  <input id="pw-1" name="pw1" type="password" autocomplete="new-password" required minlength="4">
                </div>
                <div class="field">
                  <label for="pw-2">Confirm Password</label>
                  <input id="pw-2" name="pw2" type="password" autocomplete="new-password" required minlength="4">
                </div>
                <button type="submit" class="btn btn-primary" style="margin-top:8px;">Update Root Password</button>
              </form>
            </div>
          ` : ''}

          ${activeTab === 'services' ? `
            <div class="table-wrap">
              <table>
                <thead><tr><th>Service</th><th>Enabled</th><th>State</th><th style="text-align:right;">Controls</th></tr></thead>
                <tbody>
                  ${svcNames.map((name) => {
                    const s = snap.services[name];
                    return `
                      <tr>
                        <td class="mono"><strong>${esc(name)}</strong></td>
                        <td><span class="pill ${s.enabled ? 'good' : ''}">${s.enabled ? 'Enabled' : 'Disabled'}</span></td>
                        <td><span class="pill ${s.running ? 'good' : ''}">${s.running === true ? 'Running' : s.running === false ? 'Stopped' : 'One-shot'}</span></td>
                        <td style="text-align:right; display:flex; gap:6px; justify-content:flex-end;">
                          <button type="button" class="btn btn-sm" data-svc="${esc(name)}" data-act="restart">Restart</button>
                          <button type="button" class="btn btn-sm" data-svc="${esc(name)}" data-act="${s.running ? 'stop' : 'start'}">${s.running ? 'Stop' : 'Start'}</button>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          ` : ''}

          ${activeTab === 'logs' ? `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span class="hint">Recent OpenWrt ring-buffer entries (via <code>log.read</code>)</span>
              <button type="button" class="btn btn-sm" id="btn-reload-logs" ${loadingLogs ? 'disabled' : ''}>${loadingLogs ? 'Loading…' : 'Reload Logs'}</button>
            </div>
            <div class="log-box">${
              sysLogs.length === 0
                ? 'Click "Reload Logs" to fetch the latest system log entries.'
                : esc(sysLogs.map((l) => {
                    const ts = l.time ? new Date(l.time).toLocaleTimeString() : '';
                    return `${ts} ${l.msg || JSON.stringify(l)}`;
                  }).join('\n'))
            }</div>
          ` : ''}
        </div>
      </div>
    `;

    container.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        activeTab = btn.dataset.tab;
        if (activeTab === 'logs' && sysLogs.length === 0) {
          loadingLogs = true;
          this.render(container, state, { refresh });
          sysLogs = await readSystemLog(100);
          loadingLogs = false;
        }
        this.render(container, state, { refresh });
      });
    });

    container.querySelectorAll('[data-set-theme]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setTheme(btn.dataset.setTheme);
        this.render(container, state, { refresh });
      });
    });

    // Hardware Toggle Switch form behavior
    const swSelect = container.querySelector('#sw-action');
    swSelect?.addEventListener('change', () => {
      const val = swSelect.value;
      const meta = SWITCH_ACTIONS.find((a) => a.id === val) || SWITCH_ACTIONS[0];
      const descEl = container.querySelector('#sw-action-desc');
      const wgEl = container.querySelector('#sw-wg-opts');
      const rstEl = container.querySelector('#sw-reset-warn');
      if (descEl) descEl.textContent = meta.desc;
      if (wgEl) wgEl.style.display = val === 'vpn_wireguard' ? 'block' : 'none';
      if (rstEl) rstEl.style.display = val === 'reset_defaults' ? 'flex' : 'none';
    });

    container.querySelector('#switch-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      if (f.action.value === 'reset_defaults') {
        const chk = container.querySelector('#sw-reset-confirm');
        if (!chk?.checked) {
          pushToast('Please confirm the factory reset checkbox before saving.', 'warn');
          return;
        }
      }
      const btn = container.querySelector('#sw-save');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        await saveSwitchConfig({
          action: f.action.value,
          wg_iface: f.wg_iface?.value || 'wg0',
          vpn_killswitch: !!f.vpn_killswitch?.checked,
          invert: !!f.invert?.checked
        });
        pushToast('Hardware toggle switch configuration saved.', 'good');
        refresh();
      } catch (err) {
        pushToast(`Failed to save switch config: ${err.message}`, 'crit');
        btn.disabled = false;
        btn.textContent = 'Save Toggle Switch Action';
      }
    });

    container.querySelector('#sys-basic-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      try {
        await saveSystemSettings(snap.system.sectionId, {
          hostname: f.hostname.value,
          zonename: f.zonename.value,
          timezone: f.timezone.value
        });
        pushToast('System settings saved.', 'good');
        refresh();
      } catch (err) {
        pushToast(err.message, 'crit');
      }
    });

    container.querySelector('#sys-pw-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      if (f.pw1.value !== f.pw2.value) {
        pushToast('Passwords do not match.', 'warn');
        return;
      }
      try {
        await changeRootPassword(f.pw1.value);
        f.reset();
        pushToast('Root password updated for Pocket-AP, LuCI, and SSH.', 'good');
      } catch (err) {
        pushToast(err.message, 'crit');
      }
    });

    container.querySelectorAll('[data-svc]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await controlService(btn.dataset.svc, btn.dataset.act);
          pushToast(`Service ${btn.dataset.svc}: ${btn.dataset.act} complete.`, 'info');
          setTimeout(refresh, 1000);
        } catch (err) {
          pushToast(err.message, 'crit');
          btn.disabled = false;
        }
      });
    });

    container.querySelector('#btn-reload-logs')?.addEventListener('click', async () => {
      loadingLogs = true;
      this.render(container, state, { refresh });
      sysLogs = await readSystemLog(120);
      loadingLogs = false;
      this.render(container, state, { refresh });
    });

    container.querySelector('#btn-reboot')?.addEventListener('click', async () => {
      if (!confirm('Reboot the OpenWrt router now? All active connections will drop for ~45 seconds.')) return;
      try {
        await rebootRouter();
        pushToast('Reboot command sent. Waiting for router to come back online…', 'warn', 8000);
      } catch (err) {
        pushToast(err.message, 'crit');
      }
    });
  },

  onUpdate() {}
};
