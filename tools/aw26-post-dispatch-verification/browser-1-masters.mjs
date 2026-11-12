// Browser pass 1 (Admin): AW26 masters as a tester sees them - Season, Styles, Style detail, Distributors, Retail Stores, repeat-import preview.
import {
  launch,
  login,
  shot,
  bodyText,
  adminCreds,
  state,
  delay,
  WS,
  cfg,
} from './browser-lib.mjs';
import { join } from 'node:path';

const s = state();
const b = await launch();
const log = [];
const note = (id, text) => {
  log.push({ id, text });
  console.log(id, text.replace(/\s+/g, ' ').slice(0, 260));
};
try {
  const a = adminCreds();
  await login(b, a.identifier, a.password);
  const visit = async (path, ready, name, caption, opts) => {
    await b.navigateTo(path);
    await b.waitFor(ready, 30000).catch(() => {});
    note(name, await bodyText(b));
    await shot(b, name, caption, opts);
  };
  await visit(
    '/master-data/seasons',
    'document.body.innerText.includes("AW26")',
    '01-season-list',
    'Seasons: AW26 created by import (Barcode Serial 3)',
  );
  await visit(
    '/master-data/styles',
    'document.body.innerText.includes("AW26-")',
    '02-style-list',
    'Styles: the 11 AW26 Styles that imported cleanly',
  );
  await b.navigateTo(`/master-data/styles/${s.ids.styleA}`);
  await b.waitFor('document.body.innerText.includes("AW26-5826005")', 30000).catch(() => {});
  await delay(1500);
  note('03-style-detail', await bodyText(b));
  await shot(b, '03-style-detail', 'Style detail: image, sizes 3-8 and generated barcodes', {
    full: true,
  });
  await visit(
    '/master-data/distributors',
    `document.body.innerText.includes(${JSON.stringify(cfg.uiText.distributorList)})`,
    '04-distributor-list',
    'Distributors: 12 imported (Purchase Mode set from the TEST ONLY overlay)',
  );
  await visit(
    '/master-data/retail-stores',
    `document.body.innerText.includes(${JSON.stringify(cfg.uiText.storeList)})`,
    '05-retail-store-list',
    'Retail Stores: street, city, state and PIN in separate columns',
  );
  const store = await fetch('http://127.0.0.1:4080/retail-stores?limit=5', {
    headers: { Authorization: `Bearer ${s.tokens.ADMIN}` },
  })
    .then((r) => r.json())
    .catch(() => null);
  const storeId = store?.data?.items?.[0]?.id;
  if (storeId)
    await visit(
      `/master-data/retail-stores/${storeId}`,
      'document.body.innerText.length > 200',
      '06-retail-store-detail',
      'Retail Store detail: structured address',
    );
  // Repeat-import safety in the real UI: upload the same Retail Store workbook again and read the preview.
  await b.navigateTo('/master-data/retail-stores/import');
  await b.waitFor('!!document.querySelector("input[type=file]")', 30000);
  await b.uploadFile('input[type=file]', join(WS, '04-import-ready', '06-retail-stores.xlsx'));
  await delay(2500);
  note('07-import-preview-text', await bodyText(b));
  await shot(
    b,
    '07-retail-store-import-repeat',
    'Importing the same Retail Store file again: every row is "already exists"',
    { full: true },
  );
} catch (e) {
  console.error('ERROR', e.message);
  await shot(b, '99-error-masters', 'error screen').catch(() => {});
} finally {
  (await import('node:fs')).writeFileSync(
    join(WS, '07-technical-evidence', 'browser-run', 'masters-text.json'),
    JSON.stringify(log, null, 2),
  );
  b.socket.close();
  b.__child.kill();
  process.exit(0);
}
