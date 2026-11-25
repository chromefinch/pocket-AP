// Non-blocking toast notification renderer.

import { esc } from '../utils/dom.js';
import { dismissToast } from '../state/store.js';

export function renderToasts(toastRoot, toasts) {
  toastRoot.innerHTML = toasts.map((t) => `
    <div class="toast ${esc(t.tone)}" data-toast-id="${t.id}" role="status">
      ${esc(t.message)}
    </div>
  `).join('');

  toastRoot.querySelectorAll('[data-toast-id]').forEach((el) => {
    el.addEventListener('click', () => dismissToast(Number(el.dataset.toastId)));
  });
}
