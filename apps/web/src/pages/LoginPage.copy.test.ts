import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const loginPageSource = readFileSync(new URL('./LoginPage.tsx', import.meta.url), 'utf8');

describe('web login account wording', () => {
  it('uses role-neutral wording for all ERVE India users', () => {
    expect(loginPageSource).toContain('Sign in to your Erve account');
    expect(loginPageSource).not.toContain('Sign in to your distributor account');
  });
});
