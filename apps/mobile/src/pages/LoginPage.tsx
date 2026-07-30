import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useNavigate } from 'react-router-dom';
import { Card } from '@erve/layout';
import type { ApiSuccessResponse, LoginResponse } from '@erve/types';
import { apiClient } from '../lib/api-client.js';
import { useAuth } from '../auth/AuthContext.js';
import { LoginForm, type LoginFormValues } from '../components/LoginForm.js';
import { PoweredByPinnacleBranding } from '../branding/PoweredByPinnacleBranding.js';
import erveLogo from '../../branding/erve-logo.png';
import { nativeSecureSession } from '../auth/secure-session.js';

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const mutation = useMutation({
    mutationFn: async (values: LoginFormValues) => {
      const response = await apiClient.post<
        ApiSuccessResponse<LoginResponse & { refreshToken?: string }>
      >(nativeSecureSession.isAvailable() ? '/auth/mobile/login' : '/auth/login', values, {
        withCredentials: true,
      });
      if (nativeSecureSession.isAvailable()) {
        if (!response.data.data.refreshToken) {
          throw new Error('Mobile refresh session was not returned');
        }
        await nativeSecureSession.set(response.data.data.refreshToken);
      }
      return response;
    },
    onSuccess: (response) => {
      const { accessToken, user } = response.data.data;
      login(accessToken, user);
      navigate('/dashboard');
    },
  });

  const errorMessage =
    mutation.isError && isAxiosError(mutation.error)
      ? ((mutation.error.response?.data?.error?.message as string | undefined) ??
        'Unable to sign in. Please try again.')
      : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {/* Neutral surface, not bg-primary: the full logo's "erve" wordmark is
          rendered in the same crimson as --erp-color-primary, so it would be
          unreadable on a crimson banner. */}
      <div className="flex flex-col items-center gap-2 bg-surface px-6 pb-10 pt-16">
        <img src={erveLogo} alt="Erve India" className="h-auto w-48 max-w-full" />
        <p className="text-sm text-muted-foreground">Sign in to your Erve account</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <Card>
          <LoginForm
            onSubmit={(values) => mutation.mutate(values)}
            isSubmitting={mutation.isPending}
            errorMessage={errorMessage}
          />
        </Card>
      </div>
      <footer className="flex items-center justify-center gap-2 border-t border-border px-6 py-6">
        <PoweredByPinnacleBranding className="justify-center" logoClassName="h-8" />
      </footer>
    </div>
  );
}
