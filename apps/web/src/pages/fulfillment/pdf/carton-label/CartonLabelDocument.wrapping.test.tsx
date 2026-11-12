import { describe, expect, it } from 'vitest';
import {
  LONG_INDIAN_ADDRESS_TEXT,
  LONG_INDIAN_STORE_FIXTURE,
  expectNoHorizontalOverlap,
  expectWithinPrintableWidth,
  expectWordsIntact,
  renderAndInspectPdf,
} from '../../../../lib/pdf/core/pdfInspection.test-utils.js';
import type { FactoryPackingCartonView, PackingListDestinationView } from '../../types.js';
import { buildCartonLabelViewModel } from './buildCartonLabelViewModel.js';
import { CartonLabelDocument } from './CartonLabelDocument.js';

const META = { generatedAt: '2026-11-12T10:00:00Z' };

function makeCarton(styleCount = 3): FactoryPackingCartonView {
  const lines = Array.from({ length: styleCount }, (_, index) => ({
    saleOrderLineId: `line-${index}`,
    styleId: `style-${index}`,
    styleNumber: `AW26-${String(index + 1).padStart(3, '0')}`,
    styleName: `Winter Jacket ${index + 1}`,
    primaryImage: null,
    sizeId: 'size-m',
    sizeCode: 'M',
    sizeLabel: 'Medium',
    quantity: 10 + index,
    currentDestinationId: 'dest-1',
  }));
  return {
    id: 'carton-1',
    cartonNumber: 'C1',
    destinationId: 'dest-1',
    packageDetails: null,
    netWeight: '12.5',
    grossWeight: '13.2',
    dimensions: '60 x 40 x 35 cm',
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

function makeDestination(overrides: Partial<PackingListDestinationView> = {}): PackingListDestinationView {
  return {
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
    lines: [],
    cartons: [],
    ...overrides,
  };
}

function renderLabel(destination: PackingListDestinationView, carton = makeCarton()) {
  const viewModel = buildCartonLabelViewModel(
    { carton, destination, saleOrderNumber: 'EISO/26-27/0001', factoryName: 'Factory One', factoryDispatchNumber: 'EIFD/26-27/0001' },
    META,
  );
  return renderAndInspectPdf(<CartonLabelDocument viewModel={viewModel} />);
}

describe('CartonLabelDocument address wrapping (D2)', () => {
  it('preserves every word of a long Indian Store name and address, including the PIN code', async () => {
    const inspected = await renderLabel(makeDestination());

    expectWordsIntact(inspected, LONG_INDIAN_STORE_FIXTURE.label);
    expectWordsIntact(inspected, LONG_INDIAN_ADDRESS_TEXT);
    expect(inspected.fullText).not.toMatch(/Ra-\s*jasthan|Col-\s*lectorate/);
    expect(inspected.fullText).toContain('342001');
  });

  it('keeps long addresses inside their areas with no overlap or clipping, and the page stays portrait A4', async () => {
    const inspected = await renderLabel(makeDestination());

    expectNoHorizontalOverlap(inspected);
    expectWithinPrintableWidth(inspected);
    expect(inspected.numPages).toBe(1);
    expect(inspected.pageSizes[0]!.width).toBeCloseTo(595.28, 0);
    expect(inspected.pageSizes[0]!.height).toBeCloseTo(841.89, 0);
  });

  it('leaves identifiers, quantities and the contents table unchanged', async () => {
    const inspected = await renderLabel(makeDestination());

    expect(inspected.fullText).toContain('CARTON LABEL');
    expect(inspected.fullText).toContain('Carton C1');
    expect(inspected.fullText).toContain('EISO/26-27/0001');
    expect(inspected.fullText).toContain('AW26-001');
    expect(inspected.fullText).toContain('Total: 33');
  });

  it('controlled fallback: an over-long unbroken Store name and address token neither overlap nor clip, and nothing is dropped', async () => {
    const inspected = await renderLabel(
      makeDestination({ label: `Store-${'X'.repeat(90)}`, addressLine1: `Plot${'Y'.repeat(80)} Road`, addressLine2: null, postalCode: null }),
    );

    expectNoHorizontalOverlap(inspected);
    expectWithinPrintableWidth(inspected);
    const rendered = inspected.runsByPage.flat().map((run) => run.str).join('');
    // The Store name is printed twice on the label (large heading + Destination field).
    expect(rendered.match(/X/g)?.length).toBe(180);
    expect(rendered.match(/Y/g)?.length).toBe(80);
  });

  it('renders when optional address fields (line 2, PIN, contact) are absent', async () => {
    const inspected = await renderLabel(
      makeDestination({ addressLine2: null, postalCode: null, contactName: null, contactPhone: null, label: null }),
    );

    expect(inspected.numPages).toBe(1);
    expect(inspected.fullText).not.toMatch(/null|undefined/);
    expect(inspected.fullText).toContain('Jodhpur, Rajasthan');
  });

  it('still paginates a carton with many Style rows without losing content', async () => {
    const inspected = await renderLabel(makeDestination(), makeCarton(60));

    expect(inspected.numPages).toBeGreaterThan(1);
    expect(inspected.fullText).toContain('AW26-001');
    expect(inspected.fullText).toContain('AW26-060');
    expectNoHorizontalOverlap(inspected);
  }, 30000);
});
