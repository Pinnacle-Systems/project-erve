import { describe, expect, it } from 'vitest';
import {
  LONG_INDIAN_ADDRESS_TEXT,
  LONG_INDIAN_STORE_FIXTURE,
  expectNoHorizontalOverlap,
  expectWithinPrintableWidth,
  expectWordsIntact,
  renderAndInspectPdf,
} from '../../../../lib/pdf/core/pdfInspection.test-utils.js';
import type { ErveDispatchView } from '../../types.js';
import { buildErveDispatchDetailViewModel } from './buildErveDispatchDetailViewModel.js';
import { ErveDispatchDetailDocument } from './ErveDispatchDetailDocument.js';

const META = { generatedAt: '2026-11-12T10:00:00Z', generatedBy: 'Test User' };

type Destination = NonNullable<ErveDispatchView['destination']>;

function makeDestination(overrides: Partial<Destination> = {}): Destination {
  return {
    storeCode: 'ST-014',
    gstin: null,
    label: LONG_INDIAN_STORE_FIXTURE.label,
    addressLine1: LONG_INDIAN_STORE_FIXTURE.addressLine1,
    addressLine2: LONG_INDIAN_STORE_FIXTURE.addressLine2,
    city: LONG_INDIAN_STORE_FIXTURE.city,
    state: LONG_INDIAN_STORE_FIXTURE.state,
    country: LONG_INDIAN_STORE_FIXTURE.country,
    postalCode: LONG_INDIAN_STORE_FIXTURE.postalCode,
    contactName: LONG_INDIAN_STORE_FIXTURE.contactName,
    contactEmail: null,
    contactPhone: LONG_INDIAN_STORE_FIXTURE.contactPhone,
    ...overrides,
  } as Destination;
}

function makeDispatch(destination: Destination | null, positionLines = 0): ErveDispatchView {
  return {
    id: 'ed-1',
    erveDispatchNumber: 'ED/26-27/0001',
    ervePackingList: { id: 'epl-1', ervePackingListNumber: 'EIPL/26-27/0001' },
    saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' },
    distributor: { id: 'd1', code: 'D1', name: 'Distributor V' },
    status: 'DISPATCHED',
    dispatchDate: '2026-11-10T00:00:00.000Z',
    transporter: 'Blue Dart',
    vehicleNumber: 'RJ19AB1234',
    lrNumber: 'LR-001',
    remarks: 'Handle with care',
    dispatchedBy: { id: 'u1', name: 'Test User', email: 'test@erve.local' },
    dispatchedAt: '2026-11-10T00:00:00.000Z',
    lrUpdatedBy: null,
    lrUpdatedAt: null,
    deliveredBy: null,
    deliveredAt: null,
    deliveryRemarks: null,
    deliveryConfirmationSource: null,
    totalQuantity: 20,
    invoiceHandoffs: [],
    saleOrReturnLines: Array.from({ length: positionLines }, (_, index) => ({
      saleOrderLineId: `sol-${index}`,
      styleNumber: `AW26-${String(index + 1).padStart(3, '0')}`,
      sizeLabel: 'Medium',
      dispatchedQuantity: 10,
      receivedQuantity: 10,
      actualSoldQuantity: 4,
      returnedQuantity: 1,
      approvedAwaitingReceiptQuantity: 0,
      pendingRequestedQuantity: 0,
      remainingWithDistributor: 5,
    })),
    destination,
    version: 1,
    updatedAt: '2026-11-10T00:00:00.000Z',
  } as unknown as ErveDispatchView;
}

function renderDispatch(dispatch: ErveDispatchView) {
  return renderAndInspectPdf(<ErveDispatchDetailDocument viewModel={buildErveDispatchDetailViewModel(dispatch, META)} />);
}

describe('ErveDispatchDetailDocument address wrapping (D2)', () => {
  it('preserves every word of a long Indian Store name and address, including the PIN code', async () => {
    const inspected = await renderDispatch(makeDispatch(makeDestination()));

    expectWordsIntact(inspected, LONG_INDIAN_STORE_FIXTURE.label);
    expectWordsIntact(inspected, LONG_INDIAN_ADDRESS_TEXT);
    expect(inspected.fullText).not.toMatch(/Ra-\s*jasthan|Col-\s*lectorate/);
    expect(inspected.fullText).toContain('342001');
  });

  it('keeps long addresses inside their columns with no overlap or clipping, and the page stays landscape A4', async () => {
    const inspected = await renderDispatch(makeDispatch(makeDestination()));

    expectNoHorizontalOverlap(inspected);
    expectWithinPrintableWidth(inspected);
    expect(inspected.numPages).toBe(1);
    expect(inspected.pageSizes[0]!.width).toBeCloseTo(841.89, 0);
    expect(inspected.pageSizes[0]!.height).toBeCloseTo(595.28, 0);
  });

  it('leaves headers, identifiers and quantities unchanged', async () => {
    const inspected = await renderDispatch(makeDispatch(makeDestination()));

    for (const text of ['ERVE DISPATCH', 'ED/26-27/0001', 'EIPL/26-27/0001', 'Distributor V', 'RJ19AB1234', 'LR-001', 'ST-014']) {
      expect(inspected.fullText).toContain(text);
    }
  });

  it('controlled fallback: an over-long unbroken Store name and address token neither overlap nor clip, and nothing is dropped', async () => {
    const inspected = await renderDispatch(
      makeDispatch(makeDestination({ label: `Store-${'X'.repeat(90)}`, addressLine1: `Plot${'Y'.repeat(80)} Road`, addressLine2: null, postalCode: null })),
    );

    expectNoHorizontalOverlap(inspected);
    expectWithinPrintableWidth(inspected);
    const rendered = inspected.runsByPage.flat().map((run) => run.str).join('');
    expect(rendered.match(/X/g)?.length).toBe(90);
    expect(rendered.match(/Y/g)?.length).toBe(80);
  });

  it('renders when the destination or its optional address fields are absent', async () => {
    const noDestination = await renderDispatch(makeDispatch(null));
    expect(noDestination.fullText).toContain('ED/26-27/0001');

    const sparse = await renderDispatch(makeDispatch(makeDestination({ addressLine2: null, postalCode: null, gstin: null })));
    expect(sparse.fullText).not.toMatch(/null|undefined/);
    expect(sparse.fullText).toContain('Jodhpur, Rajasthan, India');
  });

  it('still paginates a long Sale-or-Return table without losing rows', async () => {
    const inspected = await renderDispatch(makeDispatch(makeDestination(), 40));

    expect(inspected.numPages).toBeGreaterThan(1);
    expect(inspected.fullText).toContain('AW26-001');
    expect(inspected.fullText).toContain('AW26-040');
    expectNoHorizontalOverlap(inspected);
  }, 30000);
});
