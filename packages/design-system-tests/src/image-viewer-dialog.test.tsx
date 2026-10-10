/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ImageViewerDialog, type ImageViewerImage } from '@erve/app-components';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Radix Dialog's content measures layout via ResizeObserver in some code
  // paths — unimplemented in jsdom.
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const images: ImageViewerImage[] = [
  { src: 'blob:one', alt: 'Style ABC123 image 1' },
  { src: 'blob:two', alt: 'Style ABC123 image 2' },
];

describe('ImageViewerDialog — gallery navigation, zoom, fallback', () => {
  it('renders the image at the initial index and an accessible title', () => {
    act(() => {
      root.render(
        <ImageViewerDialog open onOpenChange={() => {}} images={images} title="ABC123" />,
      );
    });

    const img = document.body.querySelector('img') as HTMLImageElement;
    expect(img.src).toContain('blob:one');
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
    expect(document.body.textContent).toContain('1 / 2');
  });

  it('navigates to the next/previous image via the gallery buttons and resets zoom', () => {
    act(() => {
      root.render(
        <ImageViewerDialog open onOpenChange={() => {}} images={images} title="ABC123" />,
      );
    });

    const nextButton = document.body.querySelector('[aria-label="Next image"]') as HTMLButtonElement;
    act(() => nextButton.click());

    const img = document.body.querySelector('img') as HTMLImageElement;
    expect(img.src).toContain('blob:two');
    expect(document.body.textContent).toContain('2 / 2');

    const prevButton = document.body.querySelector('[aria-label="Previous image"]') as HTMLButtonElement;
    act(() => prevButton.click());
    expect((document.body.querySelector('img') as HTMLImageElement).src).toContain('blob:one');
  });

  it('zooms in via the zoom-in button and resets on double-click', () => {
    act(() => {
      root.render(
        <ImageViewerDialog open onOpenChange={() => {}} images={[images[0]!]} title="ABC123" />,
      );
    });

    const zoomIn = document.body.querySelector('[aria-label="Zoom in"]') as HTMLButtonElement;
    act(() => zoomIn.click());
    act(() => zoomIn.click());

    const img = document.body.querySelector('img') as HTMLImageElement;
    expect(img.style.transform).toContain('scale(2)');

    const stage = img.parentElement as HTMLElement;
    act(() => {
      stage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect((document.body.querySelector('img') as HTMLImageElement).style.transform).toContain('scale(1)');
  });

  it('shows the honest missing-image fallback instead of a broken <img> when src is null', () => {
    act(() => {
      root.render(
        <ImageViewerDialog
          open
          onOpenChange={() => {}}
          images={[{ src: null, alt: 'No image' }]}
          title="ABC123"
        />,
      );
    });

    expect(document.body.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('Image unavailable');
  });

  it('calls onOpenChange(false) when the close button is clicked', () => {
    const onOpenChange = vi.fn();
    act(() => {
      root.render(
        <ImageViewerDialog open onOpenChange={onOpenChange} images={images} title="ABC123" />,
      );
    });

    const closeButton = document.body.querySelector('[aria-label="Close viewer"]') as HTMLButtonElement;
    act(() => closeButton.click());

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
