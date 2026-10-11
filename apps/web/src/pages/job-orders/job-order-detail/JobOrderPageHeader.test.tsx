/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobOrderPrimaryStyle } from '../resolveJobOrderPrimaryStyle.js';
import { JobOrderPageHeader, type JobOrderPageHeaderProps } from './JobOrderPageHeader.js';

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
  vi.restoreAllMocks();
});

function line(overrides: Partial<JobOrderPrimaryStyle> = {}): JobOrderPrimaryStyle {
  return { styleId: 'style-1', styleNumber: 'STY-0001', styleName: 'Basic Tee', primaryImage: null, ...overrides };
}

function render(props: Partial<JobOrderPageHeaderProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pdfAction = {
    isGenerating: false,
    error: null,
    handleDownload: vi.fn(),
    handlePrint: vi.fn(),
  } as unknown as JobOrderPageHeaderProps['pdfAction'];
  act(() => {
    root.render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <JobOrderPageHeader
            jobOrderNumber="JO-2026-001"
            factoryName="Sunrise Textiles"
            lines={[line()]}
            pdfAction={pdfAction}
            {...props}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
}

describe('JobOrderPageHeader', () => {
  it('shows the Style thumbnail when every line shares one Style (the normal case)', () => {
    render({ lines: [line(), line()] });
    expect(container.querySelector('svg, img')).not.toBeNull();
  });

  it('renders the explicit "identity unavailable" marker — never nothing, never a guess — when lines reference different Styles', () => {
    render({ lines: [line(), line({ styleId: 'style-2', styleNumber: 'STY-0002' })] });
    const marker = container.querySelector('[role="img"]');
    expect(marker).not.toBeNull();
    expect(marker!.getAttribute('aria-label')).toMatch(/unavailable/i);
  });

  it('renders the explicit "identity unavailable" marker for a Job Order with no lines at all', () => {
    render({ lines: [] });
    const marker = container.querySelector('[role="img"]');
    expect(marker).not.toBeNull();
    expect(marker!.getAttribute('aria-label')).toMatch(/unavailable/i);
  });
});
