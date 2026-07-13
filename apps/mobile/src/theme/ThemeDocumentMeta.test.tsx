/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from '@erve/theme';

import { ThemeDocumentMeta } from './ThemeDocumentMeta.js';

function flushFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

let container: HTMLDivElement;
let root: Root;
let meta: HTMLMetaElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  meta = document.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('data-erve-theme-color', '');
  meta.setAttribute('content', '#eef3f8');
  document.head.appendChild(meta);

  document.documentElement.style.cssText = '';
  document.documentElement.className = '';
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  meta.remove();
});

describe('mobile ThemeDocumentMeta', () => {
  it('writes the light app-background value for resolved light', async () => {
    document.documentElement.style.setProperty('--erp-color-app-bg', '#eef3f8');
    act(() => {
      root.render(
        <ThemeProvider colorMode="light">
          <ThemeDocumentMeta />
        </ThemeProvider>,
      );
    });
    await flushFrame();

    expect(meta.getAttribute('content')).toBe('#eef3f8');
  });

  it('writes the dark app-background value for resolved dark', async () => {
    document.documentElement.style.setProperty('--erp-color-app-bg', '#020617');
    act(() => {
      root.render(
        <ThemeProvider colorMode="dark">
          <ThemeDocumentMeta />
        </ThemeProvider>,
      );
    });
    await flushFrame();

    expect(meta.getAttribute('content')).toBe('#020617');
  });

  it('updates the same meta element on runtime switching, without duplicating it', async () => {
    document.documentElement.style.setProperty('--erp-color-app-bg', '#eef3f8');
    act(() => {
      root.render(
        <ThemeProvider colorMode="light">
          <ThemeDocumentMeta />
        </ThemeProvider>,
      );
    });
    await flushFrame();
    expect(meta.getAttribute('content')).toBe('#eef3f8');

    document.documentElement.style.setProperty('--erp-color-app-bg', '#020617');
    act(() => {
      root.render(
        <ThemeProvider colorMode="dark">
          <ThemeDocumentMeta />
        </ThemeProvider>,
      );
    });
    await flushFrame();

    expect(meta.getAttribute('content')).toBe('#020617');
    expect(document.querySelectorAll('meta[data-erve-theme-color]')).toHaveLength(1);
  });

  it('does nothing (and never throws) when the meta element is missing', async () => {
    meta.remove();

    expect(() => {
      act(() => {
        root.render(
          <ThemeProvider colorMode="dark">
            <ThemeDocumentMeta />
          </ThemeProvider>,
        );
      });
    }).not.toThrow();

    await flushFrame();
  });

  it('cancels a pending frame on unmount', async () => {
    document.documentElement.style.setProperty('--erp-color-app-bg', '#eef3f8');
    act(() => {
      root.render(
        <ThemeProvider colorMode="light">
          <ThemeDocumentMeta />
        </ThemeProvider>,
      );
    });

    act(() => {
      root.unmount();
    });
    const before = meta.getAttribute('content');

    await flushFrame();
    expect(meta.getAttribute('content')).toBe(before);
  });
});
