import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disposableTarget } from './safety.mjs';

test('refuses remote, shared and non-test targets before starting any services', () => {
  for (const url of [
    undefined,
    'postgresql://db.example/erve_batch1_test',
    'postgresql://localhost/erve',
    'postgresql://localhost/erve_batch1_test?schema=other',
  ])
    assert.throws(() => disposableTarget(url));
  assert.throws(() =>
    disposableTarget(
      'postgresql://127.0.0.1/erve_batch1_test',
      'postgresql://localhost/erve_batch1_test',
    ),
  );
  assert.equal(
    disposableTarget(
      'postgresql://localhost:55441/erve_batch1_test',
      'postgresql://localhost:5432/erve',
    ),
    'postgresql://localhost:55441/erve_batch1_test',
  );
});
