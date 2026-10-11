import { useState } from 'react';
import type { TaxInvoiceArchivedImage } from '@erve/types';
import { ImageViewerDialog } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { useAuthedImage } from '../../lib/use-authed-image.js';

/** Invoice adapter for the shared image hook/viewer; never uses Style media URLs. */
export function TaxInvoiceArchivedImageCell({
  invoiceId,
  image,
  styleNumber,
}: {
  invoiceId: string;
  image: TaxInvoiceArchivedImage | null;
  styleNumber: string;
}) {
  const [open, setOpen] = useState(false);
  const resolved = useAuthedImage(
    image ? `/tax-invoices/${invoiceId}/images/${image.id}/content` : null,
    image?.checksumSha256,
  );
  if (!image || resolved.error)
    return <span className="text-xs text-muted-foreground">Image unavailable</span>;
  return (
    <>
      <Button
        variant="ghost"
        className="h-12 w-12 p-1"
        aria-label={`View issued image for ${styleNumber}`}
        disabled={resolved.loading || !resolved.url}
        onClick={() => setOpen(true)}
      >
        {resolved.url ? (
          <img className="h-10 w-10 object-contain" src={resolved.url} alt={styleNumber} />
        ) : (
          <span className="text-xs">Loading</span>
        )}
      </Button>
      <ImageViewerDialog
        open={open}
        onOpenChange={setOpen}
        title={`Issued image · ${styleNumber}`}
        images={[{ src: resolved.url, alt: styleNumber, loading: resolved.loading }]}
      />
    </>
  );
}
