export const ROLES = ['ADMIN', 'DISTRIBUTOR', 'DISPATCHER', 'DRIVER'] as const;

export type Role = (typeof ROLES)[number];
