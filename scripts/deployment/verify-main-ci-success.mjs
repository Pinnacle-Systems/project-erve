/**
 * Fail-closed production deployment gate: accept only a successful, completed
 * push-triggered CI workflow run for the exact commit dispatched from main.
 * PR-only checks and successful checks for a different SHA are never enough.
 */
import { pathToFileURL } from 'node:url';

const WORKFLOW_PATH = '.github/workflows/ci.yml';
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function requireSuccessfulMainCI(payload, expectedSha) {
  if (!payload || !Array.isArray(payload.workflow_runs)) {
    throw new Error('GitHub returned an invalid CI workflow-runs response');
  }

  // Verify the returned metadata, rather than trusting only server-side
  // filters in the query string.
  const matchingRuns = payload.workflow_runs.filter(
    (run) =>
      run?.head_sha === expectedSha &&
      run.head_branch === 'main' &&
      run.event === 'push' &&
      run.path === WORKFLOW_PATH,
  );
  if (matchingRuns.length === 0) {
    throw new Error('No push-triggered main CI run exists for the exact deployment commit');
  }

  // If multiple matching runs exist, the most recently started run governs.
  // Never allow an earlier success to override a newer failure/in-progress run.
  const startedAt = (run) => Date.parse(run.run_started_at || run.created_at || '') || 0;
  matchingRuns.sort((a, b) => startedAt(b) - startedAt(a) || Number(b.id || 0) - Number(a.id || 0));
  const latest = matchingRuns[0];
  if (latest.status !== 'completed' || latest.conclusion !== 'success') {
    throw new Error(
      'Exact-commit main CI has not passed (run ' +
        String(latest.id) +
        ': status=' +
        String(latest.status) +
        ', conclusion=' +
        String(latest.conclusion) +
        '). Complete/fix CI before manually deploying.',
    );
  }
  return latest;
}

export async function verifyMainCI({ env = process.env, fetchFn = fetch } = {}) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Production deployment must be manually dispatched from the main branch');
  }
  const sha = env.GITHUB_SHA;
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN;
  if (!SHA_PATTERN.test(sha || '') || !REPO_PATTERN.test(repo || '') || !token) {
    throw new Error('Required commit SHA, repository, or GitHub Actions read token is missing/invalid');
  }

  const params = new URLSearchParams({
    branch: 'main',
    event: 'push',
    head_sha: sha,
    per_page: '100',
  });
  const url =
    'https://api.github.com/repos/' +
    repo +
    '/actions/workflows/ci.yml/runs?' +
    params.toString();
  const response = await fetchFn(url, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error('Unable to verify CI via GitHub API (HTTP ' + String(response.status) + ')');
  }
  const run = requireSuccessfulMainCI(await response.json(), sha);
  return run;
}

async function main() {
  try {
    const run = await verifyMainCI();
    console.log(
      'Exact-commit main CI passed: ' +
        String(run.html_url || 'workflow run ' + String(run.id)) +
        ' (SHA ' +
        process.env.GITHUB_SHA +
        ')',
    );
  } catch (error) {
    console.error('::error::Production deployment blocked: ' + String(error?.message || error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
