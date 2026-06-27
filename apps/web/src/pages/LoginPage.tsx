import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Card, LoginForm, type LoginFormValues } from '@erve/ui';
import { apiClient } from '../lib/api-client.js';

export function LoginPage() {
  const mutation = useMutation({
    mutationFn: (values: LoginFormValues) => apiClient.post('/auth/login', values),
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
