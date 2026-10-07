import { useCallback } from 'react';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import type { FactoryPackingCartonView, PackingListDestinationView } from './types.js';

export interface CartonLabelButtonProps {
  carton: FactoryPackingCartonView;
  destination: PackingListDestinationView;
  saleOrderNumber: string;
  factoryName: string;
  factoryDispatchNumber: string | null;
  generatedByName?: string | null;
}

const NOT_INSPECTED_HINT = 'Carton must be Inspected before its label can be printed.';

/**
 * Per-carton Print/Download Label action for the Factory Packing List carton row. Deliberately
 * gated to `auditState === 'INSPECTED'` — the business requirement is that a final carton label
 * must come from confirmed/audited carton data, never a stale pre-audit or since-edited state
 * (`generateCartonLabelPdfBlob` enforces the same rule again as the actual choke point, so this
 * is a UX convenience, not the only guard). A retired/not-yet-audited carton still shows the
 * action, disabled, so the capability is discoverable rather than silently absent.
 */
export function CartonLabelButton({
  carton,
  destination,
  saleOrderNumber,
  factoryName,
  factoryDispatchNumber,
  generatedByName,
}: CartonLabelButtonProps) {
  const printable = carton.auditState === 'INSPECTED' && !carton.retired;

  const generate = useCallback(async () => {
    const { generateCartonLabelPdfBlob } = await import('./pdf/carton-label/generateCartonLabelPdf.js');
    return generateCartonLabelPdfBlob(
      { carton, destination, saleOrderNumber, factoryName, factoryDispatchNumber },
      { generatedAt: new Date().toISOString(), generatedBy: generatedByName },
    );
  }, [carton, destination, saleOrderNumber, factoryName, factoryDispatchNumber, generatedByName]);

  const pdfAction = usePdfAction({
    generate,
    filename: () => buildPdfFilename(['ERVE-Carton-Label', saleOrderNumber, carton.cartonNumber]),
  });

  return (
    <PdfActionButtons
      density="compact"
      downloadLabel="Download Label"
      printLabel="Print Label"
      isGenerating={pdfAction.isGenerating}
      error={pdfAction.error}
      onDownload={pdfAction.handleDownload}
      onPrint={pdfAction.handlePrint}
      disabled={!printable}
      disabledHint={printable ? undefined : NOT_INSPECTED_HINT}
    />
  );
}
