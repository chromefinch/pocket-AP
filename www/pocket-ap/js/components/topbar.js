// Authentic RaspAP Top Navbar (SB-Admin style) with Dark Mode switch, sync status, and GL.iNet-style LuCI shortcut.

import { esc, icon } from '../utils/dom.js';
import { navigate } from '../state/store.js';

export function renderTopbar(state) {
  const snap = state.snapshot;
  const pending = snap?.uciChanges?.count || 0;
  const host = snap?.board?.hostname || '';
  const isDark = state.theme === 'dark';

  return `
    <header class="topbar">
      <div class="topbar-left">
        <a href="#dashboard" class="navbar-brand" data-nav="dashboard">
          <span class="brand-badge">${icon('hotspot')}</span>
          <span>Pocket-AP</span>
        </a>
        <button class="btn btn-ghost btn-icon" data-action="toggle-sidebar" title="Toggle sidebar" aria-label="Toggle sidebar">
          ${icon('menu')}
        </button>
        ${host ? `<span class="pill">${esc(host)}</span>` : ''}
        ${pending > 0 ? `
          <span class="pill warn" title="Uncommitted UCI changes detected (e.g. from LuCI)">
            ${icon('alert', 'icon-sm')} ${pending} pending UCI
          </span>
        ` : ''}
      </div>

      <div class="topbar-right">
        <button class="btn btn-sm" data-action="refresh" ${state.loading ? 'disabled' : ''} title="Sync live state from OpenWrt">
          ${icon('refresh', 'icon-sm')}
          <span>${state.loading ? 'Syncing…' : 'Sync'}</span>
        </button>

        <button class="btn btn-sm ${state.route === 'luci' ? 'btn-primary' : ''}" data-nav="luci" title="Open LuCI Advanced Settings">
          ${icon('sliders', 'icon-sm')}
          <span>LuCI</span>
        </button>

        <label class="switch" title="Toggle Dark Mode" style="margin:0 2px;">
          <input type="checkbox" data-action="toggle-dark" ${isDark ? 'checked' : ''}>
          <span class="switch-track"></span>
          ${icon(isDark ? 'sun' : 'moon', 'icon-sm')}
        </label>

        <button class="btn btn-sm btn-ghost" data-action="logout" title="Sign out (${esc(state.auth.username || 'root')})">
          ${icon('logout', 'icon-sm')}
        </button>
      </div>
    </header>
  `;
}

export function bindTopbarEvents(root, handlers) {
  root.querySelector('[data-action="toggle-sidebar"]')?.addEventListener('click', handlers.onToggleSidebar);
  root.querySelector('[data-action="refresh"]')?.addEventListener('click', handlers.onRefresh);
  root.querySelector('[data-action="toggle-dark"]')?.addEventListener('change', handlers.onToggleDark);
  root.querySelector('[data-action="logout"]')?.addEventListener('click', handlers.onLogout);
  root.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(el.dataset.nav);
    });
  });
}
