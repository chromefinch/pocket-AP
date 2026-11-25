// Global Captive Portal Exception Banner — makes temporary portal relaxation unmistakable
// and provides 1-click Start / Open Login Page / Restore Safeguards controls across all screens.

import { esc, icon } from '../utils/dom.js';
import { startPortalMode, stopPortalMode, probePortalMode } from '../api/openwrt.js';
import { pushToast } from '../state/store.js';

function fmtRem(sec) {
  const s = Math.max(0, Math.floor(Number(sec || 0)));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${String(r).padStart(2, '0')}s`;
}

function safePortalUrl(url) {
  if (url && /^https?:\/\/[^\s"'<>]+$/i.test(url)) return url;
  return 'http://neverssl.com/';
}

export function renderPortalBanner(mount, state, { refresh }) {
  const snap = state.snapshot;
  const p = snap?.portal;
  if (!mount || !p) {
    if (mount) mount.innerHTML = '';
    return;
  }

  // Case 1: Temporary Captive Portal Exception is ACTIVE
  if (p.active) {
    const loginUrl = safePortalUrl(p.portal_url);
    const pills = [
      'DNS Rebind OFF',
      p.wwan_dns ? `WWAN DNS: ${p.wwan_dns}` : 'Using DHCP DNS',
      p.wwan_search ? `Domain: ${p.wwan_search}` : null,
      p.route_switched ? 'Routing via WWAN' : null,
      p.adblock_paused ? 'Adblock Paused' : null,
      p.killswitch_paused ? 'VPN Kill-Switch Paused' : null
    ].filter(Boolean);

    mount.innerHTML = `
      <div class="portal-exception-banner active" role="alert">
        <div class="portal-banner-head">
          <div style="display:flex; align-items:center; gap:9px; flex-wrap:wrap;">
            <span class="portal-pulse-dot"></span>
            <strong>CAPTIVE PORTAL LOGIN EXCEPTION ACTIVE</strong>
            <span class="pill warn">Auto-reverts when online • ${esc(fmtRem(p.remaining_sec))} left</span>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <a class="btn btn-sm btn-primary" href="${esc(loginUrl)}" target="_blank" rel="noopener noreferrer">
              ${icon('external', 'icon-sm')} Open Portal Login Page
            </a>
            <button type="button" class="btn btn-sm" id="pb-probe">${icon('refresh', 'icon-sm')} Check Now</button>
            <button type="button" class="btn btn-sm btn-danger" id="pb-stop">Restore Protection Now</button>
          </div>
        </div>
        <div class="portal-banner-body">
          <span>Temporary travel exception running on router (watching every 5s for internet access):</span>
          <div class="portal-pills">
            ${pills.map((x) => `<span class="pill warn">${esc(x)}</span>`).join('')}
          </div>
        </div>
      </div>
    `;

    mount.querySelector('#pb-probe')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        await probePortalMode();
        refresh();
      } catch (err) {
        pushToast(err.message, 'crit');
      }
    });

    mount.querySelector('#pb-stop')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Restoring…';
      try {
        await stopPortalMode();
        pushToast('Captive portal exception ended — DNS Rebind Protection & safeguards restored.', 'good');
        refresh();
      } catch (err) {
        pushToast(`Restore failed: ${err.message}`, 'crit');
        btn.disabled = false;
        btn.textContent = 'Restore Protection Now';
      }
    });
    return;
  }

  // Case 2: Captive Portal Detected on active WWAN (not yet in Login Mode)
  const needsPortal = p.wwan_up && (p.portal_detected || (p.wwan_search && !p.online && p.probe_at > 0));
  if (needsPortal) {
    mount.innerHTML = `
      <div class="portal-exception-banner detected" role="status">
        <div class="portal-banner-head">
          <div style="display:flex; align-items:center; gap:9px; flex-wrap:wrap;">
            ${icon('alert')}
            <strong>Captive Portal Detected on WWAN</strong>
            ${p.wwan_search ? `<span class="pill info">${esc(p.wwan_search)}</span>` : ''}
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="btn btn-sm btn-primary" id="pb-start">
              Enable Captive Portal Login Mode
            </button>
          </div>
        </div>
        <div class="portal-banner-body">
          Temporarily allows private-IP hotel/guest DNS (<code>${esc(p.wwan_search || p.wwan_dns || 'wwan')}</code>), pauses Adblock/Kill-Switch, and <strong>automatically restores all safeguards</strong> the moment you finish signing in.
        </div>
      </div>
    `;

    mount.querySelector('#pb-start')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Starting…';
      try {
        const res = await startPortalMode(600);
        pushToast('Captive Portal Login Mode active! Sign in now — safeguards will auto-restore once connected.', 'warn', 6000);
        const url = safePortalUrl(res?.portal_url);
        window.open(url, '_blank', 'noopener,noreferrer');
        refresh();
      } catch (err) {
        pushToast(`Could not start portal mode: ${err.message}`, 'crit');
        btn.disabled = false;
        btn.textContent = 'Enable Captive Portal Login Mode';
      }
    });
    return;
  }

  mount.innerHTML = '';
}
