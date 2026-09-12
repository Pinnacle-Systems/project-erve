import { useEffect, useRef, useState } from 'react';
import { useAuthedImage } from '../../lib/use-authed-image.js';
import type { StyleImage } from './types.js';

export interface StyleThumbnailCellProps {
  styleId: string;
  image: StyleImage | null;
  size?: number;
}

const DEFAULT_SIZE = 40;

/**
 * A dedicated component (not an inline DataTable render callback) because it hosts two hooks —
 * useAuthedImage and an IntersectionObserver — that need a real component to run correctly and to
 * stay independently testable. Lazy loading is genuine: the authenticated fetch (inside
 * StyleThumbnailImage/useAuthedImage) is only mounted once the cell is reported near-viewport, so
 * off-screen rows issue zero image requests.
 */
export function StyleThumbnailCell({ styleId, image, size = DEFAULT_SIZE }: StyleThumbnailCellProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Environments without IntersectionObserver (e.g. some test runners) render immediately —
  // decided once at init rather than via a synchronous setState inside the effect below.
  const [isNearViewport, setIsNearViewport] = useState(() => typeof IntersectionObserver === 'undefined');

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

  return (
    <div
      ref={containerRef}
      className="flex items-center justify-center overflow-hidden rounded-[var(--erp-radius-sm)] bg-surface-muted"
      style={{ width: size, height: size }}
    >
      {isNearViewport && image ? (
        <StyleThumbnailImage styleId={styleId} image={image} />
      ) : (
        <StyleThumbnailPlaceholder />
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
