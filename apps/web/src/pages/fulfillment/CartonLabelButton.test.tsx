/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CartonLabelButton } from './CartonLabelButton.js';
import { apiClient } from '../../lib/api-client.js';
import { generateCartonLabelPdfBlob } from './pdf/carton-label/generateCartonLabelPdf.js';
import { downloadPdfBlob } from '../../lib/pdf/download.js';
import type { FactoryPackingCartonView, PackingListDestinationView } from './types.js';
vi.mock('./pdf/carton-label/generateCartonLabelPdf.js', () => ({
  generateCartonLabelPdfBlob: vi.fn(async () => new Blob(['pdf'])),
}));
vi.mock('../../lib/pdf/download.js', () => ({ downloadPdfBlob: vi.fn() }));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      <CartonLabelButton
        carton={
          {
            id: 'carton-1',
            version: 1,
            cartonNumber: 'C1',
            auditState: 'INSPECTED',
            retired: false,
          } as FactoryPackingCartonView
        }
        destination={{} as PackingListDestinationView}
        saleOrderNumber="DO1"
        factoryName="Factory"
        factoryDispatchNumber="FD1"
      />,
    ),
  );
}
async function download() {
  await act(async () =>
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Download Label'))!
      .click(),
  );
}
it('uses freshly authorized label data and its stable QR in the existing Download action', async () => {
  const source = {
    carton: { id: 'carton-1', version: 1, auditState: 'INSPECTED', retired: false },
    destination: {},
    saleOrderNumber: 'SERVER-DO',
  };
  vi.spyOn(apiClient, 'post').mockResolvedValue({
    data: {
      data: {
        enabled: true,
        source,
        url: `https://delivery.example/delivery/carton#${'A'.repeat(43)}`,
        labelReference: 'REF1',
      },
    },
  });
  await render();
  await download();
  expect(generateCartonLabelPdfBlob).toHaveBeenCalledWith(
    expect.objectContaining({
      saleOrderNumber: 'SERVER-DO',
      deliveryQr: expect.objectContaining({ labelReference: 'REF1' }),
    }),
    expect.anything(),
  );
  expect(downloadPdfBlob).toHaveBeenCalledTimes(1);
});
it('fails closed on an unrecognized preparation response rather than silently printing without a QR', async () => {
  vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: {} } });
  await render();
  await download();
  expect(generateCartonLabelPdfBlob).not.toHaveBeenCalled();
  expect(downloadPdfBlob).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('PDF generation failed');
});
it('does not print after preparation is refused by the server', async () => {
  vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('Retired or stale inspection'));
  await render();
  await download();
  expect(generateCartonLabelPdfBlob).not.toHaveBeenCalled();
});
it('preserves the existing label when the server explicitly reports the feature disabled', async () => {
  vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: { enabled: false } } });
  await render();
  await download();
  expect(generateCartonLabelPdfBlob).toHaveBeenCalledWith(
    expect.objectContaining({ saleOrderNumber: 'DO1' }),
    expect.anything(),
  );
  expect(vi.mocked(generateCartonLabelPdfBlob).mock.calls[0]![0]).not.toHaveProperty('deliveryQr');
});
