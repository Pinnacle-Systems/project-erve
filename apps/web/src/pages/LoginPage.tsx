import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useNavigate } from 'react-router-dom';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { Card } from '@erve/layout';
import type { ApiSuccessResponse, LoginResponse } from '@erve/types';
import { apiClient } from '../lib/api-client.js';
import { useAuth } from '../auth/AuthContext.js';
import { PoweredByPinnacleBranding } from '../branding/PoweredByPinnacleBranding.js';

interface LoginFormValues {
  identifier: string;
  password: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [values, setValues] = useState<LoginFormValues>({ identifier: '', password: '' });

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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(values);
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--erp-color-app-bg)]">
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full min-w-0 max-w-md">
          <div className="mb-8 text-center">
            <img src="/erve-logo.png" alt="Erve" className="mx-auto h-10 w-auto" />
            <p className="mt-3 text-sm text-muted-foreground">Sign in to your distributor account</p>
          </div>
          <Card>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <TextField
                id="identifier"
                type="text"
                label="Email or mobile number"
                autoComplete="username"
                value={values.identifier}
                onChange={(event) => setValues((current) => ({ ...current, identifier: event.target.value }))}
                required
                width="fill"
              />
              <TextField
                id="password"
                type="password"
                label="Password"
                autoComplete="current-password"
                value={values.password}
                onChange={(event) => setValues((current) => ({ ...current, password: event.target.value }))}
                required
                width="fill"
              />
              {errorMessage ? <ValidationMessage tone="error">{errorMessage}</ValidationMessage> : null}
              <Button type="submit" loading={mutation.isPending} disabled={mutation.isPending} width="fill">
                Sign in
              </Button>
            </form>
          </Card>
        </div>
      </div>
      <footer className="flex items-center justify-center gap-2 border-t border-border px-4 py-6">
        <PoweredByPinnacleBranding className="justify-center" logoClassName="h-8" />
      </footer>
    </div>
  );
}
