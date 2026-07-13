const ACCESS_TOKEN_KEY = 'erve.accessToken';

// sessionStorage (not localStorage) is deliberate: the access token must not
// outlive the current tab/page session. It survives a page refresh or a
// Capacitor WebView reload of the same session, but not a closed tab, a
// destroyed WebView/process, or a genuinely new session — those require a
// fresh login backed by the HttpOnly refresh cookie instead.
export function getStoredToken(): string | null {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
}
