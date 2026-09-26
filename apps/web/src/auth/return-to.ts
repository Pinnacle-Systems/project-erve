import type { Location } from 'react-router-dom';

export interface ReturnToState {
  from?: Pick<Location, 'pathname' | 'search' | 'hash'>;
}

export const DEFAULT_AFTER_LOGIN_PATH = '/dashboard';

/**
 * The in-app path to return to after signing in, taken from router state set
 * by ProtectedRoute. Only same-origin app paths are accepted (never
 * protocol-relative "//host" or the login page itself).
 */
export function returnToPath(state: unknown): string {
  const from = (state as ReturnToState | null)?.from;
  if (!from || typeof from.pathname !== 'string') return DEFAULT_AFTER_LOGIN_PATH;
  const { pathname } = from;
  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname === '/login') {
    return DEFAULT_AFTER_LOGIN_PATH;
  }
  return `${pathname}${from.search ?? ''}${from.hash ?? ''}`;
}
