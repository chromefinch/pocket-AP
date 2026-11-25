// Lockout-prevention confirmation modal for OpenWrt `uci.apply({ rollback: true })`.

import { esc, icon } from '../utils/dom.js';
import { uciConfirm, uciRollback } from '../api/ubus.js';
import { closeRollback, pushToast } from '../state/store.js';

let timerHandle = null;

export function renderRollbackModal(modalRoot, rollback, onAfterConfirmOrRevert) {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }

  if (!rollback) {
    modalRoot.innerHTML = '';
    return;
  }

  const remainingSec = () => Math.max(0, Math.ceil((rollback.deadlineMs - Date.now()) / 1000));

  modalRoot.innerHTML = `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rb-title">
      <div class="modal-card">
        <div class="modal-header">
          <div class="card-title" id="rb-title">${icon('alert')} Confirm Router Changes</div>
          <span class="pill warn" id="rb-countdown">${remainingSec()}s</span>
        </div>
        <div class="modal-body">
          <p><strong>${esc(rollback.label)}</strong> has been applied to OpenWrt.</p>
          <p style="color:var(--text-muted); font-size:0.86rem;">
            To prevent travel-router lockouts, OpenWrt will automatically roll back to the previous working configuration when the timer reaches 0 unless you confirm below.
          </p>
          <div class="meter">
            <div class="meter-fill warn" id="rb-bar" style="width:100%"></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn" id="rb-revert">Revert Now</button>
          <button class="btn btn-primary" id="rb-confirm">Keep Changes</button>
        </div>
      </div>
    </div>
  `;

  const cdEl = modalRoot.querySelector('#rb-countdown');
  const barEl = modalRoot.querySelector('#rb-bar');
  const btnConfirm = modalRoot.querySelector('#rb-confirm');
  const btnRevert = modalRoot.querySelector('#rb-revert');

  timerHandle = setInterval(() => {
    const rem = remainingSec();
    if (cdEl) cdEl.textContent = `${rem}s`;
    if (barEl) barEl.style.width = `${Math.max(0, Math.min(100, (rem / rollback.timeoutSec) * 100))}%`;
    if (rem <= 0) {
      clearInterval(timerHandle);
      timerHandle = null;
      closeRollback();
      pushToast('Rollback timer elapsed — router reverted to previous config.', 'warn', 6000);
      onAfterConfirmOrRevert();
    }
  }, 500);

  btnConfirm.addEventListener('click', async () => {
    btnConfirm.disabled = true;
    btnConfirm.textContent = 'Confirming…';
    try {
      await uciConfirm();
      closeRollback();
      pushToast('Changes confirmed and saved permanently.', 'good');
      onAfterConfirmOrRevert();
    } catch (e) {
      pushToast(`Confirm failed (router may still be restarting Wi-Fi — retry in a moment): ${e.message}`, 'warn', 6000);
      btnConfirm.disabled = false;
      btnConfirm.textContent = 'Keep Changes';
    }
  });

  btnRevert.addEventListener('click', async () => {
    btnRevert.disabled = true;
    btnRevert.textContent = 'Reverting…';
    try {
      await uciRollback();
      closeRollback();
      pushToast('Reverted to previous router configuration.', 'info');
      onAfterConfirmOrRevert();
    } catch (e) {
      pushToast(`Rollback request failed: ${e.message}`, 'crit');
      btnRevert.disabled = false;
      btnRevert.textContent = 'Revert Now';
    }
  });
}
