// Ad Blocking View — Built-in dnsmasq custom domain blocker + OpenWrt adblock/adblock-fast/AGH status.

import { esc, icon } from '../utils/dom.js';
import { saveAdblock, controlService } from '../api/openwrt.js';
import { pushToast } from '../state/store.js';

const STARTER_DOMAINS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  'pagead2.googlesyndication.com',
  'ads.facebook.com',
  'an.facebook.com',
  'ads.twitter.com',
  'ads-api.tiktok.com',
  'analytics.tiktok.com',
  'metrics.icloud.com',
  'telemetry.microsoft.com'
];

export const adblockView = {
  id: 'adblock',
  title: 'Ad Blocking',

  render(container, state, { refresh }) {
    const snap = state.snapshot;
    if (!snap) {
      container.innerHTML = `<div class="card"><div class="card-body">Loading ad-blocking status…</div></div>`;
      return;
    }

    const ab = snap.adblock;
    const custom = ab.custom || { enabled: false, count: 0, domains: [] };
    const pm = snap.capabilities.pkg_manager === 'opkg' ? 'opkg install' : 'apk add';

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">${icon('adblock')} Built-in DNS Ad Blocker (dnsmasq)</div>
          <span class="pill ${custom.enabled ? 'good' : ''}">
            ${custom.enabled ? `Blocking ${custom.count} domains` : 'Inactive'}
          </span>
        </div>

        <div class="card-body">
          ${!snap.pluginOnline ? `
            <div class="banner warn">
              <div>
                <strong>Pocket-AP ucode plugin not detected.</strong> Deploy <code>openwrt/files/usr/share/rpcd/ucode/pocket-ap</code> (via <code>./scripts/deploy.sh</code>) to enable built-in dnsmasq domain blocking.
              </div>
            </div>
          ` : ''}

          <form id="ab-form">
            <div class="field" style="margin-bottom:14px;">
              <label class="switch">
                <input type="checkbox" name="enabled" ${custom.enabled ? 'checked' : ''} ${!snap.pluginOnline ? 'disabled' : ''}>
                <span class="switch-track"></span>
                <span><strong>Enable Pocket-AP DNS Blocklist</strong> (writes <code>0.0.0.0</code> / <code>::</code> sinkhole rules to dnsmasq and reloads)</span>
              </label>
            </div>

            <div class="field">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                <label for="ab-domains">Blocked Domains (one per line)</label>
                <button type="button" class="btn btn-sm" id="ab-add-starter">Add Common Ad/Tracker Starter List</button>
              </div>
              <textarea id="ab-domains" name="domains" rows="10" placeholder="doubleclick.net&#10;googlesyndication.com">${esc((custom.domains || []).join('\n'))}</textarea>
              <div class="hint">Subdomains are blocked automatically by dnsmasq (e.g. blocking <code>doubleclick.net</code> blocks <code>*.doubleclick.net</code>).</div>
            </div>

            <div style="margin-top:14px; display:flex; justify-content:flex-end;">
              <button type="submit" class="btn btn-primary" id="ab-save" ${!snap.pluginOnline ? 'disabled' : ''}>Save & Reload dnsmasq</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Full-Scale OpenWrt Blocklist Engines -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">${icon('adblock')} OpenWrt Blocklist Packages</div>
          <span class="pill ${ab.pkgRunning ? 'good' : ''}">${ab.pkgRunning ? 'Active' : 'Optional'}</span>
        </div>
        <div class="card-body">
          <div class="grid-3">
            ${['adblock-fast', 'adblock', 'adguardhome'].map((svc) => {
              const info = snap.services[svc];
              const installed = !!info;
              const running = !!info?.running;
              return `
                <div class="metric-card">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <strong>${esc(svc)}</strong>
                    <span class="pill ${running ? 'good' : ''}">${running ? 'Running' : installed ? 'Stopped' : 'Not installed'}</span>
                  </div>
                  ${installed ? `
                    <div style="display:flex; gap:6px; margin-top:10px;">
                      <button type="button" class="btn btn-sm" data-svc="${esc(svc)}" data-act="${running ? 'stop' : 'start'}">${running ? 'Stop' : 'Start'}</button>
                      <button type="button" class="btn btn-sm" data-svc="${esc(svc)}" data-act="restart">Restart</button>
                    </div>
                  ` : `
                    <div class="hint">Install for large 100k+ community lists:</div>
                    <code style="display:block; margin-top:4px; font-size:0.78rem;">${pm} ${esc(svc)}</code>
                  `}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;

    container.querySelector('#ab-add-starter')?.addEventListener('click', () => {
      const ta = container.querySelector('#ab-domains');
      if (!ta) return;
      const existing = new Set(ta.value.split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean));
      for (const d of STARTER_DOMAINS) existing.add(d);
      ta.value = [...existing].join('\n');
    });

    container.querySelector('#ab-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const btn = container.querySelector('#ab-save');
      btn.disabled = true;
      btn.textContent = 'Applying…';
      const domains = f.domains.value.split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      try {
        const res = await saveAdblock(f.enabled.checked, domains);
        pushToast(res.enabled ? `Ad blocking enabled (${res.count} domains).` : 'Ad blocking disabled.', 'good');
        refresh();
      } catch (err) {
        pushToast(err.message, 'crit');
        btn.disabled = false;
        btn.textContent = 'Save & Reload dnsmasq';
      }
    });

    container.querySelectorAll('[data-svc]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await controlService(btn.dataset.svc, btn.dataset.act);
          pushToast(`Sent ${btn.dataset.act} to ${btn.dataset.svc}.`, 'info');
          setTimeout(refresh, 1000);
        } catch (err) {
          pushToast(err.message, 'crit');
          btn.disabled = false;
        }
      });
    });
  },

  onUpdate() {}
};
