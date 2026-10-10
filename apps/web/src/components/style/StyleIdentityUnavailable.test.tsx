/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StyleIdentityUnavailable } from './StyleIdentityUnavailable.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('StyleIdentityUnavailable', () => {
  it('renders an accessible, explicit "unavailable" marker — never an empty box', () => {
    act(() => root.render(<StyleIdentityUnavailable />));
    const marker = container.querySelector('[role="img"]');
    expect(marker).not.toBeNull();
    expect(marker!.getAttribute('aria-label')).toMatch(/unavailable/i);
    expect(marker!.querySelector('svg')).not.toBeNull();
  });

  it('accepts a custom reason, surfaced as both the accessible label and the tooltip', () => {
    act(() => root.render(<StyleIdentityUnavailable reason="Lines disagree on Style" />));
    const marker = container.querySelector('[role="img"]')!;
    expect(marker.getAttribute('aria-label')).toBe('Lines disagree on Style');
    expect(marker.getAttribute('title')).toBe('Lines disagree on Style');
  });

  it('sizes the box from the size prop, matching StyleThumbnailCell\'s convention', () => {
    act(() => root.render(<StyleIdentityUnavailable size={96} />));
    const marker = container.querySelector('[role="img"]') as HTMLElement;
    expect(marker.style.width).toBe('96px');
    expect(marker.style.height).toBe('96px');
  });
});
