// Browser pass 3: documents (carton label, EIPL, tax invoice draft), lazy-thumbnail inventory shot, mobile widths, repeat-import UI.
import { readdirSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
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
  cfg,
} from './browser-lib.mjs';

const ids = state().ids;
const b = await launch();
const downloads = join(evidence, 'browser-run', 'downloads');
mkdirSync(downloads, { recursive: true });
const results = [];
const note = (id, ok, detail = '') => {
  results.push({ id, ok, detail });
  console.log(ok ? 'OK  ' : 'MISS', id, String(detail).slice(0, 200));
};
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
  await delay(1200);
};
const step = async (id, fn) => {
  try {
    await fn();
  } catch (e) {
    note(id, false, e.message);
  }
};
async function pdfByEval(name, matcher) {
  const before = new Set(readdirSync(downloads));
  const clicked = await b.evaluate(
    `(() => { const x = [...document.querySelectorAll('button, a')].filter(e => ${matcher}); if (!x.length) return null; x[0].click(); return x[0].innerText; })()`,
  );
  if (!clicked) return null;
  for (let n = 0; n < 80; n++) {
    await delay(500);
    const fresh = readdirSync(downloads).filter(
      (f) => !before.has(f) && !f.endsWith('.crdownload'),
    );
    if (fresh.length) {
      copyFileSync(join(downloads, fresh[0]), join(evidence, 'pdfs', `${name}.pdf`));
      return fresh[0];
    }
  }
  return null;
}
try {
  await as('FACTORY');
  await step('label', async () => {
    await go(`/sale-orders/${ids['do:DO1']}/packing-list`, 'AW26-V1-A');
    const f = await pdfByEval(
      'carton-label-AW26-V1-A',
      `/^Download Label/.test(e.innerText.trim())`,
    );
    note('carton-label-pdf', !!f, f ?? 'no download');
    const f2 = await pdfByEval(
      'factory-packing-list-DO1',
      `/^Download PDF/.test(e.innerText.trim())`,
    );
    note('factory-packing-pdf', !!f2, f2 ?? 'no download');
  });
  await as('MERCH');
  await step('eipl-pdf', async () => {
    const list = await fetch('http://127.0.0.1:4080/erve-packing-lists?limit=5', {
      headers: { Authorization: `Bearer ${state().tokens.MERCH}` },
    }).then((r) => r.json());
    await go(`/fulfillment/erve-packing-lists/${ids['eipl:ED1-V-STORE1']}`, 'EIPL');
    await shot(b, '35-erve-packing-list', 'Erve Consolidated Packing List: cartons for one Store', {
      full: true,
    });
    const f = await pdfByEval('erve-packing-list-ED1', `/^Download PDF/.test(e.innerText.trim())`);
    note('eipl-pdf', !!f, f ?? 'no download');
  });
  await as('ACCOUNTANT');
  await step('tax-invoice', async () => {
    await go('/fulfillment/tax-invoices', 'Tax Invoice');
    await b.evaluate(
      `[...document.querySelectorAll('a, button')].find(e => e.innerText.trim() === 'View')?.click()`,
    );
    await b.waitFor('location.pathname.startsWith("/fulfillment/tax-invoices/")', 15000);
    await delay(2000);
    await shot(
      b,
      '71-tax-invoice-draft',
      'Tax Invoice draft: unnumbered, source documents linked',
      { full: true },
    );
    const f = await pdfByEval('tax-invoice-draft', `/PDF/.test(e.innerText)`);
    note('tax-invoice-pdf', !!f, f ?? 'no PDF button');
  });
  await as('DIST_V');
  await step('inventory-thumbs', async () => {
    await go('/fulfillment/retail-store-inventory', cfg.uiText.storeList);
    await b.evaluate(
      `(() => { for (const x of document.querySelectorAll('section[aria-label^="Retail Store"] h3 button[aria-expanded="false"]')) x.click(); })()`,
    );
    const n = await b.evaluate(
      `document.querySelectorAll('section[aria-label$="Sale-or-Return"]').length`,
    );
    for (let i = 0; i < n; i++) {
      await b.evaluate(
        `document.querySelectorAll('section[aria-label$="Sale-or-Return"]')[${i}].scrollIntoView({block:'center'})`,
      );
      await delay(900);
    }
    await b.evaluate('window.scrollTo(0,0)');
    await shot(
      b,
      '51-store-inventory-distributor',
      'Distributor V sees only its own Stores, with Style images and size columns',
      { full: true },
    );
    const loaded = await b.evaluate(
      `[...document.querySelectorAll('section[aria-label$="Sale-or-Return"] header img')].filter(i => i.complete && i.naturalWidth > 0).length`,
    );
    note('thumbnails-loaded', loaded >= 3, `${loaded} of ${n} cards`);
    for (const width of [375]) {
      await b.viewport(width, 900, true);
      await go('/fulfillment/retail-store-inventory', cfg.uiText.storeList);
      const overflow = await b.evaluate('document.documentElement.scrollWidth - innerWidth');
      note('mobile-inventory-no-overflow', overflow <= 1, `overflow ${overflow}px`);
      await shot(
        b,
        '57-mobile-inventory',
        'Phone width (375px): grids scroll inside the card, page does not',
      );
      await b.viewport(1440, 1000);
    }
  });
  await as('ADMIN');
  await step('mobile-dispatch', async () => {
    await b.viewport(375, 900, true);
    await go(`/fulfillment/erve-dispatches/${ids['ed:ED1-V-STORE1']}`, 'EIED');
    const overflow = await b.evaluate('document.documentElement.scrollWidth - innerWidth');
    note('mobile-dispatch-no-overflow', overflow <= 1, `overflow ${overflow}px`);
    await shot(b, '58-mobile-dispatch', 'Phone width (375px): Erve Dispatch overview');
    await b.viewport(1440, 1000);
  });
  await step('repeat-import-ui', async () => {
    await go('/master-data/retail-stores/import', 'Import');
    const info = await b.evaluate(
      `[...document.querySelectorAll('input[type=file]')].map(i => ({ id: i.id, hidden: i.hidden, accept: i.accept }))`,
    );
    console.log(JSON.stringify(info));
    const { root } = await b.command('DOM.getDocument');
    const { nodeId } = await b.command('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: 'input[type=file]',
    });
    await b.command('DOM.setFileInputFiles', {
      nodeId,
      files: [join(WS, '04-import-ready', '06-retail-stores.xlsx')],
    });
    await delay(3500);
    const t = await bodyText(b);
    note('repeat-import-preview', /exist|skip/i.test(t), t.replace(/\s+/g, ' ').slice(0, 220));
    await shot(
      b,
      '07-retail-store-import-repeat',
      'Importing the same Retail Store file again: every row is "already exists"',
      { full: true },
    );
  });
} finally {
  writeFileSync(
    join(evidence, 'browser-run', 'documents-results.json'),
    JSON.stringify(results, null, 2),
  );
  b.socket.close();
  b.__child.kill();
  process.exit(0);
}
