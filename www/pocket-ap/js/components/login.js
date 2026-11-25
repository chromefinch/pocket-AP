// OpenWrt rpcd session login screen (supports empty root password on fresh flashes).

import { esc, icon } from '../utils/dom.js';
import { login } from '../api/ubus.js';

export function renderLogin(container, onSuccess) {
  container.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-brand">
          <div class="brand-badge">${icon('hotspot', 'icon-lg')}</div>
          <div>
            <h1>Pocket-AP</h1>
            <div class="sub">OpenWrt Travel Router Console</div>
          </div>
        </div>

        <div id="login-error" class="banner crit" style="display:none"></div>

        <form id="login-form">
          <div class="field">
            <label for="login-user">Username</label>
            <input id="login-user" name="username" type="text" value="root" autocomplete="username" required>
          </div>
          <div class="field">
            <label for="login-pass">Password</label>
            <input id="login-pass" name="password" type="password" placeholder="Leave blank if no password is set" autocomplete="current-password" autofocus>
            <div class="hint">Uses your standard OpenWrt / LuCI administrator account.</div>
          </div>
          <div style="margin-top:18px; display:flex; gap:10px; align-items:center; justify-content:space-between;">
            <a href="/cgi-bin/luci/" style="font-size:0.84rem;">Open LuCI instead</a>
            <button id="login-submit" type="submit" class="btn btn-primary">
              ${icon('lock', 'icon-sm')} Sign In
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  const form = container.querySelector('#login-form');
  const errBox = container.querySelector('#login-error');
  const btn = container.querySelector('#login-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Signing in…';

    const username = form.username.value.trim() || 'root';
    const password = form.password.value;

    try {
      await login(username, password);
      onSuccess(username);
    } catch (err) {
      errBox.textContent = err?.code === 6
        ? 'Authentication failed — check username and password.'
        : `Could not reach OpenWrt /ubus: ${err?.message || err}`;
      errBox.style.display = 'flex';
      btn.disabled = false;
      btn.innerHTML = `${icon('lock', 'icon-sm')} Sign In`;
    }
  });
}
