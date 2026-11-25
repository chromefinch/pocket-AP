// Hotspot View — Dual-band Access Point configuration, QR code sharing, and LuCI-truthful radio status.

import { esc, icon, wifiQrPayload } from '../utils/dom.js';
import { renderQrSvg } from '../utils/qr.js';
import { saveHotspotRadio, toggleRadioPower, mirrorDualBandHotspot, setBridgedApMode } from '../api/openwrt.js';
import { openRollback, pushToast } from '../state/store.js';

const ENC_OPTIONS = [
  { v: 'sae-mixed', label: 'WPA2 / WPA3 Mixed (Recommended)' },
  { v: 'sae', label: 'WPA3-Personal (SAE)' },
  { v: 'psk2', label: 'WPA2-Personal (PSK)' },
  { v: 'none', label: 'Open (No Password)' }
];

function channelsForBand(band, current) {
  const list = band === '5'
    ? ['auto', '36', '40', '44', '48', '149', '153', '157', '161']
    : band === '6'
      ? ['auto', '1', '5', '9', '13', '17', '21']
      : ['auto', '1', '6', '11', '2', '3', '4', '5', '7', '8', '9', '10'];
  if (current && !list.includes(String(current))) list.splice(1, 0, String(current));
  return list;
}

function htmodesForBand(band, current) {
  const list = band === '5'
    ? ['HE80', 'HE40', 'HE20', 'HE160', 'VHT80', 'VHT40', 'VHT20']
    : ['HE20', 'HE40', 'HT20', 'HT40'];
  if (current && !list.includes(current)) list.unshift(current);
  return list;
}

let activeTab = 'basic';
let selectedRadioId = null;
let showPassword = false;

export const hotspotView = {
  id: 'hotspot',
  title: 'Hotspot',

  render(container, state, { refresh }) {
    const snap = state.snapshot;
    if (!snap) {
      container.innerHTML = `<div class="card"><div class="card-body">Loading wireless radios…</div></div>`;
      return;
    }

    const radios = snap.radios;
    if (!radios.length) {
      container.innerHTML = `<div class="card"><div class="card-body">No Wi-Fi radios detected in OpenWrt UCI wireless config.</div></div>`;
      return;
    }

    if (!selectedRadioId || !radios.some((r) => r.id === selectedRadioId)) {
      selectedRadioId = radios.find((r) => r.band === '5')?.id || radios[0].id;
    }
    const r = radios.find((x) => x.id === selectedRadioId) || radios[0];
    const qrText = wifiQrPayload(r.ssid || 'OpenWrt', r.encryption, r.key, r.hidden);

    container.innerHTML = `
      <!-- Radio Overview Cards (Live Runtime vs Config Truth) -->
      <div class="grid-2" style="margin-bottom:4px;">
        ${radios.map((rad) => {
          const pillCls = !rad.inSync ? 'warn' : rad.runtimeUp ? 'good' : '';
          const pillText = !rad.inSync
            ? (rad.configEnabled ? 'Config ON / Runtime DOWN' : 'Config OFF / Runtime UP')
            : rad.runtimeUp ? `LIVE • ${rad.activeIfname}` : 'OFF';
          return `
            <div class="card" style="cursor:pointer; ${rad.id === r.id ? 'border-color:var(--accent); box-shadow:0 0 0 2px var(--accent-soft);' : ''}" data-select-radio="${esc(rad.id)}">
              <div class="card-header">
                <div class="card-title">${icon('hotspot')} ${esc(rad.bandLabel)} (${esc(rad.id)})</div>
                <span class="pill ${pillCls}">${esc(pillText)}</span>
              </div>
              <div class="card-body" style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
                <div>
                  <div style="font-weight:700; font-size:1rem;">${esc(rad.ssid || '(No SSID)')}</div>
                  <div class="hint">
                    Channel ${esc(rad.liveChannel)} • ${esc(rad.htmode || 'Auto')} • ${rad.clientCount} client${rad.clientCount === 1 ? '' : 's'}
                  </div>
                  ${!rad.inSync ? `
                    <div class="hint" style="color:var(--warn);">
                      Radio disabled=${rad.radioDisabled ? '1' : '0'} • AP (${esc(rad.ifaceId || 'none')}) disabled=${rad.ifaceDisabled ? '1' : '0'}
                    </div>
                  ` : ''}
                </div>
                <button type="button" class="btn btn-sm ${rad.runtimeUp ? 'btn-danger' : 'btn-primary'}" data-toggle-radio="${esc(rad.id)}" data-enable="${rad.runtimeUp ? '0' : '1'}">
                  ${rad.runtimeUp ? 'Stop AP' : 'Start AP'}
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Selected Radio Configuration Card -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">${icon('hotspot')} Configure ${esc(r.bandLabel)} Hotspot — <code>${esc(r.id)}</code></div>
          <span class="pill ${r.runtimeUp ? 'good' : ''}">
            ${r.runtimeUp ? `Live on ${esc(r.activeIfname)} (${esc(r.bssid || 'active')})` : 'Stopped'}
          </span>
        </div>

        <div class="card-body">
          <div class="tabs">
            <button type="button" class="tab-btn ${activeTab === 'basic' ? 'active' : ''}" data-tab="basic">Basic & Security</button>
            <button type="button" class="tab-btn ${activeTab === 'advanced' ? 'active' : ''}" data-tab="advanced">Advanced Radio</button>
            <button type="button" class="tab-btn ${activeTab === 'qr' ? 'active' : ''}" data-tab="qr">QR Code & Share</button>
          </div>

          <form id="hotspot-form">
            <div style="display:${activeTab === 'basic' ? 'block' : 'none'}">
              <div class="field" style="margin-bottom:16px;">
                <label class="switch">
                  <input type="checkbox" name="enabled" ${r.configEnabled ? 'checked' : ''}>
                  <span class="switch-track"></span>
                  <span><strong>Enable ${esc(r.bandLabel)} Access Point</strong> (updates both <code>${esc(r.id)}</code> and <code>${esc(r.ifaceId || 'default_' + r.id)}</code>)</span>
                </label>
              </div>

              <div class="form-grid">
                <div class="field">
                  <label for="hs-ssid">Network Name (SSID)</label>
                  <input id="hs-ssid" name="ssid" type="text" maxlength="32" value="${esc(r.ssid)}" required>
                </div>
                <div class="field">
                  <label for="hs-enc">Security Mode</label>
                  <select id="hs-enc" name="encryption">
                    ${ENC_OPTIONS.map((o) => `<option value="${o.v}" ${r.encryption === o.v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
                  </select>
                </div>
                <div class="field">
                  <label for="hs-key">Wi-Fi Passphrase</label>
                  <div class="input-row">
                    <input id="hs-key" name="key" type="${showPassword ? 'text' : 'password'}" value="${esc(r.key)}" autocomplete="off" placeholder="Minimum 8 characters">
                    <button type="button" class="btn btn-sm" id="hs-toggle-pw">${showPassword ? 'Hide' : 'Show'}</button>
                  </div>
                </div>
                <div class="field">
                  <label for="hs-ch">Channel</label>
                  <select id="hs-ch" name="channel">
                    ${channelsForBand(r.band, r.channel).map((ch) => `<option value="${esc(ch)}" ${String(r.channel) === String(ch) ? 'selected' : ''}>${ch === 'auto' ? 'Auto' : `Channel ${ch}`}</option>`).join('')}
                  </select>
                </div>
                <div class="field">
                  <label for="hs-ht">Channel Width (HT/HE Mode)</label>
                  <select id="hs-ht" name="htmode">
                    ${htmodesForBand(r.band, r.htmode).map((m) => `<option value="${esc(m)}" ${r.htmode === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
                  </select>
                </div>
                <div class="field">
                  <label for="hs-country">Country Code (Regulatory Domain)</label>
                  <input id="hs-country" name="country" type="text" maxlength="2" value="${esc(r.country === '00' ? '' : r.country)}" placeholder="e.g. US, GB, DE, JP">
                  <div class="hint">Set your current country so legal 5 GHz channels unlock properly.</div>
                </div>
              </div>
            </div>

            <div style="display:${activeTab === 'advanced' ? 'block' : 'none'}">
              <div class="form-grid">
                <div class="field">
                  <label for="hs-tx">Transmit Power (dBm)</label>
                  <input id="hs-tx" name="txpower" type="number" min="1" max="30" value="${esc(r.txpower)}" placeholder="Leave blank for driver max${r.liveTxpower != null ? ` (${r.liveTxpower} dBm)` : ''}">
                </div>
                <div class="field">
                  <label>Wireless Features</label>
                  <div style="display:flex; flex-direction:column; gap:8px; padding-top:4px;">
                    <label class="check-row"><input type="checkbox" name="hidden" ${r.hidden ? 'checked' : ''}> Hide SSID from broadcast</label>
                    <label class="check-row"><input type="checkbox" name="isolate" ${r.isolate ? 'checked' : ''}> AP Client Isolation (block client-to-client traffic)</label>
                    <label class="check-row"><input type="checkbox" name="wmm" ${r.wmm ? 'checked' : ''}> WMM (Wi-Fi Multimedia / QoS)</label>
                    <label class="check-row"><input type="checkbox" name="roaming" ${r.roaming ? 'checked' : ''}> 802.11r Fast Transition Roaming</label>
                  </div>
                </div>
              </div>

              <div style="margin-top:16px; padding-top:14px; border-top:1px solid var(--border); display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:14px;">
                <div class="metric-card">
                  <div style="font-weight:700; margin-bottom:6px;">Bridged AP Mode</div>
                  <p class="hint" style="margin-bottom:10px;">
                    In <strong>Routed Travel Mode</strong> (default), Pocket-AP runs its own NAT firewall &amp; DHCP server. Enable <strong>Bridged AP</strong> only when plugging LAN into an existing trusted network.
                  </p>
                  <label class="switch">
                    <input type="checkbox" id="hs-bridged-toggle" ${snap.hotspotSummary.bridgedAp ? 'checked' : ''}>
                    <span class="switch-track"></span>
                    <span><strong>Bridged AP: ${snap.hotspotSummary.bridgedAp ? 'Enabled' : 'Disabled (Routed)'}</strong></span>
                  </label>
                </div>

                ${radios.length > 1 ? `
                  <div class="metric-card">
                    <div style="font-weight:700; margin-bottom:6px;">Sync Dual-Band Travel SSID</div>
                    <p class="hint" style="margin-bottom:10px;">
                      Copy <strong>${esc(r.ssid || 'this radio')}</strong>’s SSID, passphrase, encryption, and power state to all other radios so devices seamlessly roam between 2.4 GHz and 5 GHz.
                    </p>
                    <button type="button" class="btn btn-sm" id="hs-mirror-bands">Mirror ${esc(r.bandShort)} Settings to All Bands</button>
                  </div>
                ` : ''}
              </div>
            </div>

            <div style="display:${activeTab === 'qr' ? 'block' : 'none'}">
              <div style="display:flex; flex-wrap:wrap; gap:20px; align-items:center;">
                <div class="qr-box">${renderQrSvg(qrText, 180)}</div>
                <div>
                  <h3 style="margin-bottom:6px;">Scan to Join ${esc(r.ssid || 'Hotspot')}</h3>
                  <p style="color:var(--text-muted); font-size:0.86rem;">
                    Point your phone or tablet camera at this code to connect directly to the ${esc(r.bandLabel)} travel hotspot.
                  </p>
                  <div class="kv-box" style="max-width:340px;">
                    <div class="kv-row"><span class="kv-k">SSID</span><span class="kv-v">${esc(r.ssid || '—')}</span></div>
                    <div class="kv-row"><span class="kv-k">Security</span><span class="kv-v">${esc(r.encryption)}</span></div>
                    <div class="kv-row"><span class="kv-k">Band</span><span class="kv-v">${esc(r.bandLabel)}</span></div>
                  </div>
                </div>
              </div>
            </div>

            ${activeTab !== 'qr' ? `
              <div style="margin-top:18px; padding-top:14px; border-top:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <span class="hint">Changes apply with OpenWrt's 90-second auto-rollback safety timer.</span>
                <button type="submit" class="btn btn-primary" id="hs-save">Save & Apply Settings</button>
              </div>
            ` : ''}
          </form>
        </div>
      </div>
    `;

    // Radio selector cards
    container.querySelectorAll('[data-select-radio]').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-toggle-radio]')) return;
        selectedRadioId = card.dataset.selectRadio;
        this.render(container, state, { refresh });
      });
    });

    // Quick Start / Stop AP buttons
    container.querySelectorAll('[data-toggle-radio]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const target = radios.find((x) => x.id === btn.dataset.toggleRadio);
        if (!target) return;
        const enable = btn.dataset.enable === '1';
        btn.disabled = true;
        btn.textContent = enable ? 'Starting…' : 'Stopping…';
        try {
          await toggleRadioPower(target, enable);
          openRollback(`${enable ? 'Enable' : 'Disable'} ${target.bandLabel} Hotspot (${target.id})`, 90);
          setTimeout(refresh, 1800);
        } catch (err) {
          pushToast(`Failed to toggle ${target.id}: ${err.message}`, 'crit');
          btn.disabled = false;
        }
      });
    });

    // Tabs
    container.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        this.render(container, state, { refresh });
      });
    });

    // Show/hide password
    container.querySelector('#hs-toggle-pw')?.addEventListener('click', () => {
      showPassword = !showPassword;
      const input = container.querySelector('#hs-key');
      const btn = container.querySelector('#hs-toggle-pw');
      if (input) input.type = showPassword ? 'text' : 'password';
      if (btn) btn.textContent = showPassword ? 'Hide' : 'Show';
    });

    // Bridged AP toggle & Dual-Band Mirror
    container.querySelector('#hs-bridged-toggle')?.addEventListener('change', async (e) => {
      const enable = e.currentTarget.checked;
      try {
        await setBridgedApMode(enable);
        openRollback(enable ? 'Enable Bridged AP mode' : 'Restore Routed Travel AP mode', 90);
        setTimeout(refresh, 2000);
      } catch (err) {
        pushToast(err.message, 'crit');
        e.currentTarget.checked = !enable;
      }
    });

    container.querySelector('#hs-mirror-bands')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Mirroring…';
      try {
        await mirrorDualBandHotspot(r, radios);
        openRollback(`Mirror ${r.ssid} across all Wi-Fi bands`, 90);
        setTimeout(refresh, 2000);
      } catch (err) {
        pushToast(err.message, 'crit');
        btn.disabled = false;
      }
    });

    // Form submit
    container.querySelector('#hotspot-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const btn = container.querySelector('#hs-save');
      btn.disabled = true;
      btn.textContent = 'Applying…';
      try {
        await saveHotspotRadio(r, {
          enabled: f.enabled.checked,
          ssid: f.ssid.value,
          encryption: f.encryption.value,
          key: f.key.value,
          channel: f.channel.value,
          htmode: f.htmode.value,
          country: f.country.value,
          txpower: f.txpower.value,
          hidden: f.hidden.checked,
          isolate: f.isolate.checked,
          wmm: f.wmm.checked,
          roaming: f.roaming.checked
        });
        openRollback(`Update ${r.bandLabel} Hotspot (${r.id})`, 90);
        setTimeout(refresh, 2000);
      } catch (err) {
        pushToast(err.message || 'Failed to save hotspot configuration.', 'crit');
        btn.disabled = false;
        btn.textContent = 'Save & Apply Settings';
      }
    });
  },

  // Do not clobber form inputs during 5s background polling!
  onUpdate() {}
};
