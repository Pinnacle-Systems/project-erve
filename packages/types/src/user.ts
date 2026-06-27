import type { Role } from './roles.js';

export interface AuthUser {
  id: string;
  email: string;
  mobile: string | null;
  name: string;
  roles: Role[];
}
