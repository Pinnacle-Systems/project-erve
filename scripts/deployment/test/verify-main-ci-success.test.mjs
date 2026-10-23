import assert from 'node:assert/strict';
import test from 'node:test';
import { requireSuccessfulMainCI, verifyMainCI } from '../verify-main-ci-success.mjs';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

function run(overrides = {}) {
  return {
    id: 15,
    head_sha: SHA,
    head_branch: 'main',
    event: 'push',
    path: '.github/workflows/ci.yml',
    status: 'completed',
    conclusion: 'success',
    run_started_at: '2026-10-23T10:00:00Z',
    html_url: 'https://github.com/example/project/actions/runs/15',
    ...overrides,
  };
}

function env(overrides = {}) {
  return {
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: SHA,
    GITHUB_REPOSITORY: 'Pinnacle-Systems/project-erve',
    GITHUB_TOKEN: 'synthetic-test-token',
    ...overrides,
  };
}

function mockFetch(runs, options = {}) {
  return async (url, req) => {
    assert.equal(new URL(url).hostname, 'api.github.com');
    assert.equal(new URL(url).pathname, '/repos/Pinnacle-Systems/project-erve/actions/workflows/ci.yml/runs');
    assert.equal(new URL(url).searchParams.get('head_sha'), SHA);
    assert.equal(new URL(url).searchParams.get('event'), 'push');
    assert.equal(new URL(url).searchParams.get('branch'), 'main');
    assert.equal(req.headers.Authorization, 'Bearer synthetic-test-token');
    return {
      ok: options.ok ?? true,
      status: options.status ?? 200,
      json: async () => options.payload ?? { workflow_runs: runs },
    };
  };
}

test('accepts an exact-SHA successful main push CI workflow', async () => {
  const checked = await verifyMainCI({ env: env(), fetchFn: mockFetch([run()]) });
  assert.equal(checked.id, 15);
});

test('blocks an in-progress post-squash main CI even with a passing PR run', async () => {
  const runs = [
    run({ id: 99, event: 'pull_request' }),
    run({ id: 100, status: 'in_progress', conclusion: null }),
  ];
  await assert.rejects(verifyMainCI({ env: env(), fetchFn: mockFetch(runs) }), /has not passed/);
});

test('blocks a PR-only check even when its SHA matches', () => {
  assert.throws(
    () => requireSuccessfulMainCI({ workflow_runs: [run({ event: 'pull_request' })] }, SHA),
    /No push-triggered main CI/,
  );
});

test('blocks wrong SHA, branch, or workflow path', () => {
  for (const change of [
    { head_sha: OTHER_SHA },
    { head_branch: 'feature/fix' },
    { path: '.github/workflows/deploy-production.yml' },
  ]) {
    assert.throws(
      () => requireSuccessfulMainCI({ workflow_runs: [run(change)] }, SHA),
      /No push-triggered main CI/,
    );
  }
});

test('blocks no run, missing run list, and malformed response', () => {
  for (const payload of [{ workflow_runs: [] }, {}, null]) {
    assert.throws(() => requireSuccessfulMainCI(payload, SHA));
  }
});

test('blocks a failed or cancelled main CI', () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'skipped', null]) {
    assert.throws(
      () => requireSuccessfulMainCI({ workflow_runs: [run({ conclusion })] }, SHA),
      /has not passed/,
    );
  }
});

test('latest exact-commit CI run governs, never an older passing run', () => {
  assert.throws(
    () =>
      requireSuccessfulMainCI(
        {
          workflow_runs: [
            run({ id: 1, run_started_at: '2026-10-23T09:00:00Z' }),
            run({ id: 2, run_started_at: '2026-10-23T11:00:00Z', conclusion: 'failure' }),
          ],
        },
        SHA,
      ),
    /run 2: status=completed, conclusion=failure/,
  );
});

test('blocks manual deployment dispatched from any non-main ref', async () => {
  await assert.rejects(verifyMainCI({ env: env({ GITHUB_REF: 'refs/heads/feature' }) }), /main branch/);
});

test('blocks missing token and malformed SHA before querying GitHub', async () => {
  await assert.rejects(verifyMainCI({ env: env({ GITHUB_TOKEN: '' }) }), /missing\/invalid/);
  await assert.rejects(verifyMainCI({ env: env({ GITHUB_SHA: 'short' }) }), /missing\/invalid/);
});

test('blocks GitHub API authentication, availability, and malformed replies', async () => {
  await assert.rejects(
    verifyMainCI({ env: env(), fetchFn: mockFetch([], { ok: false, status: 403 }) }),
    /HTTP 403/,
  );
  await assert.rejects(
    verifyMainCI({ env: env(), fetchFn: mockFetch([], { payload: {} }) }),
    /invalid CI workflow-runs response/,
  );
  await assert.rejects(
    verifyMainCI({ env: env(), fetchFn: async () => { throw new Error('offline'); } }),
    /offline/,
  );
});
