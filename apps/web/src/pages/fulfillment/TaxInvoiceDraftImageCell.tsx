import type { TaxInvoiceDraftImage } from '@erve/types';
import { TaxInvoiceImageCell } from './TaxInvoiceImageCell.js';

export function TaxInvoiceDraftImageCell({
  invoiceId,
  styleId,
  image,
  styleNumber,
}: {
  invoiceId: string;
  styleId: string;
  image: TaxInvoiceDraftImage | null;
  styleNumber: string;
}) {
  return (
    <TaxInvoiceImageCell
      path={
        image
          ? `/tax-invoices/${encodeURIComponent(invoiceId)}/styles/${encodeURIComponent(styleId)}/images/${encodeURIComponent(image.id)}/content`
          : null
      }
      revision={image?.updatedAt}
      styleNumber={styleNumber}
      title={`Primary image · ${styleNumber}`}
      label={`View primary image for ${styleNumber}`}
    />
  );
}
