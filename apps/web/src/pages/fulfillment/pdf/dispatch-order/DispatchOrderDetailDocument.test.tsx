import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { DispatchOrderDetailDocument } from './DispatchOrderDetailDocument.js';
import type {
  DispatchOrderDetailDestinationSection,
  DispatchOrderDetailDistributorSection,
  DispatchOrderDetailLineRow,
  DispatchOrderDetailPdfViewModel,
} from './buildDispatchOrderDetailViewModel.js';

interface PdfNode {
  type?: string;
  value?: string;
  props?: {
    src?: string;
    fixed?: boolean;
    onRender?: (result: { _INTERNAL__LAYOUT__DATA_: PdfNode }) => void;
  };
  style?: { width?: number; height?: number; objectFit?: string };
  children?: PdfNode[];
}
function nodes(root: PdfNode): PdfNode[] {
  return [root, ...(root.children ?? []).flatMap(nodes)];
}
const thumbnail = {
  dataUri:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
};

function makeLine(overrides: Partial<DispatchOrderDetailLineRow> = {}): DispatchOrderDetailLineRow {
  return {
    primaryImage: null,
    id: 'line-1',
    styleDisplay: 'STY-0001 — Basic Tee',
    sizeLabel: 'Medium',
    quantity: 10,
    ...overrides,
  };
}

function makeDestination(
  overrides: Partial<DispatchOrderDetailDestinationSection> = {},
): DispatchOrderDetailDestinationSection {
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

function makeDistributorGroup(
  overrides: Partial<DispatchOrderDetailDistributorSection> = {},
): DispatchOrderDetailDistributorSection {
  return {
    id: 'dg-1',
    distributorName: 'Acme Distributors',
    purchaseModeLabel: 'Outright',
    totalQuantity: 10,
    destinations: [makeDestination()],
    ...overrides,
  };
}

function makeViewModel(
  overrides: Partial<DispatchOrderDetailPdfViewModel> = {},
): DispatchOrderDetailPdfViewModel {
  return {
    title: 'DISPATCH ORDER',
    subtitle: 'EISO/26-27/0001 — Acme Factory',
    generatedAt: '2026-09-15T10:00:00Z',
    generatedBy: 'Test Merchandiser',
    identityItems: [{ label: 'Dispatch Order Number', value: 'EISO/26-27/0001' }],
    distributorGroups: [makeDistributorGroup()],
    styleSizeTotals: [
      {
        primaryImage: null,
        key: 'style-1:size-1',
        styleDisplay: 'STY-0001 — Basic Tee',
        sizeLabel: 'Medium',
        quantity: 10,
      },
    ],
    grandTotalQuantity: 10,
    factoryDispatches: null,
    erveDispatches: null,
    auditTrail: null,
    ...overrides,
  };
}

describe('DispatchOrderDetailDocument', () => {
  it('embeds a compact primary image in both tables and preserves long labels and quantities', async () => {
    const primaryImage = { id: 'file-primary', path: '/styles/style-1/images/primary/content' };
    const line = makeLine({
      primaryImage,
      styleDisplay: 'STY-0001 Long Style Name '.repeat(8),
      sizeLabel: 'Extra Extra Large',
      quantity: 123456,
    });
    const vm = makeViewModel({
      distributorGroups: [
        makeDistributorGroup({ destinations: [makeDestination({ lines: [line] })] }),
      ],
      styleSizeTotals: [{ ...line, key: 'style-1:size-1' }],
    });
    const instance = pdf(
      <DispatchOrderDetailDocument
        viewModel={vm}
        images={new Map([['file-primary', thumbnail]])}
      />,
    );
    const blob = await instance.toBlob();
    const bytes = new TextDecoder().decode(await blob.arrayBuffer());
    expect(bytes).toContain('/Subtype /Image');
    const all = nodes((instance.container as { document: PdfNode }).document);
    // The shared PDF header now embeds ERVE branding. Count only the Style
    // thumbnails under test, not the independent company-logo image.
    const images = all.filter(
      (node) => node.type === 'IMAGE' && node.props?.src === thumbnail.dataUri,
    );
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.props?.src).toBe(thumbnail.dataUri);
      expect(image.style).toMatchObject({ width: 32, height: 32, objectFit: 'contain' });
    }
    const text = all.map((node) => node.value).filter(Boolean);
    expect(text.filter((value) => value === 'Image')).toHaveLength(2);
    expect(text.filter((value) => value === line.styleDisplay)).toHaveLength(2);
    expect(text.filter((value) => value === 'Extra Extra Large')).toHaveLength(2);
    expect(text.filter((value) => value === '123456')).toHaveLength(2);
    const mediaBox = /\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/.exec(bytes)!;
    expect(Number(mediaBox[1])).toBeCloseTo(841.89, 2);
    expect(Number(mediaBox[2])).toBeCloseTo(595.28, 2);
  });
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
        makeDestination({
          id: 'a1',
          label: 'A1',
          lines: Array.from({ length: 15 }, (_, i) => makeLine({ id: `a1-${i}` })),
        }),
        makeDestination({
          id: 'a2',
          label: 'A2',
          lines: Array.from({ length: 15 }, (_, i) => makeLine({ id: `a2-${i}` })),
        }),
      ],
    });
    const groupB = makeDistributorGroup({
      id: 'dg-b',
      distributorName: 'Distributor B',
      purchaseModeLabel: 'Sale/Return',
      destinations: [
        makeDestination({
          id: 'b1',
          label: 'B1',
          lines: Array.from({ length: 15 }, (_, i) => makeLine({ id: `b1-${i}` })),
        }),
      ],
    });
    const groupC = makeDistributorGroup({
      id: 'dg-c',
      distributorName: 'Distributor C',
      purchaseModeLabel: 'Outright',
      destinations: [
        makeDestination({
          id: 'c1',
          label: 'C1',
          lines: Array.from({ length: 15 }, (_, i) => makeLine({ id: `c1-${i}` })),
        }),
      ],
    });

    const groups = [groupA, groupB, groupC];
    for (const group of groups)
      for (const dest of group.destinations)
        for (const line of dest.lines) {
          line.primaryImage = { id: 'primary', path: '/styles/style-1/images/primary/content' };
        }
    const instance = pdf(
      <DispatchOrderDetailDocument
        viewModel={makeViewModel({ distributorGroups: groups })}
        images={new Map([['primary', thumbnail]])}
      />,
    );
    let layout: PdfNode | undefined;
    (instance.container as { document: PdfNode }).document.props!.onRender = (result) => {
      layout = result._INTERNAL__LAYOUT__DATA_;
    };
    const blob = await Promise.race([
      instance.toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error('PDF generation hung on a multi-Distributor Dispatch Order')),
          8000,
        ),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
    const bytes = new TextDecoder().decode(await blob.arrayBuffer());
    expect(bytes.match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);
    const all = nodes((instance.container as { document: PdfNode }).document);
    expect(all.filter(
      (node) => node.type === 'IMAGE' && node.props?.src === thumbnail.dataUri,
    )).toHaveLength(60);
    const text = all.map((node) => node.value ?? '').join('\n');
    for (const label of ['Distributor A', 'Distributor B', 'Distributor C', 'A1', 'A2', 'B1', 'C1'])
      expect(text).toContain(label);
    const headers = all.filter(
      (node) => node.props?.fixed && nodes(node).some((child) => child.value === 'Image'),
    );
    expect(headers).toHaveLength(5);
    const pagesWithImages = layout!.children!.filter((page) =>
      nodes(page).some((node) => node.type === 'IMAGE'),
    );
    expect(pagesWithImages.length).toBeGreaterThan(1);
    for (const page of pagesWithImages) {
      expect(
        nodes(page).some(
          (node) => node.props?.fixed && nodes(node).some((child) => child.value === 'Image'),
        ),
      ).toBe(true);
    }
  }, 10000);

  it('renders "not available for this viewer" sections without throwing when linked records are null', async () => {
    const blob = await pdf(
      <DispatchOrderDetailDocument
        viewModel={makeViewModel({
          factoryDispatches: null,
          erveDispatches: null,
          auditTrail: null,
        })}
      />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders populated linked-record sections without throwing', async () => {
    const blob = await pdf(
      <DispatchOrderDetailDocument
        viewModel={makeViewModel({
          factoryDispatches: [
            { id: 'fd1', factoryDispatchNumber: 'EIFD/26-27/0001', statusLabel: 'Draft' },
          ],
          erveDispatches: [
            {
              id: 'ed1',
              erveDispatchNumber: 'EIED/26-27/0001',
              status: 'DISPATCHED',
              totalQuantity: 10,
            },
          ],
          auditTrail: [
            {
              id: 'a1',
              title: 'Dispatch Order created',
              detail: null,
              actorName: 'Test Merchandiser',
              createdAt: '30 Jun 2026',
            },
          ],
        })}
      />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a zero-quantity line as 0, not an em dash', async () => {
    const blob = await pdf(
      <DispatchOrderDetailDocument
        viewModel={makeViewModel({
          distributorGroups: [
            makeDistributorGroup({
              destinations: [makeDestination({ lines: [makeLine({ quantity: 0 })] })],
            }),
          ],
        })}
      />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});
