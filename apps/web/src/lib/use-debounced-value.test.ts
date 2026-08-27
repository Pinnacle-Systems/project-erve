/** @vitest-environment jsdom */
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './use-debounced-value.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function Probe({
  value,
  delayMs,
  onValue,
}: {
  value: string;
  delayMs: number;
  onValue: (value: string) => void;
}) {
  const debounced = useDebouncedValue(value, delayMs);
  onValue(debounced);
  return null;
}

function renderProbe(value: string, delayMs: number, onValue: (value: string) => void) {
  act(() => {
    root.render(createElement(Probe, { value, delayMs, onValue }));
  });
}

describe('useDebouncedValue', () => {
  it('exposes the initial value immediately, with no delay', () => {
    const seen: string[] = [];
    renderProbe('a', 300, (v) => seen.push(v));
    expect(seen.at(-1)).toBe('a');
  });

  it('does not adopt a changed value before the delay elapses', async () => {
    const seen: string[] = [];
    renderProbe('a', 300, (v) => seen.push(v));
    renderProbe('ab', 300, (v) => seen.push(v));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });

    expect(seen.at(-1)).toBe('a');
  });

  it('adopts the latest value once the delay elapses', async () => {
    const seen: string[] = [];
    renderProbe('a', 300, (v) => seen.push(v));
    renderProbe('ab', 300, (v) => seen.push(v));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(seen.at(-1)).toBe('ab');
  });

  it('resets the timer on every change and only commits the final value', async () => {
    const seen: string[] = [];
    renderProbe('a', 300, (v) => seen.push(v));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    renderProbe('b', 300, (v) => seen.push(v)); // scheduled to fire at t=350 if never superseded

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    renderProbe('c', 300, (v) => seen.push(v)); // scheduled to fire at t=400; must clear b's pending timer

    // t=360: b's would-be timer has passed, c's has not — a broken cleanup
    // would have let the stale "b" update land here.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(260);
    });
    expect(seen.at(-1)).toBe('a');

    // t=410: c's timer has now elapsed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(seen.at(-1)).toBe('c');
    expect(seen).not.toContain('b');
  });

  it('only the final value survives a burst of rapid changes within the debounce window', async () => {
    const seen: string[] = [];
    const keystrokes = ['E', 'EI', 'EIP', 'EIPO', 'EIPO/', 'EIPO/2', 'EIPO/26'];

    for (const value of keystrokes) {
      renderProbe(value, 300, (v) => seen.push(v));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50); // well inside the 300ms window
      });
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(seen.at(-1)).toBe('EIPO/26');
    for (const intermediate of ['EI', 'EIP', 'EIPO', 'EIPO/', 'EIPO/2']) {
      expect(seen).not.toContain(intermediate);
    }
  });

  it('clears its pending timer on unmount so no update applies afterward', () => {
    const clearSpy = vi.spyOn(global, 'clearTimeout');
    renderProbe('a', 300, () => {});
    renderProbe('b', 300, () => {}); // supersedes the "a" timer; cleanup should clear it
    const callsBeforeUnmount = clearSpy.mock.calls.length;
    expect(callsBeforeUnmount).toBeGreaterThan(0);

    act(() => root.unmount());
    expect(clearSpy.mock.calls.length).toBeGreaterThan(callsBeforeUnmount);

    clearSpy.mockRestore();
  });
});
