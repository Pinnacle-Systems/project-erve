import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const loginPageSource = readFileSync(new URL('./LoginPage.tsx', import.meta.url), 'utf8');
const loginFormSource = readFileSync(
  new URL('../components/LoginForm.tsx', import.meta.url),
  'utf8',
);
const appStyles = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

function ruleFor(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return appStyles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('mobile login layout', () => {
  it('centres the login card between separate logo and footer rows', () => {
    expect(loginPageSource).toContain('className="login-page');
    expect(loginPageSource).toContain('<header className="login-logo');
    expect(loginPageSource).toContain('<main className="login-main"');
    expect(loginPageSource.indexOf('login-logo')).toBeLessThan(
      loginPageSource.indexOf('login-main'),
    );
    expect(loginPageSource.indexOf('login-main')).toBeLessThan(loginPageSource.indexOf('<footer'));
    expect(ruleFor('.login-page')).toContain('grid-template-rows: auto minmax(0, 1fr) auto');
    expect(ruleFor('.login-main')).toContain('align-items: center');
    expect(ruleFor('.login-main')).toContain('padding: 1rem 1rem clamp(2.5rem, 7vh, 4rem)');
  });

  it('fills only the login card and keeps its desktop width constrained', () => {
    expect(ruleFor('.login-card')).toContain('width: 100%');
    expect(ruleFor('.login-card')).toContain('max-width: 26.25rem');
    expect(ruleFor('.login-card input')).toContain('width: 100%');
    expect(ruleFor('.login-card input')).toContain('max-width: none');
    expect(ruleFor('.login-card input')).toContain('box-sizing: border-box');
    expect(loginFormSource.match(/width="fill"/g) ?? []).toHaveLength(3);
    expect(loginFormSource).toContain('className="w-full"');

    const selectorsTargetingInputs = Array.from(appStyles.matchAll(/([^{}]+)\{/g))
      .map((match) => match[1]?.trim())
      .filter((selector): selector is string => Boolean(selector))
      .filter((selector) => /\binput\b/.test(selector));
    expect(selectorsTargetingInputs).toEqual(['.login-card input']);
  });

  it('switches to natural scrolling and top alignment on short screens', () => {
    expect(appStyles).toMatch(/@media \(max-height: 650px\)/);
    const shortScreenStyles = appStyles.slice(appStyles.indexOf('@media (max-height: 650px)'));
    expect(shortScreenStyles).toMatch(/\.login-page\s*\{[^}]*overflow-y: auto/s);
    expect(shortScreenStyles).toMatch(
      /\.login-main\s*\{[^}]*align-items: flex-start[^}]*padding: 1.5rem 1rem/s,
    );
  });
});
