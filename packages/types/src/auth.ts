import type { AuthUser } from './user.js';

export interface LoginRequest {
  identifier: string;
  password: string;
}

/**
 * Server-authoritative session timing, returned by login and refresh. All
 * instants are ISO-8601 strings. `serverTime` lets a client correct for
 * local clock skew before comparing the other instants with its own clock.
 * The server remains the only authority on expiry; clients use this purely
 * to schedule renewal and warnings.
 */
export interface SessionInfo {
  /** The user the refresh session (cookie/credential) belongs to. */
  userId: string;
  serverTime: string;
  accessExpiresAt: string;
  /** When the session expires if there is no further user activity. */
  idleExpiresAt: string;
  /** Hard cap; no amount of activity extends the session past this. */
  absoluteExpiresAt: string;
  idleTimeoutSeconds: number;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
  /** Optional so clients tolerate an older API during a rolling deploy. */
  session?: SessionInfo;
}

export interface RefreshRequest {
  /**
   * Whether the user genuinely interacted with the app since the previous
   * renewal. Only activity slides the idle expiry; a refresh without it just
   * rotates tokens. Omitted means true (older clients and mobile).
   */
  activity?: boolean;
}

export interface RefreshResponse {
  accessToken: string;
  session?: SessionInfo;
}
