/** @vitest-environment jsdom */
import { describe, it, vi } from 'vitest';
import { expectLoadsEveryPage } from '../../test-support/cursor-list-page.js';
import { expectPdfExportsEveryPage } from '../../test-support/cursor-list-pdf.js';
import { StyleListPage } from './StyleListPage.js';
import { DistributorListPage } from './DistributorListPage.js';
import type { DistributorSummary, Style } from './types.js';

const styleGenerator = vi.fn();
const distributorGenerator = vi.fn();
vi.mock('./pdf/generateStyleListPdf.js', () => ({
  generateStyleListPdfBlob: (...args: unknown[]) => styleGenerator(...args),
}));
vi.mock('./pdf/generateDistributorListPdf.js', () => ({
  generateDistributorListPdfBlob: (...args: unknown[]) => distributorGenerator(...args),
}));

const pad = (n: number) => String(n).padStart(3, '0');

function style(n: number): Style {
  return {
    id: `style-${n}`,
    styleNumber: `STY-${pad(n)}`,
    styleName: 'Basic Tee',
    description: null,
    categoryDescription: null,
    itemNameGroup: null,
    ipName: null,
    licensor: null,
    colour: null,
    lmixNumber: null,
    hsnCode: null,
    hsnDescription: null,
    finalMrp: 499,
    royaltyPercentage: null,
    status: 'ACTIVE',
    season: {
      id: 's1',
      code: 'SS27',
      name: 'Spring Summer 27',
      financialYear: { id: 'fy1', code: 'FY27' },
      displayName: 'SS27',
      status: 'ACTIVE',
    },
    sizes: [],
    factories: [],
    images: [],
  } as Style;
}

function distributor(n: number): DistributorSummary {
  return {
    id: `dist-${n}`,
    code: `D-${pad(n)}`,
    name: `Distributor ${pad(n)}`,
    contactName: null,
    city: null,
    status: 'ACTIVE',
  };
}

// PAG5: the Style and Distributor lists page by cursor (opt-in via limit)
// and their PDFs export every matching page, not only the loaded rows.
describe('Style list pagination (PAG5)', () => {
  it('reaches every Style with Load more', async () => {
    await expectLoadsEveryPage({
      element: <StyleListPage />,
      path: '/styles',
      noun: 'styles',
      row: style,
      rowText: (n) => `STY-${pad(n)}`,
    });
  });

  it('exports every page to the PDF, not just the loaded rows', async () => {
    await expectPdfExportsEveryPage({
      element: <StyleListPage />,
      path: '/styles',
      row: style,
      generator: styleGenerator,
    });
  });
});

describe('Distributor list pagination (PAG5)', () => {
  it('reaches every Distributor with Load more', async () => {
    await expectLoadsEveryPage({
      element: <DistributorListPage />,
      path: '/distributors',
      noun: 'distributors',
      row: distributor,
      rowText: (n) => `Distributor ${pad(n)}`,
    });
  });

  it('exports every page to the PDF, not just the loaded rows', async () => {
    await expectPdfExportsEveryPage({
      element: <DistributorListPage />,
      path: '/distributors',
      row: distributor,
      generator: distributorGenerator,
    });
  });
});
