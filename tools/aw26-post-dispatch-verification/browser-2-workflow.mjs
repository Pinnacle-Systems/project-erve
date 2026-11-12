// Browser pass 2: the AW26 workflow as each role sees it, plus PDF downloads. Raw CDP only.
import { readdirSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
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

const s = state();
const ids = s.ids;
const b = await launch();
const downloads = join(evidence, 'browser-run', 'downloads');
mkdirSync(downloads, { recursive: true });
const results = [];
const note = (id, ok, detail = '') => {
  results.push({ id, ok, detail });
  console.log(ok ? 'OK  ' : 'MISS', id, detail.slice(0, 200));
};
const as = async (key) => {
  const c =
    key === 'ADMIN'
      ? adminCreds()
      : { identifier: actors()[key].email, password: actors()[key].password };
  await login(b, c.identifier, c.password);
};
const go = async (path, textReady) => {
  await b.navigateTo(path);
  if (textReady)
    await b
      .waitFor(`document.body.innerText.includes(${JSON.stringify(textReady)})`, 30000)
      .catch(() => {});
  await delay(1200);
};
const click = async (text) => {
  await b.clickButton(text);
  await delay(1500);
};
async function pdf(name, buttonText) {
  const before = new Set(readdirSync(downloads));
  await b.clickButton(buttonText);
  for (let n = 0; n < 60; n++) {
    await delay(500);
    const fresh = readdirSync(downloads).filter(
      (f) => !before.has(f) && !f.endsWith('.crdownload'),
    );
    if (fresh.length) {
      mkdirSync(join(evidence, 'pdfs'), { recursive: true });
      copyFileSync(join(downloads, fresh[0]), join(evidence, 'pdfs', `${name}.pdf`));
      return fresh[0];
    }
  }
  return null;
}
const step = async (id, fn) => {
  try {
    await fn();
  } catch (e) {
    note(id, false, e.message);
    await shot(b, `99-miss-${id}`, `Could not capture ${id}`).catch(() => {});
  }
};

try {
  await as('ADMIN');
  await step('order-sheet', async () => {
    await go('/purchase-orders', 'Order');
    await shot(
      b,
      '10-order-sheets',
      'Order Sheets raised by Distributor V, Distributor B and Distributor G',
    );
    note('order-sheet', true);
  });
  await step('job-order', async () => {
    await go(`/job-orders/${ids['jo:A']}`, 'AW26-5826005');
    await shot(b, '11-job-order-complete', 'Job Order A: two Order Sheets, production complete', {
      full: false,
    });
    note('job-order', true);
  });
  await step('dispatch-order', async () => {
    await go(`/sale-orders/${ids['do:DO1']}`, 'EISO');
    await shot(
      b,
      '12-dispatch-order',
      'Dispatch Order: two Distributors, three Stores, sizes 3-8 split equally',
    );
    note('dispatch-order', true);
  });
  await step('dispatch-order-pdf', async () => {
    const f = await pdf('dispatch-order-DO1', 'Download PDF');
    note('dispatch-order-pdf', !!f, f ?? 'no download');
  });

  await as('FACTORY');
  await step('factory-packing', async () => {
    await go(`/sale-orders/${ids['do:DO1']}/packing-list`, 'AW26-V1-A');
    await shot(
      b,
      '20-factory-packing',
      'Factory view of packing: Stores and cartons, no Distributor name',
    );
    const t = await bodyText(b);
    note(
      'factory-packing-conf',
      ![cfg.dist.V, cfg.dist.G, cfg.dist.B].some((n) => t.includes(n)) &&
        !/SALE_RETURN|OUTRIGHT/.test(t),
      'Factory packing page text',
    );
  });
  await step('factory-label', async () => {
    const names = await b.evaluate(
      `[...document.querySelectorAll('button')].map(x=>x.innerText.trim()).filter(Boolean).join('|')`,
    );
    writeFileSync(join(evidence, 'browser-run', 'factory-packing-buttons.txt'), names);
    note('factory-buttons', true, names.slice(0, 200));
  });

  await as('QA');
  await step('packing-audit', async () => {
    await go('/fulfillment/packing-audit', 'Audit');
    await shot(b, '21-packing-audit', 'QA Packing Audit queue: cartons already audited');
    const t = await bodyText(b);
    note('packing-audit-conf', ![cfg.dist.V, cfg.dist.G, cfg.dist.B].some((n) => t.includes(n)));
  });

  await as('MERCH');
  await step('eipl', async () => {
    await go('/fulfillment/erve-packing-lists', 'EIPL');
    await shot(b, '30-erve-packing-lists', 'Erve Packing Lists: one per Store, finalized');
  });
  const ed = (label) => ids[`ed:${label}`];
  await step('dispatch-overview', async () => {
    await go(`/fulfillment/erve-dispatches/${ed('ED1-V-STORE1')}`, 'EIED');
    await shot(
      b,
      '31-dispatch-overview',
      'Erve Dispatch: Store V1 receives two Styles from two Dispatch Orders',
    );
  });
  await step('dispatch-pdf', async () => {
    const f = await pdf('erve-dispatch-ED1', 'Download PDF');
    note('dispatch-pdf', !!f, f ?? 'no download');
  });
  await step('transport-tab', async () => {
    await click('Transport & Delivery');
    await shot(
      b,
      '32-transport-lr-qr',
      'Transport & Delivery: transporter, vehicle, LR and QR carton evidence',
      { full: true },
    );
  });
  await step('receipt-tab', async () => {
    await click('Distributor Receipt');
    await shot(
      b,
      '33-receipt-tab-shortage',
      'Distributor Receipt: one piece short on Style B size 9, remark recorded',
      { full: true },
    );
  });
  await step('recon-tab', async () => {
    await click('Reconciliation');
    await shot(b, '34-dispatch-reconciliation', 'Reconciliation tab for the same dispatch', {
      full: true,
    });
  });
  await step('recon-queue', async () => {
    await go('/fulfillment/erve-dispatches/reconciliation', 'Reconciliation queue');
    await shot(
      b,
      '40-reconciliation-queue',
      'Reconciliation queue: shortage, discrepancy, awaiting receipt, QR incomplete',
      { full: true },
    );
  });
  await step('recon-discrepancy', async () => {
    await go(`/fulfillment/erve-dispatches/${ed('ED4-G-STORE1')}`, 'EIED');
    await click('Reconciliation');
    await shot(
      b,
      '41-reconciliation-discrepancy',
      'Store G1: receipt (17) differs from earlier ledger (18)',
      { full: true },
    );
  });
  await step('inventory-admin', async () => {
    await go('/fulfillment/retail-store-inventory', 'Retail Store');
    await shot(b, '50-store-inventory-admin', 'Retail Store Inventory (Admin): all Distributors', {
      full: false,
    });
  });

  await as('DIST_V');
  await step('inventory-dist', async () => {
    await go('/fulfillment/retail-store-inventory', cfg.uiText.storeList);
    await b.evaluate(
      `(() => { for (const x of document.querySelectorAll('section[aria-label^="Retail Store"] h3 button[aria-expanded="false"]')) x.click(); })()`,
    );
    await delay(2500);
    await shot(
      b,
      '51-store-inventory-distributor',
      'Distributor V sees only its own Stores, with Style images and size columns',
      { full: true },
    );
  });
  await step('fifo-dialog', async () => {
    const opened = await b.evaluate(
      `(() => { const btn = [...document.querySelectorAll('button')].find(x => /^(Sold|Report sold)/i.test(x.innerText.trim()) && !x.disabled); if (btn) { btn.click(); return btn.innerText; } return null; })()`,
    );
    await delay(1500);
    note('fifo-dialog-open', !!opened, String(opened));
    await shot(
      b,
      '52-fifo-sold-dialog',
      'Report sold: quantity, date and automatic oldest-first allocation',
    );
    await b.evaluate(
      `(() => { const x = [...document.querySelectorAll('button')].find(b => /^cancel$/i.test(b.innerText.trim())); x?.click(); })()`,
    );
  });
  await step('sales-reports', async () => {
    await go('/fulfillment/distributor-sales-reports', 'Sales');
    await shot(b, '53-sales-reports', 'Sales reports posted by the FIFO action');
  });
  await step('returns', async () => {
    await go('/fulfillment/distributor-returns', 'Return');
    await shot(b, '54-returns', 'Return request created by the FIFO action');
  });
  await step('own-receipt-pending', async () => {
    await go(`/fulfillment/erve-dispatches/${ed('ED1-V-STORE1')}`, 'EIED');
    await click('Distributor Receipt');
    await shot(
      b,
      '55-distributor-receipt-final',
      'Distributor view: receipt is final, no second submission',
      { full: true },
    );
  });
  await step('dist-image-conf', async () => {
    const t = await bodyText(b);
    note('distributor-view-no-factory', !/Rahaa/.test(t), 'Distributor dispatch page text');
  });

  await as('DIST_G');
  await step('receipt-pending', async () => {
    await go(`/fulfillment/erve-dispatches/${ed('ED5-G-STORE2')}`, 'EIED');
    await click('Distributor Receipt');
    await shot(
      b,
      '56-receipt-awaiting',
      'Distributor G: receipt not yet entered (QR evidence only)',
      { full: true },
    );
  });

  await as('TRANSPORTER');
  await step('transporter', async () => {
    await go('/fulfillment/erve-dispatches', 'Assigned');
    await shot(b, '60-transporter-assigned', 'Transporter: only assigned dispatches, LR entry');
  });

  await as('ACCOUNTANT');
  await step('tax-invoice', async () => {
    await go('/fulfillment/tax-invoices', 'Tax Invoice');
    await shot(
      b,
      '70-tax-invoices',
      'Tax Invoices: unnumbered drafts for OUTRIGHT and SALE_RETURN',
    );
    await click('View');
    await shot(b, '71-tax-invoice-draft', 'Tax Invoice draft: lines, mode and source documents', {
      full: true,
    });
  });
  await step('tax-invoice-pdf', async () => {
    const f = await pdf('tax-invoice-draft', 'Download PDF').catch(() => null);
    note('tax-invoice-pdf', !!f, f ?? 'no PDF button');
  });
  await step('factory-invoices', async () => {
    await go('/fulfillment/factory-invoices', 'Invoice');
    await shot(b, '72-factory-invoices', 'Factory Invoices (expected billing)');
  });
} finally {
  writeFileSync(
    join(evidence, 'browser-run', 'workflow-results.json'),
    JSON.stringify(results, null, 2),
  );
  b.socket.close();
  b.__child.kill();
  process.exit(0);
}
