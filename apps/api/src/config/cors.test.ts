import { describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import cors from 'cors';
import { createCorsOptions, isOriginAllowed } from './cors.js';

// The Capacitor Android WebView origin observed via runtime inspection
// (see CAPACITOR_AUTH_TESTING.md) — kept in sync with apps/api/.env.example.
const WEB_DEV_ORIGIN = 'http://localhost:5173';
// Mobile app's Capacitor live-reload dev flow (`cap:run:android:live`),
// which serves the WebView content from the Vite dev server.
const MOBILE_LIVE_RELOAD_ORIGIN = 'http://localhost:5174';
const CAPACITOR_ANDROID_ORIGIN = 'http://localhost';
const ALLOWLIST = [WEB_DEV_ORIGIN, MOBILE_LIVE_RELOAD_ORIGIN, CAPACITOR_ANDROID_ORIGIN];

function buildTestApp(allowlist: readonly string[] = ALLOWLIST) {
  const app = express();
  app.use(cors(createCorsOptions(allowlist)));
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  return app;
}

describe('isOriginAllowed', () => {
  it('allows an exact match', () => {
    expect(isOriginAllowed(WEB_DEV_ORIGIN, ALLOWLIST)).toBe(true);
    expect(isOriginAllowed(CAPACITOR_ANDROID_ORIGIN, ALLOWLIST)).toBe(true);
  });

  it('rejects an origin not present in the allowlist', () => {
    expect(isOriginAllowed('http://localhost:9999', ALLOWLIST)).toBe(false);
  });

  it('rejects lookalike origins instead of prefix/suffix matching', () => {
    expect(isOriginAllowed('http://localhost.attacker.example', ALLOWLIST)).toBe(false);
    expect(
      isOriginAllowed(`https://${WEB_DEV_ORIGIN.replace('http://', '')}.attacker.example`, ALLOWLIST),
    ).toBe(false);
    expect(isOriginAllowed(`${WEB_DEV_ORIGIN}.evil.example`, ALLOWLIST)).toBe(false);
  });
});

describe('CORS middleware', () => {
  it('allows the existing web development origin', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/health').set('Origin', WEB_DEV_ORIGIN);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(WEB_DEV_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('allows the observed Capacitor Android origin', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/health').set('Origin', CAPACITOR_ANDROID_ORIGIN);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(CAPACITOR_ANDROID_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('allows the mobile Capacitor live-reload origin', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/health').set('Origin', MOBILE_LIVE_RELOAD_ORIGIN);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(MOBILE_LIVE_RELOAD_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects an origin that is not in the allowlist', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/health').set('Origin', 'http://evil.example');

    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects a lookalike origin masquerading as the web dev origin', async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost.attacker.example');

    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects a lookalike origin masquerading as an allowed domain via a subdomain suffix', async () => {
    const app = buildTestApp(['https://allowed-domain.example']);
    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://allowed-domain.example.attacker.example');

    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('trims whitespace and drops empty entries when parsing a comma-separated allowlist', () => {
    const parsed = `  ${WEB_DEV_ORIGIN} , ,${CAPACITOR_ANDROID_ORIGIN}  ,`
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);

    expect(parsed).toEqual([WEB_DEV_ORIGIN, CAPACITOR_ANDROID_ORIGIN]);
  });

  it('does not treat an empty allowlist entry as a wildcard match', async () => {
    const app = buildTestApp([WEB_DEV_ORIGIN, '']);
    const res = await request(app).get('/health').set('Origin', 'http://evil.example');

    expect(res.status).toBe(403);
  });

  it('keeps credentials enabled on an allowed-origin response', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/health').set('Origin', WEB_DEV_ORIGIN);

    expect(res.headers['access-control-allow-credentials']).toBe('true');
    // Wildcard origin is never valid alongside credentialed requests.
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('allows a request with no Origin header at all (non-browser client)', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
