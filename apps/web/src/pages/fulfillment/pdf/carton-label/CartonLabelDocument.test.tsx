import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { CartonLabelDocument } from './CartonLabelDocument.js';
import type { CartonLabelPdfViewModel } from './buildCartonLabelViewModel.js';

function makeViewModel(overrides: Partial<CartonLabelPdfViewModel> = {}): CartonLabelPdfViewModel {
  return {
    title: 'CARTON LABEL',
    subtitle: 'Carton C1 — EISO/26-27/0001 · Factory One',
    generatedAt: '2026-09-15T10:00:00Z',
    generatedBy: 'Test Factory User',
    cartonNumber: 'C1',
    destinationName: 'Store 1',
    identityItems: [
      { label: 'Dispatch Order', value: 'EISO/26-27/0001' },
      { label: 'Factory', value: 'Factory One' },
      { label: 'Factory Dispatch', value: 'EIFD/26-27/0001' },
      { label: 'Distributor', value: 'Distributor One' },
      { label: 'Destination', value: 'Store 1' },
      { label: 'Address', value: '123 Test Street, Chennai, TN, India' },
    ],
    totalQuantity: 10,
    lines: [{ id: 'line-1', styleDisplay: 'ST-001 — Classic Tee', sizeLabel: 'Medium', quantity: 10 }],
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
            { label: 'Factory', value: 'Factory One' },
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

  it('renders a carton with many size/content lines without hanging', async () => {
    const lines = Array.from({ length: 25 }, (_, i) => ({ id: `line-${i}`, styleDisplay: `ST-${i}`, sizeLabel: 'M', quantity: 5 }));
    const blob = await Promise.race([
      pdf(<CartonLabelDocument viewModel={makeViewModel({ lines, totalQuantity: 125 })} />).toBlob(),
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
