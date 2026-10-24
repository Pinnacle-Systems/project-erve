import { describe, expect, it } from 'vitest';
import { resolveJobOrderSeasonSnapshot } from './resolveJobOrderSeasonSnapshot.js';
const summer = {
  seasonId: 's1',
  code: 'SS26',
  name: 'Summer',
  displayName: 'SS26 Summer',
};
describe('recorded Season resolution', () => {
  it('makes missing recorded data explicit', () => {
    expect(resolveJobOrderSeasonSnapshot([])).toEqual({
      kind: 'missing',
      label: 'No Season snapshot recorded',
    });
    expect(resolveJobOrderSeasonSnapshot(undefined).kind).toBe('missing');
  });
  it('shows a single persisted snapshot and equivalent repeats without mutation', () => {
    const snapshots = Object.freeze([Object.freeze({ ...summer }), Object.freeze({ ...summer })]);
    expect(resolveJobOrderSeasonSnapshot([...snapshots])).toEqual({
      kind: 'single',
      label: 'SS26 Summer',
    });
    expect(snapshots).toHaveLength(2);
  });
  it('exposes conflicting recorded values, including conflicts masked by equal display names', () => {
    const result = resolveJobOrderSeasonSnapshot([
      summer,
      { ...summer, seasonId: null, code: 'AW25', name: 'Winter' },
    ]);
    expect(result.kind).toBe('conflict');
    expect(result.label).toContain('Inconsistent recorded Season');
    expect(result.label).toContain('SS26');
    expect(result.label).toContain('AW25');
    expect(result.label).toContain('Winter');
  });
});
