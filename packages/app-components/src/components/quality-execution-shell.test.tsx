/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QualityExecutionPageShell } from './quality-execution-shell.js';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('QualityExecutionPageShell parent navigation', () => {
  it('renders an accessible, responsive Job Order link with shared interaction styling', () => {
    act(() =>
      root.render(
        <QualityExecutionPageShell jobOrderId="job-1" jobOrderNumber="JO-2026-000001">
          <h1>Inline Inspection</h1>
        </QualityExecutionPageShell>,
      ),
    );

    const link = container.querySelector('nav a')!;
    expect(link.getAttribute('href')).toBe('/job-orders/job-1');
    expect(link.getAttribute('aria-label')).toBe('Back to Job Order JO-2026-000001');
    expect(link.textContent).toContain('Job Order JO-2026-000001');
    expect(link.querySelector('[aria-hidden="true"]')?.textContent).toBe('←');
    expect(link.className).toContain('min-h-10');
    expect(link.className).toContain('hover:underline');
    expect(link.className).toContain('focus-visible:outline');
    expect(link.querySelector('.truncate')).not.toBeNull();
  });

  it('uses the parent AppShell gutters without adding QA-only padding or a max-width cap', () => {
    act(() =>
      root.render(
        <QualityExecutionPageShell jobOrderId="job-1" jobOrderNumber="JO-2026-000001">
          <h1>PP Sample</h1>
        </QualityExecutionPageShell>,
      ),
    );
    const shell = container.querySelector('[data-quality-execution-shell="true"]') as HTMLElement;
    expect(shell.classList.contains('min-w-0')).toBe(true);
    expect(shell.className).not.toMatch(/(?:^|\\s)(?:px-|sm:px-|lg:px-|py-)/);
    const content = shell.firstElementChild as HTMLElement;
    expect(content.classList.contains('w-full')).toBe(true);
    expect(content.classList.contains('min-w-0')).toBe(true);
    expect(content.className).not.toContain('max-w-');
  });

  it('renders optional page-level actions alongside the back link when provided', () => {
    act(() =>
      root.render(
        <QualityExecutionPageShell
          jobOrderId="job-1"
          jobOrderNumber="JO-2026-000001"
          actions={<button type="button">Download PDF</button>}
        >
          <h1>Inline Inspection</h1>
        </QualityExecutionPageShell>,
      ),
    );

    const nav = container.querySelector('nav')!;
    expect(nav.querySelector('button')?.textContent).toBe('Download PDF');
  });

  it('omits the actions wrapper entirely when no actions are provided', () => {
    act(() =>
      root.render(
        <QualityExecutionPageShell jobOrderId="job-1" jobOrderNumber="JO-2026-000001">
          <h1>Inline Inspection</h1>
        </QualityExecutionPageShell>,
      ),
    );

    expect(container.querySelector('nav button')).toBeNull();
  });
});
