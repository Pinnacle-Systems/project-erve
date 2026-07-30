/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@erve/theme';
import { LoginForm } from './LoginForm.js';

describe('LoginForm', () => {
  const containers: HTMLDivElement[] = [];

  afterEach(() => {
    containers.splice(0).forEach((container) => container.remove());
  });

  it('shows and hides the password from the inlaid eye button', () => {
    const container = document.createElement('div');
    containers.push(container);
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ThemeProvider theme="default" density="comfortable">
          <LoginForm onSubmit={vi.fn()} />
        </ThemeProvider>,
      );
    });

    const passwordInput = container.querySelector('#password') as HTMLInputElement;
    expect(passwordInput.type).toBe('password');

    act(() => {
      (container.querySelector('[aria-label="Show password"]') as HTMLButtonElement).click();
    });
    expect(passwordInput.type).toBe('text');
    expect(container.querySelector('[aria-label="Hide password"]')).not.toBeNull();

    act(() => {
      root.unmount();
    });
  });
});
