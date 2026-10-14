import { describe, it, expect } from 'vitest';
import { assertUnissuedDraft, assertNoUncertainRequest } from './pr8-acceptance-state.js';
describe('PR8 operational acceptance recovery guards', () => {
  it('refuses a previously accepted draft that has since been finalized', () => {
    expect(() => assertUnissuedDraft({ status: 'FINALIZED', invoiceNumber: 'EI-1' }, 1)).toThrow();
    expect(() => assertUnissuedDraft({ status: 'DRAFT', invoiceNumber: null }, 1)).toThrow();
    expect(() => assertUnissuedDraft(null, 0)).toThrow();
    expect(() => assertUnissuedDraft({ status: 'DRAFT', invoiceNumber: null }, 0)).not.toThrow();
  });
  it('fails closed when HTTP commit and durable checkpoint may have diverged', () => {
    expect(() => assertNoUncertainRequest({ request: { route: '/purchase-orders' } }, {})).toThrow(
      'reconciliation',
    );
    expect(() =>
      assertNoUncertainRequest(
        { request: { route: '/purchase-orders' } },
        { request: { id: 'known-result' } },
      ),
    ).not.toThrow();
  });
});
