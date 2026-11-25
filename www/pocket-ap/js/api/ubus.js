// Low-level OpenWrt /ubus JSON-RPC 2.0 client with session & UCI staging/rollback safety.

import { mockUbusCall } from './mock.js';
import { setState } from '../state/store.js';

const UBUS_URL = '/ubus';
const NULL_SESSION = '00000000000000000000000000000000';
const SESSION_KEY = 'pocket-ap-session';

const UBUS_STATUS = [
  'OK', 'INVALID_COMMAND', 'INVALID_ARGUMENT', 'METHOD_NOT_FOUND', 'NOT_FOUND',
  'NO_DATA', 'PERMISSION_DENIED', 'TIMEOUT', 'NOT_SUPPORTED', 'UNKNOWN', 'CONNECTION_FAILED'
];

export const MOCK_MODE =
  new URLSearchParams(location.search).get('mock') === '1' ||
  window.__POCKET_AP_MOCK__ === true;

let sessionId = loadStoredSession();
let rpcSeq = 1;
const stagedConfigs = new Set();

function loadStoredSession() {
  if (MOCK_MODE) return NULL_SESSION;
  try {
    const id = sessionStorage.getItem(SESSION_KEY);
    if (id && /^[0-9a-f]{32}$/i.test(id)) return id;
  } catch { /* private mode */ }
  return NULL_SESSION;
}

export function setSession(id) {
  sessionId = id || NULL_SESSION;
  try {
    if (id && id !== NULL_SESSION) sessionStorage.setItem(SESSION_KEY, id);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
}

export function getSession() {
  return sessionId;
}

export class UbusError extends Error {
  constructor(code, message, object = '', method = '') {
    super(message);
    this.name = 'UbusError';
    this.code = code;
    this.object = object;
    this.method = method;
  }
}

export async function ubusCall(object, method, params = {}) {
  if (MOCK_MODE) {
    await new Promise((r) => setTimeout(r, 35));
    return mockUbusCall(object, method, params);
  }

  const res = await fetch(UBUS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: rpcSeq++,
      method: 'call',
      params: [sessionId, object, method, params]
    })
  });

  if (!res.ok) throw new UbusError(-1, `HTTP ${res.status}`, object, method);
  const payload = await res.json();

  if (payload.error) {
    throw await handleDenial(
      new UbusError(payload.error.code ?? -1, payload.error.message ?? 'RPC error', object, method),
      object
    );
  }

  const result = payload.result;
  if (Array.isArray(result)) {
    const [status, data] = result;
    if (status !== 0) {
      throw await handleDenial(
        new UbusError(status, UBUS_STATUS[status] ?? `ubus status ${status}`, object, method),
        object
      );
    }
    return data;
  }
  return result;
}

export async function ubusList(pattern = '*') {
  if (MOCK_MODE) return {};
  const res = await fetch(UBUS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: rpcSeq++,
      method: 'list',
      params: [sessionId, pattern]
    })
  });
  if (!res.ok) throw new UbusError(-1, `HTTP ${res.status}`, pattern, 'list');
  const payload = await res.json();
  if (payload.error) throw new UbusError(payload.error.code ?? -1, payload.error.message ?? 'RPC error');
  return (payload.result && typeof payload.result === 'object') ? payload.result : {};
}

async function handleDenial(err, object) {
  const isDenial = err.code === 6 || err.code === -32002;
  if (!isDenial || object === 'session' || sessionId === NULL_SESSION) return err;
  try {
    await ubusCall('session', 'access', {});
    return err; // Live session -> genuine ACL denial
  } catch {
    setSession(NULL_SESSION);
    setState({
      auth: { checked: true, loggedIn: false, username: null, mock: MOCK_MODE }
    }, 'auth');
    return new UbusError(err.code, 'Session expired. Please sign in again.', object, err.method);
  }
}

export async function login(username, password) {
  const prev = sessionId;
  sessionId = NULL_SESSION;
  try {
    const data = await ubusCall('session', 'login', {
      username: username || 'root',
      password: password ?? '',
      timeout: 3600
    });
    setSession(data.ubus_rpc_session);
    return data;
  } catch (e) {
    setSession(prev);
    throw e;
  }
}

export async function restoreSession() {
  if (MOCK_MODE) {
    const data = await login('root', '');
    return data?.data?.username || 'root';
  }
  if (sessionId === NULL_SESSION) return null;
  try {
    await ubusCall('session', 'access', {});
    const info = await ubusCall('session', 'get', {}).catch(() => null);
    return info?.values?.username || 'root';
  } catch {
    setSession(NULL_SESSION);
    return null;
  }
}

export async function logout() {
  try {
    if (sessionId !== NULL_SESSION) await ubusCall('session', 'destroy', {});
  } catch { /* ignore */ }
  setSession(NULL_SESSION);
}

// ---- UCI Helpers with Safe Staging & Rollback ------------------------------

export function uciGet(config, section) {
  return ubusCall('uci', 'get', section ? { config, section } : { config });
}

export function uciChanges(config) {
  return ubusCall('uci', 'changes', config ? { config } : {});
}

async function discardStaged() {
  const configs = [...stagedConfigs];
  stagedConfigs.clear();
  for (const config of configs) {
    try { await ubusCall('uci', 'revert', { config }); } catch { /* ignore */ }
  }
}

async function stage(config, promise) {
  stagedConfigs.add(config);
  try {
    return await promise;
  } catch (e) {
    await discardStaged();
    throw e;
  }
}

export function uciSet(config, section, values) {
  return stage(config, ubusCall('uci', 'set', { config, section, values }));
}

export function uciAdd(config, type, name, values = {}) {
  const params = name ? { config, type, name, values } : { config, type, values };
  return stage(config, ubusCall('uci', 'add', params));
}

export function uciDelete(config, section, option) {
  stagedConfigs.add(config);
  const params = option ? { config, section, option } : { config, section };
  return ubusCall('uci', 'delete', params);
}

export async function uciApply() {
  try {
    const res = await ubusCall('uci', 'apply', { rollback: false });
    stagedConfigs.clear();
    return res;
  } catch (e) {
    await discardStaged();
    throw e;
  }
}

export async function uciApplyRollback(timeout = 95) {
  try {
    const res = await ubusCall('uci', 'apply', { rollback: true, timeout });
    stagedConfigs.clear();
    return res;
  } catch (e) {
    await discardStaged();
    throw e;
  }
}

export function uciConfirm() {
  return ubusCall('uci', 'confirm', {});
}

export function uciRollback() {
  return ubusCall('uci', 'rollback', {});
}

export function uciRevert(config) {
  return ubusCall('uci', 'revert', config ? { config } : {});
}
