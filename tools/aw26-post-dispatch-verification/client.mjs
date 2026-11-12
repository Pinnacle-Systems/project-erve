// Minimal authenticated HTTP client for the AW26 verification scripts (Node 24 native fetch; no test framework).
// Refuses any base URL that is not loopback so evidence can never be produced against a shared environment.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function requireLoopback(base) {
  const host = new URL(base).hostname;
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host))
    throw new Error(`Refusing non-loopback API base: ${base}`);
  return base.replace(/\/$/, '');
}

export function createClient(base) {
  const root = requireLoopback(base);
  const trace = [];
  async function call(method, route, { token, json, form, key, headers = {}, raw = false } = {}) {
    const init = { method, headers: { ...headers } };
    if (token) init.headers.Authorization = `Bearer ${token}`;
    if (method !== 'GET' && key !== false) init.headers['Idempotency-Key'] = key ?? randomUUID();
    if (json !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(json);
    }
    if (form) init.body = form;
    const response = await fetch(`${root}${route}`, init);
    const buffer = Buffer.from(await response.arrayBuffer());
    let body;
    const type = response.headers.get('content-type') ?? '';
    if (!raw && type.includes('json')) body = JSON.parse(buffer.toString('utf8'));
    trace.push({ method, route, status: response.status, at: new Date().toISOString() });
    return { status: response.status, body, buffer, headers: response.headers };
  }
  async function expect(status, method, route, options) {
    const result = await call(method, route, options);
    if (result.status !== status) {
      const detail = result.body
        ? JSON.stringify(result.body.error ?? result.body).slice(0, 600)
        : result.buffer.toString('utf8').slice(0, 300);
      throw new Error(`${method} ${route}: expected ${status}, got ${result.status}: ${detail}`);
    }
    return result.body ? result.body.data : result.buffer;
  }
  async function login(identifier, password) {
    const data = await expect(200, 'POST', '/auth/login', {
      json: { identifier, password },
      key: false,
    });
    return data.accessToken;
  }
  return { call, expect, login, trace, root };
}

export const readSecret = (file) => readFileSync(file, 'utf8').replace(/\r?\n+$/, '');
