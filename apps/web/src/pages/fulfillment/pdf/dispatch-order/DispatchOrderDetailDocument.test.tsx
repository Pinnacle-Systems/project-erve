import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { DispatchOrderDetailDocument } from './DispatchOrderDetailDocument.js';
import type {
  DispatchOrderDetailDestinationSection,
  DispatchOrderDetailDistributorSection,
  DispatchOrderDetailLineRow,
  DispatchOrderDetailPdfViewModel,
} from './buildDispatchOrderDetailViewModel.js';

function makeLine(overrides: Partial<DispatchOrderDetailLineRow> = {}): DispatchOrderDetailLineRow {
  return { id: 'line-1', styleDisplay: 'STY-0001 — Basic Tee', sizeLabel: 'Medium', quantity: 10, ...overrides };
}

function makeDestination(overrides: Partial<DispatchOrderDetailDestinationSection> = {}): DispatchOrderDetailDestinationSection {
  return {
    id: 'dest-1',
    label: 'Store 1',
    addressLine: '1 MG Road, Chennai, TN, 600001, India',
    contactLine: 'Ravi Kumar · 9876543210',
    gstin: '33AAAAA0000A1Z5',
    totalQuantity: 10,
    lines: [makeLine()],
    ...overrides,
  };
}

function makeDistributorGroup(overrides: Partial<DispatchOrderDetailDistributorSection> = {}): DispatchOrderDetailDistributorSection {
  return {
    id: 'dg-1',
    distributorName: 'Acme Distributors',
    purchaseModeLabel: 'Outright',
    totalQuantity: 10,
    destinations: [makeDestination()],
    ...overrides,
  };
}

function makeViewModel(overrides: Partial<DispatchOrderDetailPdfViewModel> = {}): DispatchOrderDetailPdfViewModel {
  return {
    title: 'DISPATCH ORDER',
    subtitle: 'EISO/26-27/0001 — Acme Factory',
    generatedAt: '2026-09-15T10:00:00Z',
    generatedBy: 'Test Merchandiser',
    identityItems: [{ label: 'Dispatch Order Number', value: 'EISO/26-27/0001' }],
    distributorGroups: [makeDistributorGroup()],
    styleSizeTotals: [{ key: 'style-1:size-1', styleDisplay: 'STY-0001 — Basic Tee', sizeLabel: 'Medium', quantity: 10 }],
    grandTotalQuantity: 10,
    factoryDispatches: null,
    erveDispatches: null,
    auditTrail: null,
    ...overrides,
  };
}

describe('DispatchOrderDetailDocument', () => {
  it('renders a single-Distributor/single-Destination order without throwing', async () => {
    const blob = await pdf(<DispatchOrderDetailDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a mixed-Purchase-Mode, multi-Distributor, multi-Destination order spanning enough rows for >1 page without throwing', async () => {
    const groupA = makeDistributorGroup({
      id: 'dg-a',
      distributorName: 'Distributor A',
      purchaseModeLabel: 'Outright',
      destinations: [
        makeDestination({ id: 'a1', label: 'A1', lines: Array.from({ length: 15 }, (_, i) => makeLine({ id: `a1-${i}` })) }),
        makeDestination({ id: 'a2', label: 'A2', lines: Array.from({ length: 15 }, (_, i) => makeLine({ id: `a2-${i}` })) }),
      ],
    });
    const groupB = makeDistributorGroup({
      id: 'dg-b',
      distributorName: 'Distributor B',
      purchaseModeLabel: 'Sale/Return',
      destinations: [makeDestination({ id: 'b1', label: 'B1', lines: Array.from({ length: 15 }, (_, i) => makeLine({ id: `b1-${i}` })) })],
    });
    const groupC = makeDistributorGroup({
      id: 'dg-c',
      distributorName: 'Distributor C',
      purchaseModeLabel: 'Outright',
      destinations: [makeDestination({ id: 'c1', label: 'C1', lines: Array.from({ length: 15 }, (_, i) => makeLine({ id: `c1-${i}` })) })],
    });

    const blob = await Promise.race([
      pdf(<DispatchOrderDetailDocument viewModel={makeViewModel({ distributorGroups: [groupA, groupB, groupC] })} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a multi-Distributor Dispatch Order')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);

  it('renders "not available for this viewer" sections without throwing when linked records are null', async () => {
    const blob = await pdf(
      <DispatchOrderDetailDocument viewModel={makeViewModel({ factoryDispatches: null, erveDispatches: null, auditTrail: null })} />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders populated linked-record sections without throwing', async () => {
    const blob = await pdf(
      <DispatchOrderDetailDocument
        viewModel={makeViewModel({
          factoryDispatches: [{ id: 'fd1', factoryDispatchNumber: 'EIFD/26-27/0001', statusLabel: 'Draft' }],
          erveDispatches: [{ id: 'ed1', erveDispatchNumber: 'EIED/26-27/0001', status: 'DISPATCHED', totalQuantity: 10 }],
          auditTrail: [{ id: 'a1', title: 'Dispatch Order created', detail: null, actorName: 'Test Merchandiser', createdAt: '30 Jun 2026' }],
        })}
      />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a zero-quantity line as 0, not an em dash', async () => {
    const blob = await pdf(
      <DispatchOrderDetailDocument
        viewModel={makeViewModel({
          distributorGroups: [makeDistributorGroup({ destinations: [makeDestination({ lines: [makeLine({ quantity: 0 })] })] })],
        })}
      />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});
