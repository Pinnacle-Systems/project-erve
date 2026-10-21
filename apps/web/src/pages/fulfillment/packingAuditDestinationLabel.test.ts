import { describe, expect, it } from 'vitest';
import type { PackingAuditQueueItem } from './types.js';
import { packingAuditDestinationLabel } from './packingAuditDestinationLabel.js';

const destination: PackingAuditQueueItem['destination'] = {
  id: 'destination-1',
  label: 'Outlet North',
  city: 'Chennai',
  state: 'Tamil Nadu',
  distributor: { id: 'distributor-1', code: 'D1', name: 'Distributor North' },
};

describe('packingAuditDestinationLabel', () => {
  it('retains the destination name and locality for normal data', () => {
    expect(packingAuditDestinationLabel(destination)).toBe('Outlet North · Chennai, Tamil Nadu');
  });

  it('shows the locality when the name is unavailable', () => {
    expect(packingAuditDestinationLabel({ ...destination, label: null })).toBe('Chennai, Tamil Nadu');
  });

  it('ignores whitespace-only locality components', () => {
    expect(
      packingAuditDestinationLabel({ ...destination, label: '  ', city: '  ', state: ' Tamil Nadu ' }),
    ).toBe('Tamil Nadu');
  });

  it('uses a readable fallback rather than an empty table cell', () => {
    expect(
      packingAuditDestinationLabel({ ...destination, label: null, city: ' ', state: '' }),
    ).toBe('Destination unavailable');
  });
});
