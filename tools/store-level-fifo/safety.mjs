export function fifoBrowserTarget(testDatabaseUrl, developmentDatabaseUrl) {
  const target = new URL(testDatabaseUrl || 'invalid:');
  const local =
    ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(target.hostname);
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !local ||
    target.pathname !== '/fifo_browser_test'
  ) {
    throw new Error(
      'The Store-level FIFO browser review requires an explicit local disposable fifo_browser_test database',
    );
  }
  if (developmentDatabaseUrl) {
    const dev = new URL(developmentDatabaseUrl);
    if (
      dev.hostname === target.hostname &&
      (dev.port || '5432') === (target.port || '5432') &&
      dev.pathname === target.pathname
    )
      throw new Error('The FIFO browser database must differ from the development database');
  }
  return target.href;
}
