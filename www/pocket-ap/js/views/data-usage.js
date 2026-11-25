// Data Usage & Live Throughput View — Zero-dependency SVG traffic graph via luci.getRealtimeStats.

import { esc, icon, fmtBytes, fmtRate } from '../utils/dom.js';
import { getRealtimeStats } from '../api/openwrt.js';

let selectedDev = '';
let pollHandle = null;

function buildRates(points) {
  // luci.getRealtimeStats returns [[timestamp, rx_bytes, rx_pkts, tx_bytes, tx_pkts], ...]
  if (!Array.isArray(points) || points.length < 2) return [];
  const rates = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const dt = Math.max(1, Number(cur[0]) - Number(prev[0]));
    const rx = Math.max(0, (Number(cur[1]) - Number(prev[1])) / dt);
    const tx = Math.max(0, (Number(cur[3]) - Number(prev[3])) / dt);
    rates.push({ t: Number(cur[0]), rx, tx });
  }
  return rates;
}

function renderTrafficSvg(rates) {
  if (!rates.length) {
    return `<div style="padding:42px 0; text-align:center; color:var(--text-dim);">Waiting for realtime traffic samples…</div>`;
  }
  const W = 720, H = 200, padL = 12, padR = 12, padT = 14, padB = 22;
  const maxVal = Math.max(12500, ...rates.map((r) => Math.max(r.rx, r.tx))) * 1.12;
  const xAt = (i) => padL + (i / Math.max(1, rates.length - 1)) * (W - padL - padR);
  const yAt = (v) => padT + (1 - v / maxVal) * (H - padT - padB);

  const rxLine = rates.map((r, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(r.rx).toFixed(1)}`).join(' ');
  const txLine = rates.map((r, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(r.tx).toFixed(1)}`).join(' ');
  const baseY = (H - padB).toFixed(1);
  const rxArea = `${rxLine} L${xAt(rates.length - 1).toFixed(1)},${baseY} L${xAt(0).toFixed(1)},${baseY} Z`;

  return `
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Live interface throughput">
      <line x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}" stroke="var(--border)" stroke-dasharray="4 4"/>
      <line x1="${padL}" y1="${((padT + H - padB) / 2).toFixed(1)}" x2="${W - padR}" y2="${((padT + H - padB) / 2).toFixed(1)}" stroke="var(--border)" stroke-dasharray="4 4"/>
      <line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="var(--border-strong)"/>
      <path d="${rxArea}" fill="var(--accent-soft)"/>
      <path d="${rxLine}" fill="none" stroke="var(--accent)" stroke-width="2.4"/>
      <path d="${txLine}" fill="none" stroke="var(--warn)" stroke-width="2" stroke-dasharray="5 3"/>
      <text x="${padL + 4}" y="${padT + 12}" fill="var(--text-dim)" font-size="11" font-family="var(--font-mono)">Peak: ${esc(fmtRate(maxVal))}</text>
    </svg>
  `;
}

export const dataUsageView = {
  id: 'data-usage',
  title: 'Data Usage',

  cleanup() {
    if (pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  },

  render(container, state) {
    this.cleanup();
    const snap = state.snapshot;
    if (!snap) {
      container.innerHTML = `<div class="card"><div class="card-body">Loading interface traffic counters…</div></div>`;
      return;
    }

    const devs = Object.values(snap.netDevs || {}).filter((d) => d && d.name && d.name !== 'lo');
    if (!selectedDev || !devs.some((d) => d.name === selectedDev)) {
      selectedDev = devs.find((d) => d.name === snap.publicNet.iface)?.name ||
                    devs.find((d) => d.name === 'br-lan')?.name ||
                    devs[0]?.name || 'br-lan';
    }

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">${icon('chart')} Live Interface Throughput</div>
          <div style="display:flex; gap:8px; align-items:center;">
            <label for="du-dev" class="hint" style="margin:0;">Device:</label>
            <select id="du-dev" style="width:auto; min-width:140px;">
              ${devs.map((d) => `<option value="${esc(d.name)}" ${d.name === selectedDev ? 'selected' : ''}>${esc(d.name)} ${d.up ? '(up)' : '(down)'}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="card-body">
          <div style="display:flex; gap:18px; flex-wrap:wrap; margin-bottom:12px;">
            <div><span class="pill accent">RX Download</span> <strong class="mono" id="du-rx-now">—</strong></div>
            <div><span class="pill warn">TX Upload</span> <strong class="mono" id="du-tx-now">—</strong></div>
          </div>
          <div class="chart-wrap" id="du-chart">
            <div style="padding:42px 0; text-align:center; color:var(--text-dim);">Loading live samples for <code>${esc(selectedDev)}</code>…</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">${icon('network')} Cumulative Session Transfer (Since Boot)</div>
        </div>
        <div class="card-body">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Device</th><th>Status</th><th>Type</th><th>Received (RX)</th><th>Transmitted (TX)</th><th>Total</th></tr></thead>
              <tbody id="du-totals">
                ${devs.map((d) => {
                  const rx = d.stats?.rx_bytes || 0;
                  const tx = d.stats?.tx_bytes || 0;
                  return `
                    <tr>
                      <td class="mono"><strong>${esc(d.name)}</strong></td>
                      <td><span class="pill ${d.up ? 'good' : ''}">${d.up ? 'UP' : 'DOWN'}</span></td>
                      <td>${d.wireless ? 'Wireless' : 'Ethernet / Bridge'}</td>
                      <td class="mono">${fmtBytes(rx)}</td>
                      <td class="mono">${fmtBytes(tx)}</td>
                      <td class="mono"><strong>${fmtBytes(rx + tx)}</strong></td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    const fetchChart = async () => {
      try {
        const res = await getRealtimeStats('interface', selectedDev);
        const rates = buildRates(res?.result ?? []);
        const chartEl = container.querySelector('#du-chart');
        const rxEl = container.querySelector('#du-rx-now');
        const txEl = container.querySelector('#du-tx-now');
        if (chartEl) chartEl.innerHTML = renderTrafficSvg(rates);
        const last = rates[rates.length - 1];
        if (rxEl) rxEl.textContent = last ? fmtRate(last.rx) : '0 bps';
        if (txEl) txEl.textContent = last ? fmtRate(last.tx) : '0 bps';
      } catch { /* ignore transient error */ }
    };

    container.querySelector('#du-dev')?.addEventListener('change', (e) => {
      selectedDev = e.target.value;
      fetchChart();
    });

    fetchChart();
    pollHandle = setInterval(fetchChart, 2500);
  },

  onUpdate() {}
};
