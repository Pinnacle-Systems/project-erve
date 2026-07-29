import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { ApiSuccessResponse, RefreshResponse } from '@erve/types';
import { clearStoredToken, getStoredToken, setStoredToken } from './token-storage.js';

export const AUTH_EXPIRED_EVENT = 'erve:auth-expired';

interface RetryableAxiosRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise: Promise<string> | null = null;

export interface RefreshCredentialProvider {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

let refreshCredentialProvider: RefreshCredentialProvider | null = null;

export function configureRefreshCredentialProvider(
  provider: RefreshCredentialProvider | null,
): void {
  refreshCredentialProvider = provider;
}

function isAuthEndpoint(url?: string): boolean {
  return Boolean(
    url &&
    [
      '/auth/login',
      '/auth/refresh',
      '/auth/logout',
      '/auth/mobile/login',
      '/auth/mobile/refresh',
      '/auth/mobile/logout',
    ].some((path) => url.endsWith(path)),
  );
}

function notifyAuthExpired(): void {
  clearStoredToken();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
}

export async function refreshAccessToken(): Promise<string> {
  refreshPromise ??= (async () => {
    const refreshToken = await refreshCredentialProvider?.get();
    const response = await apiClient.post<
      ApiSuccessResponse<RefreshResponse & { refreshToken?: string }>
    >(
      refreshCredentialProvider ? '/auth/mobile/refresh' : '/auth/refresh',
      refreshCredentialProvider ? { refreshToken } : undefined,
      { withCredentials: true },
    );
    const { accessToken, refreshToken: nextRefreshToken } = response.data.data;
    if (refreshCredentialProvider && nextRefreshToken) {
      await refreshCredentialProvider.set(nextRefreshToken);
    }
    setStoredToken(accessToken);
    return accessToken;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (!axios.isAxiosError(error) || error.response?.status !== 401 || !error.config) {
      return Promise.reject(error);
    }

    const originalRequest = error.config as RetryableAxiosRequestConfig;

    if (originalRequest._retry || isAuthEndpoint(originalRequest.url)) {
      if (!isAuthEndpoint(originalRequest.url) || originalRequest.url?.endsWith('/refresh')) {
        notifyAuthExpired();
      }
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      const accessToken = await refreshAccessToken();
      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return apiClient(originalRequest);
    } catch (refreshError) {
      if (!axios.isAxiosError(refreshError) || !refreshError.config?.url?.endsWith('/refresh')) {
        notifyAuthExpired();
      }
      return Promise.reject(refreshError);
    }
  },
);

export async function logoutSession(): Promise<void> {
  try {
    const refreshToken = await refreshCredentialProvider?.get();
    await apiClient.post(
      refreshCredentialProvider ? '/auth/mobile/logout' : '/auth/logout',
      refreshCredentialProvider ? { refreshToken } : undefined,
      { withCredentials: true },
    );
  } finally {
    await refreshCredentialProvider?.clear();
    notifyAuthExpired();
  }
}
