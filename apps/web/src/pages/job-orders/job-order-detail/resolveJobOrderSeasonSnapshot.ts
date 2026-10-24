import type { JobOrder } from '../types.js';

type SeasonResolution = { kind: 'missing' | 'single' | 'conflict'; label: string };

/** Resolve recorded evidence only. Never consult or alter the current Style master. */
export function resolveJobOrderSeasonSnapshot(
  snapshots: JobOrder['seasonSnapshots'] | undefined,
): SeasonResolution {
  if (!snapshots?.length) return { kind: 'missing', label: 'No Season snapshot recorded' };
  const unique = [
    ...new Map(
      snapshots.map((snapshot) => [
        JSON.stringify([snapshot.seasonId, snapshot.code, snapshot.name, snapshot.displayName]),
        snapshot,
      ]),
    ).values(),
  ];
  if (unique.length === 1) return { kind: 'single', label: unique[0]!.displayName };
  return {
    kind: 'conflict',
    label: `Inconsistent recorded Season: ${unique.map((season) => `${season.displayName} (${season.code}; ${season.name}; ${season.seasonId ?? 'no linked Season'})`).join(' / ')}`,
  };
}
