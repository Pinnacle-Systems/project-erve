import { isAxiosError } from 'axios';

/**
 * Extracts a user-facing message from a failed API call.
 *
 * Prefers the backend's normalized business/validation message
 * (`response.data.error.message`, from the `{ success: false, error: { code, message, details } }`
 * envelope) over generic Axios transport text such as "Request failed with
 * status code 400" — that text is never returned, even as a fallback,
 * because it exposes implementation detail instead of an actionable reason.
 */
export function getApiErrorMessage(caught: unknown, fallback: string): string {
  if (isAxiosError(caught)) {
    const message = caught.response?.data?.error?.message;
    return typeof message === 'string' && message.trim().length > 0 ? message : fallback;
  }
  return caught instanceof Error ? caught.message : fallback;
}

export function getApiErrorCode(caught: unknown): string | undefined {
  if (!isAxiosError(caught)) return undefined;
  const code = caught.response?.data?.error?.code;
  return typeof code === 'string' ? code : undefined;
}
