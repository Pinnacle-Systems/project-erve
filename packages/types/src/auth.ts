import type { AuthUser } from './user.js';

export interface LoginRequest {
  identifier: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}
