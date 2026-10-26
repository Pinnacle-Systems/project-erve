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
    styleRows: [
      {
        id: 'style-1',
        styleDisplay: 'ST-001 — Classic Tee',
        sizeBreakdown: 'Medium: 10',
        quantity: 10,
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
      id: `style-${i}`,
      styleDisplay: `ST-${i}`,
      sizeBreakdown: 'M: 5',
      quantity: 5,
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

  it('renders a Style row with a long Size Breakdown (many Sizes grouped under one Style) without hanging', async () => {
    const sizeBreakdown = Array.from({ length: 12 }, (_, i) => `SZ${i}: ${i + 1}`).join(' · ');
    const blob = await pdf(
      <CartonLabelDocument
        viewModel={makeViewModel({
          styleRows: [
            {
              id: 'style-1',
              styleDisplay: 'ST-001 — A Very Long Style Name That Could Wrap Across Lines',
              sizeBreakdown,
              quantity: 78,
            },
          ],
          totalQuantity: 78,
        })}
      />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders multiple Styles each grouped into a single row (not repeated per Size)', async () => {
    const blob = await pdf(
      <CartonLabelDocument
        viewModel={makeViewModel({
          styleRows: [
            {
              id: 'style-1',
              styleDisplay: 'ST-001 — Classic Tee',
              sizeBreakdown: 'S: 3 · M: 4 · L: 2',
              quantity: 9,
            },
            {
              id: 'style-2',
              styleDisplay: 'ST-002 — Polo',
              sizeBreakdown: 'M: 2 · L: 2',
              quantity: 4,
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
