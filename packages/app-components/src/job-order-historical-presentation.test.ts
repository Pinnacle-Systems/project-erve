import { describe, expect, it } from 'vitest';
import {
  formatPreparedQuantity,
  formatPreparedVariance,
  getRecordedPreparedQuantity,
  isHistoricalImportJobOrder,
} from './job-order-historical-presentation.js';

const historical = { historicalImport: { legacyReferenceNumber: 'EI25018' } };
const live = { historicalImport: null };

describe('job order historical presentation', () => {
  it('treats only a non-null historicalImport marker as historical', () => {
    expect(isHistoricalImportJobOrder(historical)).toBe(true);
    expect(isHistoricalImportJobOrder(live)).toBe(false);
    expect(isHistoricalImportJobOrder({})).toBe(false);
  });

  it('never turns an unrecorded historical prepared quantity into 0', () => {
    expect(getRecordedPreparedQuantity(historical, 0)).toBeNull();
    expect(formatPreparedQuantity(historical, 0)).toBe('Not recorded');
    expect(formatPreparedVariance(historical, 0, 1008)).toBe('Not applicable');
  });

  it('keeps a recorded live 0 as 0 and formats live quantities exactly as before', () => {
    expect(getRecordedPreparedQuantity(live, 0)).toBe(0);
    expect(formatPreparedQuantity(live, 0)).toBe((0).toLocaleString());
    expect(formatPreparedQuantity(live, 1008)).toBe((1008).toLocaleString());
    expect(formatPreparedVariance(live, 1000, 1008)).toBe((-8).toLocaleString());
  });
});
