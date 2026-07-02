import axios from 'axios';
import { clearStoredToken, getStoredToken } from './token-storage.js';

export const AUTH_EXPIRED_EVENT = 'erve:auth-expired';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
});

apiClient.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401 && error.config?.url !== '/auth/login') {
      clearStoredToken();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      }
    }
    return Promise.reject(error);
  },
);
