import { useEffect, useRef, useState } from 'react';
import { useAuthedImage } from '../../lib/use-authed-image.js';
import type { StyleImage } from '../../pages/master-data/types.js';
import { StyleImageViewer } from './StyleImageViewer.js';

export interface StyleThumbnailCellProps {
  styleId: string;
  image: StyleImage | null;
  size?: number;
  /** Shown as the viewer's header title (e.g. the Style Number) when the thumbnail is clicked open. */
  viewerTitle?: string;
  /** When true (default) and an image is present, clicking the thumbnail opens the shared high-resolution viewer. */
  clickable?: boolean;
}

const DEFAULT_SIZE = 40;

/**
 * A dedicated component (not an inline DataTable render callback) because it hosts two hooks —
 * useAuthedImage and an IntersectionObserver — that need a real component to run correctly and to
 * stay independently testable. Lazy loading is genuine: the authenticated fetch (inside
 * StyleThumbnailImage/useAuthedImage) is only mounted once the cell is reported near-viewport, so
 * off-screen rows issue zero image requests.
 *
 * Promoted out of pages/master-data so every Style-bearing screen (Job Order, Order Sheet,
 * Dispatch Order, etc.) can import it without reaching into a page folder — see the Style image
 * coverage matrix in docs/SM-000-style-image-coverage-matrix.md.
 */
export function StyleThumbnailCell({
  styleId,
  image,
  size = DEFAULT_SIZE,
  viewerTitle,
  clickable = true,
}: StyleThumbnailCellProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Environments without IntersectionObserver (e.g. some test runners) render immediately —
  // decided once at init rather than via a synchronous setState inside the effect below.
  const [isNearViewport, setIsNearViewport] = useState(() => typeof IntersectionObserver === 'undefined');
  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => {
    if (isNearViewport) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isNearViewport]);

  const isClickable = clickable && Boolean(image);

  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center overflow-hidden rounded-[var(--erp-radius-sm)] bg-surface-muted"
      style={{ width: size, height: size }}
    >
      {isNearViewport && image ? (
        <StyleThumbnailImage styleId={styleId} image={image} />
      ) : (
        <StyleThumbnailPlaceholder />
      )}
      {isClickable && (
        <button
          type="button"
          aria-label="View style image"
          className="absolute inset-0 cursor-pointer focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary"
          onClick={(event) => {
            // Never let opening the viewer also trigger a parent row's own
            // click/navigation handler.
            event.stopPropagation();
            setViewerOpen(true);
          }}
        />
      )}
      {isClickable && (
        <StyleImageViewer
          styleId={styleId}
          initialImageId={image?.id ?? null}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          title={viewerTitle}
        />
      )}
    </div>
  );
}

function StyleThumbnailImage({ styleId, image }: { styleId: string; image: StyleImage }) {
  const { url, loading, error } = useAuthedImage(
    `/styles/${styleId}/images/${image.id}/content`,
    image.updatedAt,
  );

  if (error || (!loading && !url)) {
    return <StyleThumbnailPlaceholder />;
  }
  if (loading || !url) {
    return <div className="h-full w-full animate-pulse bg-surface-muted" />;
  }
  return <img src={url} alt="" className="h-full w-full object-contain" />;
}

function StyleThumbnailPlaceholder() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-1/2 w-1/2 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}
