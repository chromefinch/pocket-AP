// Lightweight reactive store for Pocket-AP UI state.

const THEME_KEY = 'pocket-ap-theme';

function loadTheme() {
  const q = new URLSearchParams(location.search).get('theme');
  if (q === 'light' || q === 'dark' || q === 'crimson') return q;
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark' || t === 'crimson') return t;
  } catch { /* ignore */ }
  return 'light';
}

const state = {
  auth: {
    checked: false,
    loggedIn: false,
    username: null,
    mock: false
  },
  route: (location.hash.replace(/^#/, '') || 'dashboard'),
  theme: loadTheme(),
  sidebarOpen: false,
  sidebarCollapsed: false,
  snapshot: null,
  loading: false,
  lastError: null,
  rollback: null, // { label, deadlineMs, startedAt }
  toasts: []
};

const listeners = new Set();

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(reason = 'update') {
  for (const fn of listeners) {
    try { fn(state, reason); } catch (e) { console.error('[store listener]', e); }
  }
}

export function setState(patch, reason = 'update') {
  Object.assign(state, patch);
  emit(reason);
}

export function setTheme(theme) {
  const valid = ['light', 'dark', 'crimson'].includes(theme) ? theme : 'light';
  state.theme = valid;
  document.documentElement.setAttribute('data-theme', valid);
  try { localStorage.setItem(THEME_KEY, valid); } catch { /* ignore */ }
  emit('theme');
}

export function toggleDarkMode() {
  setTheme(state.theme === 'dark' ? 'light' : 'dark');
}

export function cycleTheme() {
  const order = ['light', 'dark', 'crimson'];
  const next = order[(order.indexOf(state.theme) + 1) % order.length];
  setTheme(next);
}

export function navigate(route) {
  const clean = (route || 'dashboard').replace(/^#/, '');
  state.sidebarOpen = false;
  if (location.hash.replace(/^#/, '') !== clean) {
    location.hash = clean;
  } else if (state.route !== clean) {
    state.route = clean;
    emit('route');
  } else {
    emit('sidebar');
  }
}

window.addEventListener('hashchange', () => {
  state.route = location.hash.replace(/^#/, '') || 'dashboard';
  state.sidebarOpen = false;
  emit('route');
});

let toastSeq = 1;
export function pushToast(message, tone = 'info', durationMs = 4200) {
  const id = toastSeq++;
  state.toasts = [...state.toasts, { id, message, tone }];
  emit('toast');
  if (durationMs > 0) {
    setTimeout(() => dismissToast(id), durationMs);
  }
}

export function dismissToast(id) {
  state.toasts = state.toasts.filter((t) => t.id !== id);
  emit('toast');
}

export function openRollback(label, timeoutSec = 90) {
  state.rollback = {
    label,
    timeoutSec,
    deadlineMs: Date.now() + timeoutSec * 1000
  };
  emit('rollback');
}

export function closeRollback() {
  state.rollback = null;
  emit('rollback');
}

// Apply persisted theme immediately on load
document.documentElement.setAttribute('data-theme', state.theme);
