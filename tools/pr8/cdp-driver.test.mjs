import test from 'node:test';
import assert from 'node:assert/strict';
import { localUrl, safeEvidenceName, publicNetworkEvent } from './cdp-driver.mjs';

test('only explicit loopback HTTP endpoints are accepted', () => {
  assert.equal(localUrl('http://127.0.0.1:9229').hostname, '127.0.0.1');
  for (const url of [
    'https://example.com',
    'http://127.0.0.1@example.com',
    'file:///tmp/a',
    'http://localhost:4000/?token=secret',
  ]) {
    assert.throws(() => localUrl(url));
  }
});
test('evidence names cannot escape output directory', () => {
  assert.equal(safeEvidenceName('PR8-UI-001', 'preview'), 'PR8-UI-001-preview');
  assert.throws(() => safeEvidenceName('../escape', 'preview'));
});
test('network evidence excludes query parameters, headers and bodies', () => {
  assert.deepEqual(
    publicNetworkEvent({
      requestId: '1',
      response: {
        url: 'http://localhost:4000/x?token=secret',
        status: 403,
        headers: { Authorization: 'secret' },
      },
    }),
    { requestId: '1', origin: 'http://localhost:4000', path: '/x', status: 403 },
  );
});
