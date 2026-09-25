/** @vitest-environment jsdom */
import { describe, it, vi } from 'vitest';
import { expectLoadsEveryPage } from '../../test-support/cursor-list-page.js';
import { expectPdfExportsEveryPage } from '../../test-support/cursor-list-pdf.js';
import { FactoryListPage } from './FactoryListPage.js';
import { SizeListPage } from './SizeListPage.js';
import { SeasonListPage } from './SeasonListPage.js';
import { ProcessFlowListPage } from './ProcessFlowListPage.js';
import { QualityFormListPage } from './QualityFormListPage.js';

const factoryGenerator = vi.fn();
const sizeGenerator = vi.fn();
const seasonGenerator = vi.fn();
vi.mock('./pdf/generateFactoryListPdf.js', () => ({
  generateFactoryListPdfBlob: (...args: unknown[]) => factoryGenerator(...args),
}));
vi.mock('./pdf/generateSizeListPdf.js', () => ({
  generateSizeListPdfBlob: (...args: unknown[]) => sizeGenerator(...args),
}));
vi.mock('./pdf/generateSeasonListPdf.js', () => ({
  generateSeasonListPdfBlob: (...args: unknown[]) => seasonGenerator(...args),
}));

const pad = (n: number) => String(n).padStart(3, '0');

const factory = (n: number) => ({
  id: `f-${n}`,
  code: `FAC-${pad(n)}`,
  name: `Factory ${pad(n)}`,
  contactName: null,
  contactEmail: null,
  contactPhone: null,
  status: 'ACTIVE',
});
const size = (n: number) => ({
  id: `s-${n}`,
  code: `AGE_${pad(n)}`,
  label: `Age ${n}`,
  sizeType: 'AGE',
  sortOrder: n,
  status: 'ACTIVE',
});
const season = (n: number) => ({
  id: `se-${n}`,
  code: `SS${pad(n)}`,
  name: `Season ${pad(n)}`,
  displayName: `SS${pad(n)} 26-27`,
  status: 'ACTIVE',
  financialYear: { id: 'fy-1', code: '2026-27' },
});
const flow = (n: number) => ({
  id: `pf-${n}`,
  code: `PF-${pad(n)}`,
  name: `Flow ${pad(n)}`,
  status: 'ACTIVE',
  versions: [],
});
const form = (n: number) => ({
  id: `qf-${n}`,
  code: `QF_${pad(n)}`,
  name: `Form ${pad(n)}`,
  activityType: 'INSPECTION',
  executionScope: 'JOB_ORDER',
  status: 'ACTIVE',
  versions: [],
});

// Seasons also loads Financial Years (filter + create form defaults).
const seasonOtherGet = (url: string) =>
  url.startsWith('/financial-years') ? (url.endsWith('/current') ? null : []) : [];

// PAG8: the small master lists page by cursor (opt-in via limit); those with
// a list PDF export every matching page, not only the loaded rows.
describe('small master list pagination (PAG8)', () => {
  it('Factories reach every page and export every page', async () => {
    await expectLoadsEveryPage({
      element: <FactoryListPage />,
      path: '/factories',
      noun: 'factories',
      row: factory,
      rowText: (n) => `FAC-${pad(n)}`,
    });
    await expectPdfExportsEveryPage({
      element: <FactoryListPage />,
      path: '/factories',
      row: factory,
      generator: factoryGenerator,
    });
  });

  it('Sizes reach every page and export every page', async () => {
    await expectLoadsEveryPage({
      element: <SizeListPage />,
      path: '/sizes',
      noun: 'sizes',
      row: size,
      rowText: (n) => `AGE_${pad(n)}`,
    });
    await expectPdfExportsEveryPage({
      element: <SizeListPage />,
      path: '/sizes',
      row: size,
      generator: sizeGenerator,
    });
  });

  it('Seasons reach every page and export every page', async () => {
    await expectLoadsEveryPage({
      element: <SeasonListPage />,
      path: '/seasons',
      noun: 'Seasons',
      row: season,
      rowText: (n) => `SS${pad(n)}`,
      otherGet: seasonOtherGet,
    });
    await expectPdfExportsEveryPage({
      element: <SeasonListPage />,
      path: '/seasons',
      row: season,
      generator: seasonGenerator,
      otherGet: seasonOtherGet,
    });
  });

  it('Process Flows reach every page', async () => {
    await expectLoadsEveryPage({
      element: <ProcessFlowListPage />,
      path: '/process-flows',
      noun: 'process flows',
      row: flow,
      rowText: (n) => `Flow ${pad(n)}`,
    });
  });

  it('Quality Forms reach every page', async () => {
    await expectLoadsEveryPage({
      element: <QualityFormListPage />,
      path: '/quality-forms',
      noun: 'quality forms',
      row: form,
      rowText: (n) => `QF_${pad(n)}`,
    });
  });
});
