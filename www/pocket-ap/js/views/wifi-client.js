// Wi-Fi Client (Travel Repeater) View — RaspAP Card-Grid Wi-Fi Manager + Saved Profiles + Hotel Captive Portal Toolkit.

import { esc, icon, fmtUptime, renderSignalBars } from '../utils/dom.js';
import {
  scanWifiNetworks, joinWifiRepeater, disconnectWifiRepeater, runDiagnostic,
  saveWifiProfiles, setDnsRebindProtection, cloneMacAddress,
  startPortalMode, stopPortalMode, probePortalMode
} from '../api/openwrt.js';
import { openRollback, pushToast } from '../state/store.js';

let scanResults = [];
let scanning = false;
let scanError = '';
let portalResult = null;
let activeTab = 'nearby'; // 'nearby' | 'saved' | 'portal'

function randomLocallyAdministeredMac() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  bytes[0] = (bytes[0] & 0xfe) | 0x02; // unicast + locally administered
  return [...bytes].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

export const wifiClientView = {
  id: 'wifi-client',
  title: 'Wi-Fi Client',

  render(container, state, { refresh }) {
    const snap = state.snapshot;
    if (!snap) {
      container.innerHTML = `<div class="card"><div class="card-body">Loading Wi-Fi client status…</div></div>`;
      return;
    }

    const sta = snap.sta;
    const portal = snap.portal || { active: false };
    const savedProfiles = snap.travel?.wifiProfiles ?? [];
    const ownSsids = new Set(snap.radios.map((r) => r.ssid).filter(Boolean));
    const rebindOn = snap.travel?.rebindProtection !== false;

    const findSaved = (ssid, radioId) =>
      savedProfiles.find((p) => p.ssid === ssid && (!radioId || p.radioId === radioId)) ||
      savedProfiles.find((p) => p.ssid === ssid) || null;

    container.innerHTML = `
      <!-- Active Repeater Uplink Banner Card -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">${icon('wifi')} Wi-Fi Client (Travel Repeater)</div>
          <div style="display:flex; gap:8px; align-items:center;">
            <span class="pill ${sta.wwanUp ? 'good' : sta.configured ? 'warn' : ''}">
              ${sta.wwanUp ? `Connected: ${esc(sta.ssid)}` : sta.configured ? (sta.disabled ? 'Disconnected' : 'Connecting…') : 'Idle'}
            </span>
            <button type="button" class="btn btn-sm" id="btn-scan" ${scanning ? 'disabled' : ''}>
              ${scanning ? '<span class="spinner spinner-sm"></span> Scanning…' : `${icon('refresh', 'icon-sm')} Scan Nearby`}
            </button>
          </div>
        </div>

        <div class="card-body">
          ${sta.configured ? `
            <div class="grid-2" style="margin-bottom:14px;">
              <div class="kv-box">
                <div class="kv-row"><span class="kv-k">Upstream SSID</span><span class="kv-v">${esc(sta.ssid || '—')}</span></div>
                <div class="kv-row"><span class="kv-k">Radio / Iface</span><span class="kv-v">${esc(sta.device || '—')} ${sta.ifname ? `(${esc(sta.ifname)})` : ''}</span></div>
                <div class="kv-row"><span class="kv-k">Signal</span><span class="kv-v">${sta.signal ? `${renderSignalBars(sta.signal)} ${sta.signal} dBm` : '—'}</span></div>
              </div>
              <div class="kv-box">
                <div class="kv-row"><span class="kv-k">WWAN IPv4</span><span class="kv-v">${esc(sta.ipv4 || 'Pending DHCP')}</span></div>
                <div class="kv-row"><span class="kv-k">Gateway</span><span class="kv-v">${esc(sta.gateway || '—')}</span></div>
                <div class="kv-row"><span class="kv-k">Uptime</span><span class="kv-v">${sta.wwanUp ? esc(fmtUptime(sta.uptime)) : '—'}</span></div>
              </div>
            </div>

            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;">
              ${portal.active ? `
                <button type="button" class="btn btn-sm btn-danger" id="btn-portal-stop">Restore Protection Now</button>
              ` : `
                <button type="button" class="btn btn-sm btn-primary" id="btn-portal-start">Start Captive Portal Login Mode</button>
              `}
              <button type="button" class="btn btn-sm" id="btn-portal-check">Check Internet / Portal</button>
              <a class="btn btn-sm" href="${esc((portal.portal_url && /^https?:\/\//i.test(portal.portal_url)) ? portal.portal_url : 'http://neverssl.com/')}" target="_blank" rel="noopener noreferrer">${icon('external', 'icon-sm')} Open Hotel Login</a>
              <button type="button" class="btn btn-sm" id="btn-sta-disable" ${sta.disabled ? 'disabled' : ''}>Disconnect</button>
              <button type="button" class="btn btn-sm btn-danger" id="btn-sta-forget">Forget Active</button>
            </div>
          ` : ''}

          ${portalResult ? `
            <div class="banner ${portalResult.ok ? 'good' : portalResult.captive_suspected ? 'warn' : 'crit'}">
              <div>
                <strong>${portalResult.ok ? 'Online — No Captive Portal' : portalResult.captive_suspected ? 'Captive Portal Detected' : 'No Internet Response'}:</strong>
                ${portalResult.ok
                  ? 'Direct internet reachability verified.'
                  : (portalResult.portal_url && /^https?:\/\//i.test(portalResult.portal_url))
                    ? `Redirected to <a href="${esc(portalResult.portal_url)}" target="_blank" rel="noopener noreferrer">${esc(portalResult.portal_url)}</a>. Click <strong>Start Captive Portal Login Mode</strong> to temporarily allow hotel DNS and auto-restore once signed in.`
                    : 'Click <strong>Start Captive Portal Login Mode</strong> above to pin WWAN DNS, pause rebind/adblock temporarily, and auto-revert once signed in.'}
              </div>
            </div>
          ` : ''}

          <div class="tabs">
            <button type="button" class="tab-btn ${activeTab === 'nearby' ? 'active' : ''}" data-tab="nearby">Nearby Networks (${scanResults.length})</button>
            <button type="button" class="tab-btn ${activeTab === 'saved' ? 'active' : ''}" data-tab="saved">Known Networks (${savedProfiles.length})</button>
            <button type="button" class="tab-btn ${activeTab === 'portal' ? 'active' : ''}" data-tab="portal">Captive Portal & MAC Clone</button>
          </div>

          <!-- TAB 1: RaspAP-style Nearby Wi-Fi Card Grid -->
          ${activeTab === 'nearby' ? `
            ${scanError ? `<div class="banner crit">${esc(scanError)}</div>` : ''}
            ${scanResults.length === 0 ? `
              <p style="color:var(--text-muted);">
                ${scanning
                  ? 'Scanning 2.4 GHz and 5 GHz bands via OpenWrt iwinfo…'
                  : 'Click <strong>Scan Nearby</strong> above to discover nearby hotel, airport, or cafe Wi-Fi networks.'}
              </p>
            ` : `
              <div class="card-grid">
                ${scanResults.map((n, idx) => {
                  const isOwn = ownSsids.has(n.ssid);
                  const isConnected = sta.wwanUp && sta.ssid === n.ssid;
                  const saved = findSaved(n.ssid, n.radioId);
                  return `
                    <form class="wifi-card ${isConnected ? 'connected' : ''}" data-join-idx="${idx}">
                      <div class="wifi-card-head">
                        <div class="wifi-card-ssid" title="${esc(n.ssid)}">${icon('wifi', 'icon-sm')} ${esc(n.ssid)}</div>
                        ${isConnected
                          ? '<span class="pill good">Connected</span>'
                          : isOwn
                            ? '<span class="pill warn">Own AP</span>'
                            : saved
                              ? '<span class="pill accent">Saved</span>'
                              : ''}
                      </div>

                      <div class="wifi-meta-grid">
                        <div class="wifi-meta-k">Band / Ch</div><div>${esc(n.bandLabel)} • Ch ${esc(n.channel)}</div>
                        <div class="wifi-meta-k">RSSI</div><div>${renderSignalBars(n.signal)} <span class="mono">${n.signal} dBm</span></div>
                        <div class="wifi-meta-k">Security</div><div>${n.locked ? esc(n.encDesc) : 'Open'}</div>
                      </div>

                      <div class="field" style="margin-bottom:4px;">
                        <label>Passphrase</label>
                        <div class="input-row">
                          <input type="password" name="key" autocomplete="off" value="${esc(saved?.key || '')}" ${!n.locked || isOwn ? 'disabled' : ''} placeholder="${isOwn ? 'This router’s own hotspot' : n.locked ? 'Enter passphrase' : 'Open network'}">
                          ${n.locked && !isOwn ? `<button type="button" class="btn btn-sm btn-icon" data-eye title="Show/hide">${icon('eye', 'icon-sm')}</button>` : ''}
                        </div>
                      </div>

                      <div class="wifi-card-actions">
                        <button type="submit" class="btn btn-sm btn-primary" ${isOwn ? 'disabled' : ''}>
                          ${isConnected ? 'Reconnect' : 'Connect'}
                        </button>
                        <button type="button" class="btn btn-sm" data-save-idx="${idx}" ${isOwn ? 'disabled' : ''}>
                          ${saved ? 'Update' : 'Save'}
                        </button>
                      </div>
                    </form>
                  `;
                }).join('')}
              </div>
            `}
          ` : ''}

          <!-- TAB 2: Saved / Known Travel Wi-Fi Profiles -->
          ${activeTab === 'saved' ? `
            ${savedProfiles.length === 0 ? `
              <p style="color:var(--text-muted);">
                No saved networks yet. Whenever you Connect or Save a network from the Nearby tab, Pocket-AP stores it here so you can jump between hotel, cafe, and office Wi-Fi in one click.
              </p>
            ` : `
              <div class="card-grid">
                ${savedProfiles.map((p, idx) => {
                  const isConnected = sta.wwanUp && sta.ssid === p.ssid;
                  return `
                    <div class="wifi-card ${isConnected ? 'connected' : ''}">
                      <div class="wifi-card-head">
                        <div class="wifi-card-ssid">${icon('wifi', 'icon-sm')} ${esc(p.ssid)}</div>
                        <span class="pill ${isConnected ? 'good' : 'accent'}">${isConnected ? 'Active' : esc(p.bandLabel || p.radioId)}</span>
                      </div>
                      <div class="wifi-meta-grid">
                        <div class="wifi-meta-k">Radio</div><div class="mono">${esc(p.radioId)}</div>
                        <div class="wifi-meta-k">Security</div><div>${p.locked ? esc(p.encryption) : 'Open'}</div>
                      </div>
                      <div class="wifi-card-actions">
                        <button type="button" class="btn btn-sm btn-primary" data-connect-saved="${idx}">${isConnected ? 'Reconnect' : 'Connect'}</button>
                        <button type="button" class="btn btn-sm btn-danger" data-del-saved="${idx}">Delete</button>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          ` : ''}

          <!-- TAB 3: Hotel Captive Portal & MAC Cloning Toolkit -->
          ${activeTab === 'portal' ? `
            <div class="metric-card" style="margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
              <div>
                <h4 style="margin-bottom:4px;">Automatic Captive Portal Login Mode (Recommended)</h4>
                <p class="hint" style="margin:0;">
                  One click temporarily turns off DNS Rebind Protection, routes &amp; pins <code>wwan</code> DHCP DNS (e.g. <code>${esc(portal.wwan_search || portal.wwan_dns || 'hotel guest DNS')}</code>), pauses Adblock/Kill-Switch, and runs a router-side watchdog that <strong>automatically switches everything back</strong> the moment internet connects (or after 10 minutes).
                </p>
              </div>
              <div>
                ${portal.active ? `
                  <button type="button" class="btn btn-danger" id="btn-portal-stop-tab">Restore Protection Now</button>
                ` : `
                  <button type="button" class="btn btn-primary" id="btn-portal-start-tab">Start Captive Portal Login Mode</button>
                `}
              </div>
            </div>

            <div class="grid-2">
              <div class="metric-card">
                <h4 style="margin-bottom:8px;">DNS Rebind Protection (Captive Portal Fix)</h4>
                <p class="hint" style="margin-bottom:12px;">
                  Many hotel and airport captive portals redirect to private IPs (<code>10.x.x.x</code> / <code>192.168.x.x</code>), which OpenWrt's default DNS rebind protection blocks. Turn this OFF temporarily while signing into a hotel portal, then turn it back ON afterwards.
                </p>
                <label class="switch">
                  <input type="checkbox" id="toggle-rebind" ${rebindOn ? 'checked' : ''}>
                  <span class="switch-track"></span>
                  <span><strong>DNS Rebind Protection: ${rebindOn ? 'Enabled (Secure)' : 'Disabled (Portal Compatible)'}</strong></span>
                </label>
              </div>

              <div class="metric-card">
                <h4 style="margin-bottom:8px;">MAC Address Cloning (Hotel / Flight Wi-Fi)</h4>
                <p class="hint" style="margin-bottom:10px;">
                  If you already authenticated on a phone or laptop, clone its MAC address onto Pocket-AP's <code>wwan</code> (repeater) or <code>wan</code> (ethernet) interface so all your travel devices share the pass.
                </p>
                <form id="mac-clone-form">
                  <div class="field">
                    <label>Target Uplink Interface</label>
                    <select name="iface" id="mac-iface">
                      <option value="wwan">Wi-Fi Repeater (wwan)${snap.travel?.wwanMacaddr ? ` — Current: ${esc(snap.travel.wwanMacaddr)}` : ''}</option>
                      <option value="wan">Ethernet WAN (wan)${snap.travel?.wanMacaddr ? ` — Current: ${esc(snap.travel.wanMacaddr)}` : ''}</option>
                    </select>
                  </div>
                  <div class="field">
                    <label>MAC Address (leave blank to restore factory MAC)</label>
                    <div class="input-row">
                      <input type="text" name="mac" id="mac-input" value="${esc(snap.travel?.wwanMacaddr || '')}" placeholder="AA:BB:CC:DD:EE:FF">
                      <button type="button" class="btn btn-sm" id="btn-rand-mac">Random</button>
                    </div>
                  </div>
                  ${snap.clients.length > 0 ? `
                    <div class="field">
                      <label>Or pick a connected device’s MAC</label>
                      <select id="mac-client-pick">
                        <option value="">— Select connected device —</option>
                        ${snap.clients.map((c) => `<option value="${esc(c.mac)}">${esc(c.hostname)} (${esc(c.mac)})</option>`).join('')}
                      </select>
                    </div>
                  ` : ''}
                  <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px;">
                    <button type="button" class="btn btn-sm" id="btn-clear-mac">Restore Factory</button>
                    <button type="submit" class="btn btn-sm btn-primary">Apply Cloned MAC</button>
                  </div>
                </form>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    // Tabs
    container.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        this.render(container, state, { refresh });
      });
    });

    // Scan button
    container.querySelector('#btn-scan')?.addEventListener('click', async () => {
      scanning = true;
      scanError = '';
      activeTab = 'nearby';
      this.render(container, state, { refresh });
      try {
        scanResults = await scanWifiNetworks(snap.radios);
        if (!scanResults.length) scanError = 'Scan completed, but no visible SSIDs were found.';
      } catch (err) {
        scanError = err.message || 'Scan failed.';
      } finally {
        scanning = false;
        this.render(container, state, { refresh });
      }
    });

    // Eye password toggles inside RaspAP cards
    container.querySelectorAll('[data-eye]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = btn.closest('.input-row')?.querySelector('input');
        if (input) input.type = input.type === 'password' ? 'text' : 'password';
      });
    });

    // Helper to upsert profile in /etc/pocket-ap/wifi-profiles.json
    const upsertProfile = async (net, key) => {
      const next = savedProfiles.filter((p) => !(p.ssid === net.ssid && p.radioId === net.radioId));
      next.unshift({
        ssid: net.ssid,
        radioId: net.radioId,
        bandLabel: net.bandLabel,
        encryption: net.locked ? net.encryption : 'none',
        key: net.locked ? key : '',
        locked: !!net.locked,
        bssid: net.bssid || '',
        savedAt: Math.floor(Date.now() / 1000)
      });
      await saveWifiProfiles(next).catch(() => {});
    };

    // Connect from Nearby card
    container.querySelectorAll('[data-join-idx]').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const net = scanResults[Number(form.dataset.joinIdx)];
        if (!net) return;
        const key = form.key.value;
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Connecting…';
        try {
          await upsertProfile(net, key);
          await joinWifiRepeater(net, key);
          openRollback(`Join upstream Wi-Fi "${net.ssid}"`, 90);
          setTimeout(refresh, 2500);
        } catch (err) {
          pushToast(err.message || 'Failed to join network.', 'crit');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Connect';
        }
      });
    });

    // Save without immediately connecting
    container.querySelectorAll('[data-save-idx]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.saveIdx);
        const net = scanResults[idx];
        const form = btn.closest('form');
        if (!net || !form) return;
        await upsertProfile(net, form.key.value);
        pushToast(`Saved "${net.ssid}" to Known Networks.`, 'good');
        refresh();
      });
    });

    // Connect / Delete Saved profiles
    container.querySelectorAll('[data-connect-saved]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const p = savedProfiles[Number(btn.dataset.connectSaved)];
        if (!p) return;
        btn.disabled = true;
        btn.textContent = 'Connecting…';
        try {
          await joinWifiRepeater(p, p.key || '');
          openRollback(`Switch Wi-Fi repeater to "${p.ssid}"`, 90);
          setTimeout(refresh, 2500);
        } catch (err) {
          pushToast(err.message, 'crit');
          btn.disabled = false;
          btn.textContent = 'Connect';
        }
      });
    });

    container.querySelectorAll('[data-del-saved]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.delSaved);
        const next = savedProfiles.filter((_, i) => i !== idx);
        await saveWifiProfiles(next);
        pushToast('Removed network from Known Networks.', 'info');
        refresh();
      });
    });

    // Automatic Captive Portal Login Mode Start / Stop
    const onStartPortal = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Starting…';
      try {
        const res = await startPortalMode(600);
        pushToast('Captive Portal Login Mode active! Complete hotel login — safeguards auto-restore once online.', 'warn', 6500);
        const loginUrl = (res?.portal_url && /^https?:\/\//i.test(res.portal_url)) ? res.portal_url : 'http://neverssl.com/';
        window.open(loginUrl, '_blank', 'noopener,noreferrer');
        refresh();
      } catch (err) {
        pushToast(`Failed to start portal mode: ${err.message}`, 'crit');
        btn.disabled = false;
        btn.textContent = 'Start Captive Portal Login Mode';
      }
    };
    const onStopPortal = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Restoring…';
      try {
        await stopPortalMode();
        pushToast('Captive portal exception ended — security settings restored.', 'good');
        refresh();
      } catch (err) {
        pushToast(err.message, 'crit');
        btn.disabled = false;
      }
    };
    container.querySelector('#btn-portal-start')?.addEventListener('click', onStartPortal);
    container.querySelector('#btn-portal-start-tab')?.addEventListener('click', onStartPortal);
    container.querySelector('#btn-portal-stop')?.addEventListener('click', onStopPortal);
    container.querySelector('#btn-portal-stop-tab')?.addEventListener('click', onStopPortal);

    // Captive portal probe
    container.querySelector('#btn-portal-check')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Checking…';
      try {
        await probePortalMode().catch(() => {});
        portalResult = await runDiagnostic('portal_check', '');
        refresh();
      } catch (err) {
        portalResult = { ok: false, captive_suspected: false, output: err.message };
      }
      this.render(container, state, { refresh });
    });

    // Disconnect / Forget active STA
    container.querySelector('#btn-sta-disable')?.addEventListener('click', async () => {
      try {
        await disconnectWifiRepeater(sta.sectionId, false);
        openRollback('Disconnect upstream Wi-Fi repeater', 90);
        setTimeout(refresh, 1800);
      } catch (err) {
        pushToast(err.message, 'crit');
      }
    });

    container.querySelector('#btn-sta-forget')?.addEventListener('click', async () => {
      if (!confirm(`Forget active upstream Wi-Fi "${sta.ssid}"?`)) return;
      try {
        await disconnectWifiRepeater(sta.sectionId, true);
        openRollback(`Forget upstream Wi-Fi "${sta.ssid}"`, 90);
        setTimeout(refresh, 1800);
      } catch (err) {
        pushToast(err.message, 'crit');
      }
    });

    // DNS Rebind Protection toggle
    container.querySelector('#toggle-rebind')?.addEventListener('change', async (e) => {
      const en = e.currentTarget.checked;
      try {
        await setDnsRebindProtection(snap.dhcp.dnsmasqId, en);
        pushToast(en ? 'DNS Rebind Protection enabled.' : 'DNS Rebind Protection disabled for captive portal login.', 'good');
        refresh();
      } catch (err) {
        pushToast(err.message, 'crit');
        e.currentTarget.checked = !en;
      }
    });

    // MAC Clone controls
    const macInput = container.querySelector('#mac-input');
    const macIface = container.querySelector('#mac-iface');
    macIface?.addEventListener('change', () => {
      if (!macInput) return;
      macInput.value = macIface.value === 'wan' ? (snap.travel?.wanMacaddr || '') : (snap.travel?.wwanMacaddr || '');
    });
    container.querySelector('#mac-client-pick')?.addEventListener('change', (e) => {
      if (e.target.value && macInput) macInput.value = e.target.value;
    });
    container.querySelector('#btn-rand-mac')?.addEventListener('click', () => {
      if (macInput) macInput.value = randomLocallyAdministeredMac();
    });
    container.querySelector('#btn-clear-mac')?.addEventListener('click', async () => {
      if (!macIface) return;
      try {
        await cloneMacAddress(macIface.value, '');
        openRollback(`Restore factory MAC on ${macIface.value}`, 90);
        setTimeout(refresh, 1800);
      } catch (err) {
        pushToast(err.message, 'crit');
      }
    });
    container.querySelector('#mac-clone-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      try {
        await cloneMacAddress(f.iface.value, f.mac.value);
        openRollback(`Clone MAC ${f.mac.value || '(factory)'} on ${f.iface.value}`, 90);
        setTimeout(refresh, 1800);
      } catch (err) {
        pushToast(err.message, 'crit');
      }
    });
  },

  onUpdate() {}
};
