/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../../lib/api-client.js';
import { HsnDescriptionRefresh } from './HsnDescriptionRefresh.js';
import type { HsnDescriptionRefreshPreview } from '../types.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(ui: ReactNode): void {
  act(() => {
    root.render(ui);
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mockPreview(preview: HsnDescriptionRefreshPreview) {
  return vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: preview } });
}

function clickButton(root: ParentNode, text: string) {
  const button = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text) as
    | HTMLButtonElement
    | undefined;
  if (!button) throw new Error(`Button "${text}" not found`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return button;
}

describe('HsnDescriptionRefresh', () => {
  it('previews, shows current/proposed in a ConfirmDialog, and stages on confirm', async () => {
    mockPreview({
      hsnId: 'hsn-1',
      currentDescription: 'Old description',
      proposedDescription: 'New description',
      isStale: true,
      canRefresh: true,
    });
    const onStage = vi.fn();
    render(<HsnDescriptionRefresh styleId="style-1" staged={null} onStage={onStage} />);

    clickButton(container, 'Refresh HSN Description');
    await flush();

    // ConfirmDialog renders via a Radix portal into document.body.
    expect(document.body.textContent).toContain('Old description');
    expect(document.body.textContent).toContain('New description');
    expect(onStage).not.toHaveBeenCalled();

    clickButton(document.body, 'Stage refresh');
    await flush();

    expect(onStage).toHaveBeenCalledWith({ hsnId: 'hsn-1', expectedDescription: 'New description' });
  });

  it('cancelling the dialog discards the preview without staging anything', async () => {
    mockPreview({
      hsnId: 'hsn-1',
      currentDescription: 'Old',
      proposedDescription: 'New',
      isStale: true,
      canRefresh: true,
    });
    const onStage = vi.fn();
    render(<HsnDescriptionRefresh styleId="style-1" staged={null} onStage={onStage} />);

    clickButton(container, 'Refresh HSN Description');
    await flush();
    expect(document.body.textContent).toContain('New');

    clickButton(document.body, 'Cancel');
    await flush();

    expect(onStage).not.toHaveBeenCalled();
  });

  it('shows an "already up to date" message and never opens the dialog when not stale', async () => {
    mockPreview({
      hsnId: 'hsn-1',
      currentDescription: 'Same',
      proposedDescription: 'Same',
      isStale: false,
      canRefresh: true,
    });
    render(<HsnDescriptionRefresh styleId="style-1" staged={null} onStage={() => {}} />);

    clickButton(container, 'Refresh HSN Description');
    await flush();

    expect(container.textContent).toContain('already up to date');
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows a "no HSN" message and never opens the dialog when canRefresh is false', async () => {
    mockPreview({
      hsnId: null,
      currentDescription: null,
      proposedDescription: null,
      isStale: false,
      canRefresh: false,
    });
    render(<HsnDescriptionRefresh styleId="style-1" staged={null} onStage={() => {}} />);

    clickButton(container, 'Refresh HSN Description');
    await flush();

    expect(container.textContent).toContain('no HSN selected');
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows a staged indicator and lets the user undo it', () => {
    const onStage = vi.fn();
    render(
      <HsnDescriptionRefresh
        styleId="style-1"
        staged={{ hsnId: 'hsn-1', expectedDescription: 'New description' }}
        onStage={onStage}
      />,
    );

    expect(container.textContent).toContain('staged');
    clickButton(container, 'Undo staged refresh');
    expect(onStage).toHaveBeenCalledWith(null);
  });
});
