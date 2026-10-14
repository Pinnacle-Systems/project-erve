import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { CdpDriver } from './cdp-driver.mjs';
const repositoryRoot = resolve(import.meta.dirname, '../..'),
  runRoot = resolve(process.argv[2]);
const config = JSON.parse(await readFile(join(runRoot, 'first-config.json')));
const browser = await CdpDriver.connect({
  endpoint: 'http://127.0.0.1:9229',
  appUrl: 'http://127.0.0.1:5188',
  output: join(runRoot, `responsive-${process.argv[3] ?? '01'}`),
  repositoryRoot,
});
try {
  await browser.viewport(1440, 900);
  await browser.navigateTo('/login');
  await browser.waitFor('!!document.querySelector("#identifier")');
  await browser.fill('#identifier', config.adminEmail);
  await browser.fill(
    '#password',
    (await readFile(join(runRoot, 'first-password.txt'), 'utf8')).trimEnd(),
  );
  await browser.clickButton('Sign in');
  await browser.waitFor('location.pathname !== "/login"');
  await browser.navigateTo('/master-data/styles');
  await browser.waitFor('!!document.querySelector("table")');
  const failures = [];
  for (const [width, height, mobile] of [
    [1440, 900, false],
    [768, 1024, false],
    [390, 844, true],
  ]) {
    await browser.viewport(width, height, mobile);
    const geometry = await browser.evaluate(
      `({ actualWidth: innerWidth, actualHeight: innerHeight, scrollWidth: document.documentElement.scrollWidth, requestedWidth: ${width}, offenders: [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > ${width} + 1 && getComputedStyle(element).position !== 'fixed').slice(0, 20).map(element => ({ tag: element.tagName, className: String(element.className), width: element.getBoundingClientRect().width })) })`,
    );
    const passed = geometry.actualWidth === width && geometry.scrollWidth <= width + 1;
    browser.assertions.push({
      caseId: 'PR8-RESPONSIVE',
      description: `Styles viewport ${width}`,
      status: passed ? 'PASS' : 'FAIL',
      geometry,
    });
    await browser.captureEvidence({
      caseId: 'PR8-RESPONSIVE',
      step: `styles-${width}`,
      expected: `Actual viewport ${width}px, no page horizontal overflow`,
      observed: JSON.stringify(geometry),
      status: passed ? 'PASS' : 'FAIL',
    });
    if (!passed) failures.push(width);
  }
  await writeFile(
    join(browser.context.output, 'result.json'),
    JSON.stringify({ status: failures.length ? 'FAIL' : 'PASS', failures }, null, 2),
  );
  if (failures.length) {
    console.error(`Unexpected Styles viewport/overflow: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
