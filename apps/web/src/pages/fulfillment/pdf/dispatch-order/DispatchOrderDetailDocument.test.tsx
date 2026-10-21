import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { DispatchOrderDetailDocument } from './DispatchOrderDetailDocument.js';
import type {
  DispatchOrderDetailDestinationSection,
  DispatchOrderDetailDistributorSection,
  DispatchOrderDetailPdfViewModel,
  DispatchOrderDetailStyleRow,
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

function makeStyleRow(overrides: Partial<DispatchOrderDetailStyleRow> = {}): DispatchOrderDetailStyleRow {
  return {
    styleId: 'style-1',
    styleNumber: 'STY-0001',
    styleName: 'Basic Tee',
    primaryImage: null,
    values: { 'size-1': 10 },
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
    sizeColumns: [{ sizeId: 'size-1', sizeCode: 'M' }],
    styleRows: [makeStyleRow()],
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
    overallSizeColumns: [{ sizeId: 'size-1', sizeCode: 'M' }],
    overallStyleRows: [makeStyleRow()],
    grandTotalQuantity: 10,
    factoryDispatches: null,
    erveDispatches: null,
    auditTrail: null,
    ...overrides,
  };
}

describe('DispatchOrderDetailDocument', () => {
  it('embeds a compact primary image in both the destination and overall Style x Size matrices, preserving long Style names and quantities', async () => {
    const primaryImage = { id: 'file-primary', path: '/styles/style-1/images/primary/content' };
    const row = makeStyleRow({
      primaryImage,
      styleNumber: 'STY-0001 Long Style Name '.repeat(8),
      values: { 'size-1': 50000, 'size-2': 73456 },
    });
    const sizeColumns = [
      { sizeId: 'size-1', sizeCode: 'S' },
      { sizeId: 'size-2', sizeCode: 'XXL' },
    ];
    const vm = makeViewModel({
      distributorGroups: [
        makeDistributorGroup({
          destinations: [makeDestination({ sizeColumns, styleRows: [row] })],
        }),
      ],
      overallSizeColumns: sizeColumns,
      overallStyleRows: [row],
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
    // The shared PDF header also embeds ERVE branding — count only the Style
    // thumbnails under test, not the independent company-logo image.
    const images = all.filter(
      (node) => node.type === 'IMAGE' && node.props?.src === thumbnail.dataUri,
    );
    // One row -> one thumbnail per table (destination matrix + overall matrix).
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.props?.src).toBe(thumbnail.dataUri);
      expect(image.style).toMatchObject({ width: 20, height: 20, objectFit: 'contain' });
    }
    const text = all.map((node) => node.value).filter(Boolean);
    expect(text.filter((value) => value === row.styleNumber)).toHaveLength(2);
    expect(text.filter((value) => value === row.styleName)).toHaveLength(2);
    expect(text.filter((value) => value === 'XXL')).toHaveLength(2);
    expect(text).toContain('50000');
    expect(text).toContain('73456');
    const mediaBox = /\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/.exec(bytes)!;
    expect(Number(mediaBox[1])).toBeCloseTo(841.89, 2);
    expect(Number(mediaBox[2])).toBeCloseTo(595.28, 2);
  });
  it('renders a single-Distributor/single-Destination order without throwing', async () => {
    const blob = await pdf(<DispatchOrderDetailDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a mixed-Purchase-Mode, multi-Distributor, multi-Destination order spanning enough Style rows for >1 page without throwing', async () => {
    const stylesFor = (prefix: string) =>
      Array.from({ length: 15 }, (_, i) =>
        makeStyleRow({
          styleId: `${prefix}-${i}`,
          styleNumber: `STY-${prefix}-${i}`,
          primaryImage: { id: 'primary', path: '/styles/style-1/images/primary/content' },
        }),
      );
    const groupA = makeDistributorGroup({
      id: 'dg-a',
      distributorName: 'Distributor A',
      purchaseModeLabel: 'Outright',
      destinations: [
        makeDestination({ id: 'a1', label: 'A1', styleRows: stylesFor('a1') }),
        makeDestination({ id: 'a2', label: 'A2', styleRows: stylesFor('a2') }),
      ],
    });
    const groupB = makeDistributorGroup({
      id: 'dg-b',
      distributorName: 'Distributor B',
      purchaseModeLabel: 'Sale/Return',
      destinations: [makeDestination({ id: 'b1', label: 'B1', styleRows: stylesFor('b1') })],
    });
    const groupC = makeDistributorGroup({
      id: 'dg-c',
      distributorName: 'Distributor C',
      purchaseModeLabel: 'Outright',
      destinations: [makeDestination({ id: 'c1', label: 'C1', styleRows: stylesFor('c1') })],
    });

    const groups = [groupA, groupB, groupC];
    const instance = pdf(
      <DispatchOrderDetailDocument
        viewModel={makeViewModel({ distributorGroups: groups })}
        images={new Map([['primary', thumbnail]])}
      />,
    );
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

  it('renders a zero-quantity cell as 0, not an em dash', async () => {
    const row = makeStyleRow({ values: { 'size-1': 0 } });
    const instance = pdf(
      <DispatchOrderDetailDocument
        viewModel={makeViewModel({
          distributorGroups: [
            makeDistributorGroup({
              destinations: [makeDestination({ styleRows: [row] })],
            }),
          ],
        })}
      />,
    );
    const blob = await instance.toBlob();
    expect(blob.size).toBeGreaterThan(0);
    const all = nodes((instance.container as { document: PdfNode }).document);
    const text = all.map((node) => node.value).filter(Boolean);
    expect(text).toContain('0');
    expect(text).not.toContain('—');
  });
});
