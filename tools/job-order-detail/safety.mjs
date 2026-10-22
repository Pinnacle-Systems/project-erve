export function disposableTarget(testUrl, otherUrl) {
  const url = new URL(testUrl ?? '');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.pathname !== '/erve_batch1_test' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Batch 1 requires a dedicated loopback erve_batch1_test database');
  }
  if (otherUrl) {
    const other = new URL(otherUrl);
    const otherIsLoopback = ['127.0.0.1', 'localhost'].includes(other.hostname);
    if (
      otherIsLoopback &&
      (other.port || '5432') === (url.port || '5432') &&
      other.pathname === url.pathname
    )
      throw new Error('Test database must differ from the configured development database');
  }
  return url.href;
}
