// Browser pass 4: fix-ups for pass 3 (EIPL PDF, Tax Invoice draft screen, repeat-import preview in the real UI).
import { readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  launch,
  login,
  shot,
  bodyText,
  actors,
  adminCreds,
  state,
  delay,
  WS,
  evidence,
} from './browser-lib.mjs';
const ids = state().ids;
const b = await launch();
const downloads = join(evidence, 'browser-run', 'downloads');
mkdirSync(downloads, { recursive: true });
const as = async (key) => {
  const c =
    key === 'ADMIN'
      ? adminCreds()
      : { identifier: actors()[key].email, password: actors()[key].password };
  await login(b, c.identifier, c.password);
};
const go = async (path, text) => {
  await b.navigateTo(path);
  if (text)
    await b
      .waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`, 30000)
      .catch(() => {});
  await delay(1500);
};
try {
  await as('MERCH');
  await go(`/fulfillment/erve-packing-lists/${ids['eipl:ED1-V-STORE1']}`, 'EIPL');
  const before = new Set(readdirSync(downloads));
  await b.clickButton('Download PDF');
  for (let n = 0; n < 60; n++) {
    await delay(500);
    const f = readdirSync(downloads).filter((x) => !before.has(x) && x.endsWith('.pdf'));
    if (f.length) {
      copyFileSync(join(downloads, f[0]), join(evidence, 'pdfs', 'erve-packing-list-ED1.pdf'));
      console.log('EIPL pdf', f[0]);
      break;
    }
  }
  await as('ACCOUNTANT');
  await go(`/fulfillment/tax-invoices/${ids['taxdraft:ED1-V-STORE1']}`, 'Tax Invoice');
  await shot(
    b,
    '71-tax-invoice-draft',
    'Tax Invoice draft: finalization blocked until the Style has an HSN',
    { full: false },
  );
  await as('ADMIN');
  await go('/master-data/retail-stores/import', 'Import');
  const { root } = await b.command('DOM.getDocument');
  const { nodeId } = await b.command('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: 'input[type=file]',
  });
  await b.command('DOM.setFileInputFiles', {
    nodeId,
    files: [join(WS, '04-import-ready', '06-retail-stores.xlsx')],
  });
  await delay(1500);
  await b.evaluate(
    `(() => { const s = document.querySelector('select'); const o = [...s.options].find(o => o.value && /retail/i.test(o.text)) ?? s.options[1]; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })); })()`,
  );
  await delay(800);
  await b.clickButton('Preview');
  await b.waitFor('/exist|skip/i.test(document.body.innerText)', 40000).catch(() => {});
  await delay(1500);
  const t = await bodyText(b);
  console.log('PREVIEW', /exist|skip/i.test(t), t.replace(/\s+/g, ' ').slice(300, 700));
  await shot(
    b,
    '07-retail-store-import-repeat',
    'Importing the same Retail Store file again: every row is "already exists"',
    { full: false },
  );
} catch (e) {
  console.error('ERR', e.message);
} finally {
  b.socket.close();
  b.__child.kill();
  process.exit(0);
}
