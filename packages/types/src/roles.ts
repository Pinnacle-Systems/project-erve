// Authenticated transport maintenance is separate from future public QR delivery.
export const ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'FACTORY_USER',
  'QA_USER',
  'ACCOUNTANT',
  'DISTRIBUTOR',
  'SENIOR_MANAGEMENT',
  'TRANSPORTER',
] as const;

export type Role = (typeof ROLES)[number];
