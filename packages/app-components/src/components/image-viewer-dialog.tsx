import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { Dialog, DialogContent, DialogTitle } from '@erve/primitives';

export interface ImageViewerImage {
  /** null = failed to load or missing; the viewer shows the honest fallback instead of a broken image. */
  src: string | null;
  alt?: string;
  loading?: boolean;
}

export interface ImageViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  images: ImageViewerImage[];
  initialIndex?: number;
  /** Shown in the header bar, e.g. a Style Number — also doubles as the dialog's accessible title. */
  title?: ReactNode;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.5;

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function pointerDistance(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * Generic high-resolution image viewer: gallery navigation, wheel-zoom +
 * drag-pan, pinch-zoom + touch-drag-pan (plain pointer events, no gesture
 * library), double-click/tap to reset, keyboard navigation, and an honest
 * missing-image fallback. Domain-specific callers (e.g. Style images) wrap
 * this with their own data-fetching and pass resolved object-URLs in.
 */
export function ImageViewerDialog({ open, onOpenChange, images, initialIndex = 0, title }: ImageViewerDialogProps) {
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const pinchState = useRef<{ distance: number; scale: number } | null>(null);

  // Render-time reset (not an effect) when the dialog transitions open or the
  // caller changes the starting image — the same pattern `useAuthedImage`
  // uses for "reset derived state when an input changes" without a
  // setState-in-effect cascade.
  const openKey = open ? `open:${initialIndex}` : 'closed';
  const lastOpenKey = useRef(openKey);
  if (lastOpenKey.current !== openKey) {
    lastOpenKey.current = openKey;
    if (open) {
      setIndex(Math.min(Math.max(initialIndex, 0), Math.max(images.length - 1, 0)));
      setScale(1);
      setTranslate({ x: 0, y: 0 });
    }
  }

  const resetView = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const goTo = useCallback(
    (nextIndex: number) => {
      if (images.length === 0) return;
      const wrapped = (nextIndex + images.length) % images.length;
      setIndex(wrapped);
      resetView();
    },
    [images.length, resetView],
  );

  const zoomBy = useCallback((delta: number) => {
    setScale((current) => {
      const next = clampScale(current + delta);
      if (next === MIN_SCALE) setTranslate({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    zoomBy(event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scale <= MIN_SCALE) return;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragState.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: translate.x,
      originY: translate.y,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    const dx = event.clientX - dragState.current.startX;
    const dy = event.clientY - dragState.current.startY;
    setTranslate({ x: dragState.current.originX + dx, y: dragState.current.originY + dy });
  };

  const handlePointerUp = () => {
    dragState.current = null;
  };

  const handleDoubleClick = () => resetView();

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' && images.length > 1) {
      event.preventDefault();
      goTo(index - 1);
    } else if (event.key === 'ArrowRight' && images.length > 1) {
      event.preventDefault();
      goTo(index + 1);
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomBy(ZOOM_STEP);
    } else if (event.key === '-') {
      event.preventDefault();
      zoomBy(-ZOOM_STEP);
    }
  };

  const current = images[index];
  const hasMultiple = images.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="fixed inset-4 z-50 flex max-w-none flex-col overflow-hidden rounded-card border border-border bg-surface p-0 shadow-popover sm:inset-10"
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className="sr-only">{title ?? 'Image viewer'}</DialogTitle>
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            {title}
            {hasMultiple && (
              <span className="text-xs text-muted-foreground">
                {index + 1} / {images.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Zoom out"
              className="rounded-control px-2 py-1 text-sm hover:bg-surface-muted"
              onClick={() => zoomBy(-ZOOM_STEP)}
            >
              −
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              className="rounded-control px-2 py-1 text-sm hover:bg-surface-muted"
              onClick={() => zoomBy(ZOOM_STEP)}
            >
              +
            </button>
            <button
              type="button"
              aria-label="Close viewer"
              className="rounded-control px-2 py-1 text-sm hover:bg-surface-muted"
              onClick={() => onOpenChange(false)}
            >
              ✕
            </button>
          </div>
        </div>

        <div
          className="relative flex-1 touch-none overflow-hidden bg-[var(--erp-surface-overlay)]"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleDoubleClick}
          onTouchStart={(event) => {
            if (event.touches.length === 2) {
              pinchState.current = { distance: pointerDistance(event.touches[0]!, event.touches[1]!), scale };
            }
          }}
          onTouchMove={(event) => {
            if (event.touches.length === 2 && pinchState.current) {
              const nextDistance = pointerDistance(event.touches[0]!, event.touches[1]!);
              const ratio = nextDistance / Math.max(pinchState.current.distance, 1);
              setScale(clampScale(pinchState.current.scale * ratio));
            }
          }}
          onTouchEnd={() => {
            pinchState.current = null;
          }}
        >
          {!current || current.loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : current.src ? (
            <img
              src={current.src}
              alt={current.alt ?? ''}
              draggable={false}
              className="h-full w-full select-none object-contain"
              style={{
                transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
                cursor: scale > MIN_SCALE ? 'grab' : 'default',
              }}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <ImageViewerFallbackIcon />
              <span className="text-sm">Image unavailable</span>
            </div>
          )}

          {hasMultiple && (
            <>
              <button
                type="button"
                aria-label="Previous image"
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-surface/80 p-2 shadow-popover hover:bg-surface"
                onClick={() => goTo(index - 1)}
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="Next image"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-surface/80 p-2 shadow-popover hover:bg-surface"
                onClick={() => goTo(index + 1)}
              >
                ›
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImageViewerFallbackIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

ImageViewerDialog.displayName = 'ImageViewerDialog';
