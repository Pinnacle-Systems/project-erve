import { describe, expect, it } from 'vitest';
import type { Season } from '../types.js';
import { buildSeasonListViewModel } from './buildSeasonListViewModel.js';

function makeSeason(overrides: Partial<Season> = {}): Season {
  return {
    id: 'season-1',
    code: 'SS26',
    name: 'Summer 26',
    displayName: 'SS26',
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('buildSeasonListViewModel', () => {
  it('maps seasons into rows, preserving API row order', () => {
    const seasons = [
      makeSeason({ id: 'a', code: 'SS26' }),
      makeSeason({ id: 'b', code: 'AW26' }),
    ];
    const vm = buildSeasonListViewModel(seasons, {}, { generatedAt: '2026-09-12T00:00:00Z' });

    expect(vm.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(vm.rows[0]).toMatchObject({ code: 'SS26', displayName: 'SS26' });
    expect(vm.totalCount).toBe(2);
  });

  it('handles an empty season list', () => {
    const vm = buildSeasonListViewModel([], {}, { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.rows).toEqual([]);
    expect(vm.totalCount).toBe(0);
  });

  it('carries through generatedBy when provided', () => {
    const vm = buildSeasonListViewModel(
      [],
      {},
      { generatedAt: '2026-09-12T00:00:00Z', generatedBy: 'Test Admin' },
    );
    expect(vm.generatedBy).toBe('Test Admin');
  });
});
