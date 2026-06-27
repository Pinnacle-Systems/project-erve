import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useNavigate } from 'react-router-dom';
import { Card, LoginForm, type LoginFormValues } from '@erve/ui';
import type { ApiSuccessResponse, LoginResponse } from '@erve/types';
import { apiClient } from '../lib/api-client.js';
import { useAuth } from '../auth/AuthContext.js';

export function LoginPage() {
  const navigate = useNavigate();
  const { setUser } = useAuth();

  const mutation = useMutation({
    mutationFn: (values: LoginFormValues) =>
      apiClient.post<ApiSuccessResponse<LoginResponse>>('/auth/login', values),
    onSuccess: (response) => {
      setUser(response.data.data.user);
      navigate('/dashboard');
    },
  });

  const errorMessage =
    mutation.isError && isAxiosError(mutation.error)
      ? (mutation.error.response?.data?.error?.message as string | undefined) ??
        'Unable to sign in. Please try again.'
      : undefined;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold text-gray-900">Erve</h1>
        <p className="mb-6 text-sm text-gray-500">Sign in to your distributor account</p>
        <LoginForm
          onSubmit={(values) => mutation.mutate(values)}
          isSubmitting={mutation.isPending}
          errorMessage={errorMessage}
        />
      </Card>
    </div>
  );
}
