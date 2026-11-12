import { describe, expect, it } from 'vitest';
import {
  LONG_INDIAN_ADDRESS_TEXT,
  LONG_INDIAN_STORE_FIXTURE,
  expectNoHorizontalOverlap,
  expectWithinPrintableWidth,
  expectWordsIntact,
  renderAndInspectPdf,
} from '../../../../lib/pdf/core/pdfInspection.test-utils.js';
import type { FactoryPackingCartonView, PackingListDestinationView, PackingListView } from '../../types.js';
import { buildFactoryPackingListViewModel } from './buildFactoryPackingListViewModel.js';
import { FactoryPackingListDetailDocument } from './FactoryPackingListDetailDocument.js';

const META = { generatedAt: '2026-11-12T10:00:00Z', generatedBy: 'Test Factory User' };

function makeCarton(index: number, styleCount: number): FactoryPackingCartonView {
  const lines = Array.from({ length: styleCount }, (_, s) => ({
    saleOrderLineId: `line-${s}`,
    styleId: `style-${s}`,
    styleNumber: `AW26-${String(s + 1).padStart(3, '0')}`,
    styleName: `Winter Jacket ${s + 1}`,
    primaryImage: null,
    sizeId: 'size-m',
    sizeCode: 'M',
    sizeLabel: 'Medium',
    quantity: 10 + s,
    currentDestinationId: 'dest-1',
  }));
  return {
    id: `carton-${index}`,
    cartonNumber: `C${index}`,
    destinationId: 'dest-1',
    packageDetails: null,
    netWeight: '12.5',
    grossWeight: '13.2',
    dimensions: null,
    version: 1,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    destinationMismatch: false,
    auditState: 'INSPECTED',
    retired: false,
    retiredAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    lines,
    auditHistory: [],
  };
}

function makePackingList(
  cartons: FactoryPackingCartonView[],
  destinationOverrides: Partial<PackingListDestinationView> = {},
): PackingListView {
  const lines = cartons[0]!.lines.map((line) => ({
    saleOrderLineId: line.saleOrderLineId,
    styleId: line.styleId,
    styleNumber: line.styleNumber,
    styleName: line.styleName,
    primaryImage: null,
    sizeId: line.sizeId,
    sizeCode: line.sizeCode,
    sizeLabel: line.sizeLabel,
    requiredQuantity: line.quantity,
    packedQuantity: line.quantity,
  }));
  return {
    saleOrderId: 'so-1',
    saleOrderNumber: 'EISO/26-27/0001',
    distributors: [{ id: 'dist-1', code: 'D1', name: 'Distributor V' }],
    factory: { id: 'fac-1', code: 'F1', name: 'Factory One' },
    factoryDispatch: { id: 'fd-1', factoryDispatchNumber: 'EIFD/26-27/0001', status: 'DRAFT', version: 1, factoryInvoiceId: null },
    destinations: [
      {
        id: 'dest-1',
        distributor: { id: 'dist-1', code: 'D1', name: 'Distributor V' },
        label: LONG_INDIAN_STORE_FIXTURE.label,
        contactName: LONG_INDIAN_STORE_FIXTURE.contactName,
        contactEmail: null,
        contactPhone: LONG_INDIAN_STORE_FIXTURE.contactPhone,
        addressLine1: LONG_INDIAN_STORE_FIXTURE.addressLine1,
        addressLine2: LONG_INDIAN_STORE_FIXTURE.addressLine2,
        city: LONG_INDIAN_STORE_FIXTURE.city,
        state: LONG_INDIAN_STORE_FIXTURE.state,
        country: LONG_INDIAN_STORE_FIXTURE.country,
        postalCode: LONG_INDIAN_STORE_FIXTURE.postalCode,
        gstin: null,
        canMoveDistributor: false,
        lines,
        cartons,
        ...destinationOverrides,
      },
    ],
    retiredCartons: [],
  };
}

function render(packingList: PackingListView) {
  return renderAndInspectPdf(
    <FactoryPackingListDetailDocument viewModel={buildFactoryPackingListViewModel(packingList, META)} />,
  );
}

describe('FactoryPackingListDetailDocument Store address (D1)', () => {
  it('prints the complete Store address including the PIN code', async () => {
    const inspected = await render(makePackingList([makeCarton(1, 3)]));

    expect(inspected.fullText).toContain('342001');
    // Same order as the other documents: ..., city, state, PIN, country.
    expect(inspected.fullText).toContain('Jodhpur, Rajasthan, 342001, India');
    expectWordsIntact(inspected, LONG_INDIAN_ADDRESS_TEXT);
    expect(inspected.fullText).not.toMatch(/Ra-\s*jasthan|Col-\s*lectorate/);
  });

  it('keeps the long address inside the page with no overlap and the page stays landscape A4', async () => {
    const inspected = await render(makePackingList([makeCarton(1, 3)]));

    expectNoHorizontalOverlap(inspected);
    expectWithinPrintableWidth(inspected);
    expect(inspected.pageSizes[0]!.width).toBeCloseTo(841.89, 0);
    expect(inspected.pageSizes[0]!.height).toBeCloseTo(595.28, 0);
  });

  it('omits an absent PIN code cleanly (no "null", no stray comma) and still prints the rest of the address', async () => {
    const inspected = await render(makePackingList([makeCarton(1, 3)], { postalCode: null, addressLine2: null }));

    expect(inspected.fullText).toContain('Jodhpur, Rajasthan, India');
    expect(inspected.fullText).not.toMatch(/null|undefined|, ,/);
  });

  it('prints the PIN code and keeps every carton on a multi-page document', async () => {
    const cartons = Array.from({ length: 14 }, (_, index) => makeCarton(index + 1, 6));
    const inspected = await render(makePackingList(cartons));

    expect(inspected.numPages).toBeGreaterThan(1);
    expect(inspected.fullText).toContain('342001');
    expect(inspected.fullText).toContain('Carton C1 ');
    expect(inspected.fullText).toContain('Carton C14 ');
    expectNoHorizontalOverlap(inspected);
  }, 30000);
});
