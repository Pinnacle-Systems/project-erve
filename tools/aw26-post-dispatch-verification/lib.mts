// Shared helpers for the AW26 operational verification (HTTP-only mutations, prisma for READ lookups).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createClient, readSecret } from './client.mjs';
import { prisma } from '../../apps/api/src/db/prisma.js';
import { requireSafeTestDatabaseUrl } from '../../apps/api/src/test/database-safety.js';

requireSafeTestDatabaseUrl({ testDatabaseUrl: process.env.DATABASE_URL });
export { prisma };
export const WS = process.env.AW26_WORKSPACE!;
export const cfg = JSON.parse(readFileSync(path.join(WS, 'scenario-config.json'), 'utf8'));
export const api = createClient(process.env.AW26_API ?? 'http://127.0.0.1:4080');
const runtime = path.join(WS, '06-test-fixtures', 'runtime');
const evidence = path.join(WS, '07-technical-evidence');
mkdirSync(path.join(evidence, 'api'), { recursive: true });
mkdirSync(path.join(evidence, 'test-results'), { recursive: true });

// ---------------------------------------------------------------- state
const statePath = path.join(runtime, 'state.json');
export const state: Record<string, any> = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, 'utf8'))
  : { tokens: {}, ids: {} };
export const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));

// ---------------------------------------------------------------- matrix
export type Status = 'PASS' | 'FAIL' | 'BLOCKED' | 'INFO';
const matrixPath = path.join(evidence, 'test-results', 'matrix.json');
export const matrix: {
  id: string;
  area: string;
  scenario: string;
  status: Status;
  detail: string;
  at: string;
}[] = existsSync(matrixPath) ? JSON.parse(readFileSync(matrixPath, 'utf8')) : [];
export function record(id: string, area: string, scenario: string, status: Status, detail = '') {
  const existing = matrix.findIndex((m) => m.id === id);
  const row = {
    id,
    area,
    scenario,
    status,
    detail: String(detail).slice(0, 700),
    at: new Date().toISOString(),
  };
  if (existing >= 0) matrix[existing] = row;
  else matrix.push(row);
  writeFileSync(matrixPath, JSON.stringify(matrix, null, 2));
  console.log(`[${status}] ${id} ${scenario}${detail ? ' — ' + String(detail).slice(0, 160) : ''}`);
}
/** Assert an HTTP outcome and record it. */
export async function expectStatus(
  id: string,
  area: string,
  scenario: string,
  want: number | number[],
  p: Promise<{ status: number; body?: any }>,
) {
  const r = await p;
  const wants = Array.isArray(want) ? want : [want];
  record(
    id,
    area,
    scenario,
    wants.includes(r.status) ? 'PASS' : 'FAIL',
    `HTTP ${r.status}${wants.includes(r.status) ? '' : ' (wanted ' + wants.join('/') + '): ' + JSON.stringify(r.body?.error ?? '').slice(0, 200)}`,
  );
  return r;
}
export function dump(name: string, data: unknown) {
  writeFileSync(path.join(evidence, 'api', `${name}.json`), JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------- actors
const PASSWORDS = path.join(runtime, 'actor-passwords.json'); // disposable, outside git
export async function adminToken() {
  state.tokens.ADMIN = await api.login(
    process.env.AW26_ADMIN ?? 'admin.aw26@erve.test',
    readSecret(path.join(runtime, 'admin-password.txt')),
  );
  return state.tokens.ADMIN as string;
}
export async function ensureUser(
  admin: string,
  key: string,
  name: string,
  roles: string[],
  extra: { factoryId?: string; distributorId?: string } = {},
) {
  const passwords: Record<string, { email: string; password: string }> = existsSync(PASSWORDS)
    ? JSON.parse(readFileSync(PASSWORDS, 'utf8'))
    : {};
  if (!passwords[key]) {
    passwords[key] = {
      email: `${key.toLowerCase()}@aw26.erve.test`,
      password: 'Aw26-' + randomBytes(9).toString('hex'),
    };
    writeFileSync(PASSWORDS, JSON.stringify(passwords, null, 2));
    const created = await api.expect(201, 'POST', '/users', {
      token: admin,
      json: {
        name,
        email: passwords[key].email,
        password: passwords[key].password,
        roles,
        ...(extra.factoryId ? { factoryId: extra.factoryId } : {}),
      },
    });
    if (extra.distributorId)
      await api.expect(200, 'POST', `/users/${created.id}/distributors`, {
        token: admin,
        json: { distributorId: extra.distributorId },
      });
    state.ids[`user:${key}`] = created.id;
  }
  state.tokens[key] = await api.login(passwords[key].email, passwords[key].password);
  save();
  return state.tokens[key] as string;
}

// ---------------------------------------------------------------- quality payload (same rule the server derives outcome from)
type Component = { id: string; type: string; config: Record<string, any> };
const key = (v: any) => (typeof v === 'string' ? v : String(v.key));
export function passingQualityPayload(execution: any, date: string, quantity: number) {
  const payload: any = {
    expectedVersion: execution.version,
    checklistResponses: [],
    aqlResults: [],
    defects: [],
    correctiveActions: [],
    testResults: [],
    quantities: [],
    comments: [],
    fieldResponses: [],
    attendees: [],
    actions: [],
    signoffs: [],
    outcome: undefined,
  };
  const value = (f: any) =>
    f.dataType === 'DATE'
      ? date
      : f.dataType === 'NUMBER'
        ? String(quantity)
        : f.dataType === 'BOOLEAN'
          ? 'true'
          : 'AW26 UAT fixture';
  for (const c of execution.sections.flatMap((s: any) => s.components) as Component[]) {
    const cfg = c.config;
    if (c.type === 'CHECKLIST')
      for (const i of cfg.items)
        payload.checklistResponses.push({
          componentId: c.id,
          itemKey: i.key,
          response:
            cfg.responseOptions.find((o: string) => ['PASSED', 'YES', 'PASS'].includes(o)) ??
            cfg.responseOptions[0],
        });
    if (c.type === 'AQL_RESULT')
      for (const k of cfg.criteria ?? [])
        payload.aqlResults.push({
          componentId: c.id,
          severity: k.severity,
          maxAllowed: 0,
          found: 0,
        });
    if (c.type === 'TEST_RESULTS')
      for (const t of cfg.tests ?? [])
        payload.testResults.push({ componentId: c.id, testKey: t.key, response: 'PASSED' });
    if (c.type === 'QUANTITY_RECONCILIATION')
      for (const f of cfg.fields ?? [])
        if (f.source !== 'SYSTEM')
          payload.quantities.push({ componentId: c.id, fieldKey: f.key, value: quantity });
    if (c.type === 'FIELD_GROUP')
      for (const f of cfg.fields ?? [])
        if (f.source !== 'SYSTEM')
          payload.fieldResponses.push({ componentId: c.id, fieldKey: f.key, value: value(f) });
    if (c.type === 'ATTENDEE_LIST')
      for (const r of cfg.roles ?? [])
        payload.attendees.push({
          componentId: c.id,
          roleKey: key(r),
          attendeeName: 'UAT attendee',
        });
    if (c.type === 'ACTION_LIST')
      payload.actions.push({
        componentId: c.id,
        values: Object.fromEntries((cfg.columns ?? []).map((f: any) => [String(f.key), value(f)])),
      });
    if (c.type === 'SIGNATURES')
      for (const r of cfg.roles ?? [])
        payload.signoffs.push({
          componentId: c.id,
          roleKey: key(r),
          signatoryName: 'UAT inspector',
        });
    if (c.type === 'COMMENTS') payload.comments.push({ componentId: c.id, value: 'AW26 UAT run' });
    if (c.type === 'INSPECTION_OUTCOME')
      payload.outcome = { componentId: c.id, remarks: 'AW26 UAT; outcome derived by the server' };
  }
  return payload;
}
