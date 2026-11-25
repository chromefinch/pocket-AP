// Pocket-AP Application Entry Point — Auth bootstrap, RaspAP SB-Admin shell, router, and live 5s polling.

import { MOCK_MODE, restoreSession, logout } from './api/ubus.js';
import { fetchSnapshot } from './api/openwrt.js';
import { getState, setState, subscribe, toggleDarkMode, pushToast } from './state/store.js';

import { renderLogin } from './components/login.js';
import { renderSidebar, bindSidebarEvents } from './components/sidebar.js';
import { renderTopbar, bindTopbarEvents } from './components/topbar.js';
import { renderRollbackModal } from './components/rollback-modal.js';
import { renderToasts } from './components/toast.js';
import { renderPortalBanner } from './components/portal-banner.js';

import { dashboardView } from './views/dashboard.js';
import { hotspotView } from './views/hotspot.js';
import { wifiClientView } from './views/wifi-client.js';
import { dhcpView } from './views/dhcp.js';
import { networkingView } from './views/networking.js';
import { vpnView } from './views/vpn.js';
import { adblockView } from './views/adblock.js';
import { dataUsageView } from './views/data-usage.js';
import { systemView } from './views/system.js';
import { luciView } from './views/luci.js';

const VIEWS = {
  dashboard: dashboardView,
  hotspot: hotspotView,
  'wifi-client': wifiClientView,
  dhcp: dhcpView,
  networking: networkingView,
  vpn: vpnView,
  adblock: adblockView,
  'data-usage': dataUsageView,
  system: systemView,
  luci: luciView
};

const appRoot = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast-root');

let activeView = null;
let pollTimer = null;
let shellMounted = false;
let prevPortalActive = false;

function currentView(route) {
  return VIEWS[route] || VIEWS.dashboard;
}

async function refreshSnapshot(silent = false) {
  const st = getState();
  if (!st.auth.loggedIn || st.loading) return;
  if (!silent) setState({ loading: true }, 'loading');
  try {
    const snapshot = await fetchSnapshot();
    const nowPortalActive = !!snapshot?.portal?.active;
    if (prevPortalActive && !nowPortalActive) {
      const reason = snapshot?.portal?.last_reason;
      if (reason === 'connected') {
        pushToast('Internet connected! Captive portal exception automatically closed and security settings restored.', 'good', 7000);
      } else if (reason === 'timeout') {
        pushToast('Captive portal timer expired — security safeguards automatically restored.', 'info', 6000);
      }
    }
    prevPortalActive = nowPortalActive;
    setState({ snapshot, loading: false, lastError: null }, silent ? 'poll' : 'snapshot');
  } catch (err) {
    setState({ loading: false, lastError: err.message }, 'error');
    if (!silent) pushToast(`Sync failed: ${err.message}`, 'crit');
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && getState().auth.loggedIn) {
      refreshSnapshot(true);
    }
  }, 5000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function mountShell() {
  appRoot.innerHTML = `
    <div class="app-shell" id="app-shell">
      <div id="topbar-mount"></div>
      <div class="body-frame">
        <div id="sidebar-mount"></div>
        <div class="main-col">
          <main class="content">
            <div id="portal-banner-mount"></div>
            <div id="view-mount"></div>
          </main>
        </div>
      </div>
    </div>
  `;
  shellMounted = true;
}

function updateChrome(state) {
  const shellEl = document.getElementById('app-shell');
  if (shellEl) {
    shellEl.classList.toggle('sidebar-collapsed', !!state.sidebarCollapsed);
  }
  const sidebarMount = document.getElementById('sidebar-mount');
  const topbarMount = document.getElementById('topbar-mount');
  const portalBannerMount = document.getElementById('portal-banner-mount');
  if (portalBannerMount) {
    renderPortalBanner(portalBannerMount, state, { refresh: () => refreshSnapshot(false) });
  }
  if (sidebarMount) {
    sidebarMount.innerHTML = renderSidebar(state);
    bindSidebarEvents(sidebarMount, () => setState({ sidebarOpen: false }, 'sidebar'));
  }
  if (topbarMount) {
    topbarMount.innerHTML = renderTopbar(state);
    bindTopbarEvents(topbarMount, {
      onToggleSidebar: () => {
        if (window.innerWidth <= 820) {
          setState({ sidebarOpen: !getState().sidebarOpen }, 'sidebar');
        } else {
          setState({ sidebarCollapsed: !getState().sidebarCollapsed }, 'sidebar');
        }
      },
      onRefresh: () => refreshSnapshot(false),
      onToggleDark: () => toggleDarkMode(),
      onLogout: async () => {
        stopPolling();
        await logout();
        shellMounted = false;
        activeView?.cleanup?.();
        activeView = null;
        setState({
          auth: { checked: true, loggedIn: false, username: null, mock: MOCK_MODE },
          snapshot: null
        }, 'auth');
      }
    });
  }
}

function renderActiveView(state, isBackgroundPoll = false) {
  const viewMount = document.getElementById('view-mount');
  if (!viewMount) return;
  const nextView = currentView(state.route);
  const ctx = { refresh: () => refreshSnapshot(false) };

  if (activeView !== nextView) {
    activeView?.cleanup?.();
    activeView = nextView;
    activeView.render(viewMount, state, ctx);
  } else if (isBackgroundPoll && typeof activeView.onUpdate === 'function') {
    activeView.onUpdate(viewMount, state, ctx);
  } else {
    activeView.render(viewMount, state, ctx);
  }
}

subscribe((state, reason) => {
  if (reason === 'toast') {
    renderToasts(toastRoot, state.toasts);
    return;
  }
  if (reason === 'rollback') {
    renderRollbackModal(modalRoot, state.rollback, () => refreshSnapshot(false));
    return;
  }

  if (!state.auth.checked) return;

  if (!state.auth.loggedIn) {
    stopPolling();
    shellMounted = false;
    activeView?.cleanup?.();
    activeView = null;
    renderLogin(appRoot, async (username) => {
      setState({
        auth: { checked: true, loggedIn: true, username, mock: MOCK_MODE }
      }, 'auth');
      await refreshSnapshot(false);
      startPolling();
    });
    return;
  }

  if (!shellMounted) mountShell();
  updateChrome(state);

  if (reason === 'poll') {
    renderActiveView(state, true);
  } else if (['auth', 'route', 'snapshot', 'error'].includes(reason)) {
    renderActiveView(state, false);
  }
});

// Boot sequence
(async function boot() {
  const user = await restoreSession();
  if (user) {
    setState({ auth: { checked: true, loggedIn: true, username: user, mock: MOCK_MODE } }, 'auth');
    await refreshSnapshot(false);
    startPolling();
  } else {
    setState({ auth: { checked: true, loggedIn: false, username: null, mock: MOCK_MODE } }, 'auth');
  }
})();
