/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobOrderPageHeader, type JobOrderPageHeaderProps } from './JobOrderPageHeader.js';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

const defaultProps: JobOrderPageHeaderProps = {
  jobOrderNumber: 'JO-2026-001',
  lines: [],
  seasonSnapshots: [],
  pdfAction: { isGenerating: false, error: null, handleDownload: vi.fn(), handlePrint: vi.fn() },
  factoryName: 'Sunrise Textiles',
  isDelayed: false,
  operationalPresentation: {
    heading: 'Current State',
    name: 'Sent to Factory',
    stateLabel: 'Pending Confirmation',
    tone: 'pending',
    secondaryLanes: [],
  },
  actions: {
    canSend: false,
    onSend: vi.fn(),
    sendError: '',
    canConfirm: true,
    onConfirm: vi.fn(),
    confirmPending: false,
    confirmDisabled: true,
    confirmError: '',
    canCancelJobOrder: false,
    onCancel: vi.fn(),
  },
};

function renderHeader(element: ReactNode) {
  root.render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>{element}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('JobOrderPageHeader actions', () => {
  it('renders disabled Confirm button with acknowledgement guidance when confirmDisabled is true', () => {
    act(() => {
      renderHeader(<JobOrderPageHeader {...defaultProps} />);
    });

    const confirmBtn = container.querySelector('button');
    expect(confirmBtn).not.toBeNull();
    expect(confirmBtn?.textContent).toBe('Confirm');
    expect(confirmBtn?.disabled).toBe(true);
    expect(confirmBtn?.className).toContain('bg-primary');

    expect(container.textContent).toContain(
      'Review and acknowledge the disclaimer in Production before confirming.',
    );
  });

  it('renders enabled Confirm button and hides acknowledgement guidance when confirmDisabled is false', () => {
    act(() => {
      renderHeader(
        <JobOrderPageHeader
          {...defaultProps}
          actions={{
            ...defaultProps.actions,
            confirmDisabled: false,
          }}
        />,
      );
    });

    const confirmBtn = container.querySelector('button');
    expect(confirmBtn?.disabled).toBe(false);
    expect(container.textContent).not.toContain(
      'Review and acknowledge the disclaimer in Production before confirming.',
    );
  });

  it('renders error message instead of acknowledgement guidance when confirmError is set', () => {
    act(() => {
      renderHeader(
        <JobOrderPageHeader
          {...defaultProps}
          actions={{
            ...defaultProps.actions,
            confirmDisabled: true,
            confirmError: 'Failed to confirm Job Order on server',
          }}
        />,
      );
    });

    expect(container.textContent).toContain('Failed to confirm Job Order on server');
    expect(container.textContent).not.toContain(
      'Review and acknowledge the disclaimer in Production before confirming.',
    );
  });

  it('does not render Confirm button when canConfirm is false (authorization preserved)', () => {
    act(() => {
      renderHeader(
        <JobOrderPageHeader
          {...defaultProps}
          actions={{
            ...defaultProps.actions,
            canConfirm: false,
          }}
        />,
      );
    });

    expect(
      Array.from(container.querySelectorAll('button')).some(
        (b) => b.textContent?.trim() === 'Confirm',
      ),
    ).toBe(false);
    expect(container.textContent).not.toContain(
      'Review and acknowledge the disclaimer in Production before confirming.',
    );
  });

  it('renders Send to Factory with primary styling when canSend is true', () => {
    act(() => {
      renderHeader(
        <JobOrderPageHeader
          {...defaultProps}
          actions={{
            ...defaultProps.actions,
            canConfirm: false,
            canSend: true,
          }}
        />,
      );
    });

    const sendBtn = container.querySelector('button');
    expect(sendBtn?.textContent).toBe('Send to Factory');
    expect(sendBtn?.className).toContain('bg-primary');
  });
});
