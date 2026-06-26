import type { Role } from './roles.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}
