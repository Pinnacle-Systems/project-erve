// Transporter delivery access is deferred to tokenized public delivery
// links in the MVP, not a normal logged-in role — do not add it here.
export const ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'FACTORY_USER',
  'QA_USER',
  'ACCOUNTANT',
  'DISTRIBUTOR',
  'SENIOR_MANAGEMENT',
] as const;

export type Role = (typeof ROLES)[number];
