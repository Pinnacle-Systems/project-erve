/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobOrderStickyContext, type JobOrderStickyContextProps } from './JobOrderStickyContext.js';

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

const defaultProps: JobOrderStickyContextProps = {
  jobOrderNumber: 'JO-2026-001',
  style: { label: 'Summer Tee', multiple: false },
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

describe('JobOrderStickyContext', () => {
  it('renders disabled Confirm button with acknowledgement guidance when confirmDisabled is true', () => {
    act(() => {
      root.render(<JobOrderStickyContext {...defaultProps} />);
    });

    const confirmBtn = container.querySelector('button');
    expect(confirmBtn).not.toBeNull();
    expect(confirmBtn?.textContent).toBe('Confirm');
    expect(confirmBtn?.disabled).toBe(true);
    expect(confirmBtn?.className).toContain('bg-primary');

    expect(container.textContent).toContain(
      'Complete the acknowledgement below before confirming the Job Order.',
    );
  });

  it('renders enabled Confirm button and hides acknowledgement guidance when confirmDisabled is false', () => {
    act(() => {
      root.render(
        <JobOrderStickyContext
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
      'Complete the acknowledgement below before confirming the Job Order.',
    );
  });

  it('renders error message instead of acknowledgement guidance when confirmError is set', () => {
    act(() => {
      root.render(
        <JobOrderStickyContext
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
      'Complete the acknowledgement below before confirming the Job Order.',
    );
  });

  it('does not render Confirm button when canConfirm is false (authorization preserved)', () => {
    act(() => {
      root.render(
        <JobOrderStickyContext
          {...defaultProps}
          actions={{
            ...defaultProps.actions,
            canConfirm: false,
          }}
        />,
      );
    });

    expect(
      Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Confirm'),
    ).toBe(false);
    expect(container.textContent).not.toContain(
      'Complete the acknowledgement below before confirming the Job Order.',
    );
  });

  it('renders Send to Factory with primary styling when canSend is true', () => {
    act(() => {
      root.render(
        <JobOrderStickyContext
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
