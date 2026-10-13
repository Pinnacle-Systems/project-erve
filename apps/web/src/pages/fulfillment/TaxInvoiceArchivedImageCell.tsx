import type { TaxInvoiceArchivedImage } from '@erve/types';
import { TaxInvoiceImageCell } from './TaxInvoiceImageCell.js';

/** Issued archive adapter; never uses Style media URLs. */
export function TaxInvoiceArchivedImageCell({
  invoiceId,
  image,
  styleNumber,
}: {
  invoiceId: string;
  image: TaxInvoiceArchivedImage | null;
  styleNumber: string;
}) {
  return (
    <TaxInvoiceImageCell
      path={
        image
          ? '/tax-invoices/' +
            encodeURIComponent(invoiceId) +
            '/images/' +
            encodeURIComponent(image.id) +
            '/content'
          : null
      }
      revision={image?.checksumSha256}
      styleNumber={styleNumber}
      title={'Issued image · ' + styleNumber}
      label={'View issued image for ' + styleNumber}
    />
  );
}
