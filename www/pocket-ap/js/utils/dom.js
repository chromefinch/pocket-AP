// Safe DOM helpers and human-readable formatters.

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${esc(name)}"></use></svg>`;
}

export function fmtBytes(bytes) {
  const b = Number(bytes || 0);
  if (!Number.isFinite(b) || b <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let val = b;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val >= 100 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

export function fmtRate(bytesPerSec) {
  const bps = Number(bytesPerSec || 0) * 8;
  if (!Number.isFinite(bps) || bps <= 0) return '0 bps';
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps'];
  let idx = 0;
  let val = bps;
  while (val >= 1000 && idx < units.length - 1) {
    val /= 1000;
    idx++;
  }
  return `${val >= 100 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

export function fmtUptime(sec) {
  const s = Math.max(0, Math.floor(Number(sec || 0)));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

export function fmtLeaseRemaining(sec) {
  const s = Number(sec || 0);
  if (s <= 0) return 'Expired';
  if (s > 31536000) return 'Static';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function cidrToNetmask(prefix) {
  const n = Number(prefix);
  if (!Number.isInteger(n) || n < 0 || n > 32) return '255.255.255.0';
  const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
  return [(mask >>> 24) & 255, (mask >>> 16) & 255, (mask >>> 8) & 255, mask & 255].join('.');
}

export function dbmToBars(dbm) {
  const n = Number(dbm);
  if (!Number.isFinite(n) || n === 0) return 0;
  if (n >= -55) return 4;
  if (n >= -67) return 3;
  if (n >= -77) return 2;
  return 1;
}

export function renderSignalBars(dbm) {
  const bars = dbmToBars(dbm);
  const cls = bars >= 3 ? '' : bars === 2 ? 'warn' : 'crit';
  const items = [1, 2, 3, 4].map((i) => `<i class="${i <= bars ? 'on' : ''}"></i>`).join('');
  return `<span class="sig-bars ${cls}" title="${esc(dbm)} dBm">${items}</span>`;
}

export function isTruthy(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'yes';
}

export function wifiQrPayload(ssid, encryption, key, hidden = false) {
  const q = (s) => String(s ?? '').replace(/([\\;,:"])/g, '\\$1');
  const t = !encryption || encryption === 'none' ? 'nopass' : 'WPA';
  return `WIFI:T:${t};S:${q(ssid)};P:${t === 'nopass' ? '' : q(key)};H:${hidden ? 'true' : 'false'};;`;
}
