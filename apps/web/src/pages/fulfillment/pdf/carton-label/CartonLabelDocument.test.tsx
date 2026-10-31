import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { CartonLabelDocument } from './CartonLabelDocument.js';
import type { CartonLabelPdfViewModel } from './buildCartonLabelViewModel.js';

function makeViewModel(overrides: Partial<CartonLabelPdfViewModel> = {}): CartonLabelPdfViewModel {
  return {
    title: 'CARTON LABEL',
    subtitle: 'Carton C1 — EISO/26-27/0001',
    generatedAt: '2026-09-15T10:00:00Z',
    cartonNumber: 'C1',
    destinationName: 'Store 1',
    identityItems: [
      { label: 'Dispatch Order', value: 'EISO/26-27/0001' },
      { label: 'Distributor', value: 'Distributor One' },
      { label: 'Destination', value: 'Store 1' },
      { label: 'Address', value: '123 Test Street, Chennai, TN, India' },
    ],
    totalQuantity: 10,
    sizeColumns: [{ sizeId: 'size-m', sizeCode: 'M' }],
    styleRows: [
      {
        styleId: 'style-1',
        styleNumber: 'ST-001',
        styleName: 'Classic Tee',
        values: { 'size-m': 10 },
      },
    ],
    ...overrides,
  };
}

describe('CartonLabelDocument', () => {
  it('renders a normal carton without throwing', async () => {
    const blob = await pdf(<CartonLabelDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a long destination address without throwing', async () => {
    const blob = await pdf(
      <CartonLabelDocument
        viewModel={makeViewModel({
          identityItems: [
            { label: 'Dispatch Order', value: 'EISO/26-27/0001' },
            { label: 'Distributor', value: 'A Very Long Distributor Legal Name Private Limited' },
            { label: 'Destination', value: 'Flagship Store, Block C' },
            {
              label: 'Address',
              value:
                'Unit 4, Second Floor, Tower B, Super Long Commercial Complex Name Road, Near the Old Railway Crossing, Chennai, Tamil Nadu, 600001, India',
            },
          ],
        })}
      />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a carton with many Style rows without hanging', async () => {
    const styleRows = Array.from({ length: 25 }, (_, i) => ({
      styleId: `style-${i}`,
      styleNumber: `ST-${i}`,
      styleName: `Style ${i}`,
      values: { 'size-m': 5 },
    }));
    const blob = await Promise.race([
      pdf(
        <CartonLabelDocument viewModel={makeViewModel({ styleRows, totalQuantity: 125 })} />,
      ).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a multi-line carton')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);

  it('renders when optional weight/dimensions are absent from identityItems', async () => {
    const blob = await pdf(<CartonLabelDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it.each([9, 10, 11])('renders %i configured Size columns, long Style names and totals', async (count) => {
    const sizeColumns = Array.from({ length: count }, (_, index) => ({
      sizeId: 'size-' + index,
      sizeCode: 'SZ' + (index + 1),
    }));
    const styleRows = [
      {
        styleId: 'style-1',
        styleNumber: 'ST-001',
        styleName: 'A Very Long Style Name That Could Wrap Across Lines',
        image: { placeholder: true } as const,
        values: Object.fromEntries(sizeColumns.map((column, index) => [column.sizeId, index + 1])),
      },
      {
        styleId: 'style-2',
        styleNumber: 'ST-002',
        styleName: 'Polo',
        values: { 'size-0': 2 },
      },
    ];
    const totalQuantity = count * (count + 1) / 2 + 2;
    const blob = await pdf(
      <CartonLabelDocument viewModel={makeViewModel({ sizeColumns, styleRows, totalQuantity })} />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders multiple Styles once each, with an explicit thumbnail placeholder', async () => {
    const blob = await pdf(
      <CartonLabelDocument
        viewModel={makeViewModel({
          sizeColumns: [
            { sizeId: 's', sizeCode: 'S' },
            { sizeId: 'm', sizeCode: 'M' },
            { sizeId: 'l', sizeCode: 'L' },
          ],
          styleRows: [
            {
              styleId: 'style-1',
              styleNumber: 'ST-001',
              styleName: 'Classic Tee',
              image: { placeholder: true },
              values: { s: 3, m: 4, l: 2 },
            },
            {
              styleId: 'style-2',
              styleNumber: 'ST-002',
              styleName: 'Polo',
              image: { placeholder: true },
              values: { m: 2, l: 2 },
            },
          ],
          totalQuantity: 13,
        })}
      />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders when weight and dimensions are present', async () => {
    const blob = await pdf(
      <CartonLabelDocument
        viewModel={makeViewModel({
          identityItems: [
            ...makeViewModel().identityItems,
            { label: 'Net Weight', value: '12.5 kg' },
            { label: 'Gross Weight', value: '13.2 kg' },
            { label: 'Dimensions', value: '60 x 40 x 35 cm' },
          ],
        })}
      />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});
