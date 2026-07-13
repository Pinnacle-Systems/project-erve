import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useNavigate } from 'react-router-dom';
import { Card } from '@erve/layout';
import type { ApiSuccessResponse, LoginResponse } from '@erve/types';
import { apiClient } from '../lib/api-client.js';
import { useAuth } from '../auth/AuthContext.js';
import { LoginForm, type LoginFormValues } from '../components/LoginForm.js';
import erveLogo from '../../branding/erve-logo.png';

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const mutation = useMutation({
    mutationFn: (values: LoginFormValues) =>
      apiClient.post<ApiSuccessResponse<LoginResponse>>('/auth/login', values, { withCredentials: true }),
    onSuccess: (response) => {
      const { accessToken, user } = response.data.data;
      login(accessToken, user);
      navigate('/dashboard');
    },
  });

  const errorMessage =
    mutation.isError && isAxiosError(mutation.error)
      ? (mutation.error.response?.data?.error?.message as string | undefined) ??
        'Unable to sign in. Please try again.'
      : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Neutral surface, not bg-primary: the full logo's "erve" wordmark is
          rendered in the same crimson as --erp-color-primary, so it would be
          unreadable on a crimson banner. */}
      <div className="flex flex-col items-center gap-2 bg-surface px-6 pb-10 pt-16">
        <img src={erveLogo} alt="Erve India" className="h-auto w-48 max-w-full" />
        <p className="text-sm text-muted-foreground">Sign in to your distributor account</p>
      </div>
      <div className="flex-1 px-6 py-8">
        <Card>
          <LoginForm
            onSubmit={(values) => mutation.mutate(values)}
            isSubmitting={mutation.isPending}
            errorMessage={errorMessage}
          />
        </Card>
      </div>
    </div>
  );
}
