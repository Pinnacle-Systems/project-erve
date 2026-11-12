export function sorStockBrowserTarget(testDatabaseUrl, developmentDatabaseUrl) {
  const target = new URL(testDatabaseUrl || 'invalid:');
  const local =
    ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(target.hostname);
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !local ||
    target.pathname !== '/sor_stock_browser_test'
  ) {
    throw new Error(
      'Sale-or-Return Stock browser review requires an explicit local disposable sor_stock_browser_test database',
    );
  }
  if (developmentDatabaseUrl) {
    const dev = new URL(developmentDatabaseUrl);
    if (
      dev.hostname === target.hostname &&
      (dev.port || '5432') === (target.port || '5432') &&
      dev.pathname === target.pathname
    )
      throw new Error('Sale-or-Return Stock browser database must differ from the development database');
  }
  return target.href;
}
