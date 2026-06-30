import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useNavigate } from 'react-router-dom';
import { LoginForm, type LoginFormValues } from '@erve/ui';
import type { ApiSuccessResponse, LoginResponse } from '@erve/types';
import { apiClient } from '../lib/api-client.js';
import { useAuth } from '../auth/AuthContext.js';

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const mutation = useMutation({
    mutationFn: (values: LoginFormValues) =>
      apiClient.post<ApiSuccessResponse<LoginResponse>>('/auth/login', values),
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
    <div className="flex min-h-screen flex-col bg-white">
      <div className="bg-blue-600 px-6 pb-12 pt-16">
        <h1 className="text-2xl font-bold text-white">Erve</h1>
        <p className="mt-1 text-sm text-blue-100">Sign in to your distributor account</p>
      </div>
      <div className="flex-1 px-6 py-8">
        <LoginForm
          onSubmit={(values) => mutation.mutate(values)}
          isSubmitting={mutation.isPending}
          errorMessage={errorMessage}
        />
      </div>
    </div>
  );
}
