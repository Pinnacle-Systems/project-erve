import { useEffect, useRef, useState } from 'react';
import { ImageViewerDialog } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { useAuthedImage } from '../../lib/use-authed-image.js';

/** Local invoice adapter: lazy authenticated media, shared viewer, no master/gallery lookups. */
export function TaxInvoiceImageCell(props: {
  path: string | null;
  revision?: string;
  styleNumber: string;
  title: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);
  return (
    <div ref={ref} className="flex h-12 w-12 shrink-0 items-center justify-center">
      {visible ? (
        <ResolvedInvoiceImage {...props} />
      ) : (
        <span className="text-xs text-muted-foreground">Loading</span>
      )}
    </div>
  );
}

function ResolvedInvoiceImage({
  path,
  revision,
  styleNumber,
  title,
  label,
}: {
  path: string | null;
  revision?: string;
  styleNumber: string;
  title: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const resolved = useAuthedImage(path, revision);
  if (!path || resolved.error)
    return <span className="text-center text-xs text-muted-foreground">Image unavailable</span>;
  return (
    <>
      <Button
        ref={opener}
        variant="ghost"
        className="h-12 w-12 p-1"
        aria-label={label}
        disabled={resolved.loading || !resolved.url}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {resolved.url ? (
          <img className="h-10 w-10 object-contain" src={resolved.url} alt={styleNumber} />
        ) : (
          <span className="text-xs">Loading</span>
        )}
      </Button>
      <ImageViewerDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) window.setTimeout(() => opener.current?.focus(), 0);
        }}
        title={title}
        images={[{ src: resolved.url, alt: styleNumber, loading: resolved.loading }]}
      />
    </>
  );
}
