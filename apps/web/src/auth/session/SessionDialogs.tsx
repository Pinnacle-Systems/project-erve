import { useEffect, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  PasswordField,
  TextField,
  ValidationMessage,
} from '@erve/primitives';
import type { ApiSuccessResponse, AuthUser, LoginResponse } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';

/** Blocks the "dismiss by Escape / clicking outside" paths of a Radix dialog. */
const blockDismiss = {
  onEscapeKeyDown: (event: Event) => event.preventDefault(),
  onPointerDownOutside: (event: Event) => event.preventDefault(),
  onInteractOutside: (event: Event) => event.preventDefault(),
};

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Wall-clock countdown; the interval only repaints, it never decides expiry. */
function useRemaining(expiresAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  return expiresAt - now;
}

function formatClockTime(instant: number): string {
  return new Date(instant).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function IdleWarningDialog({
  expiresAt,
  onContinue,
  onSignOut,
}: {
  expiresAt: number;
  onContinue: () => Promise<void>;
  onSignOut: () => void;
}) {
  const remaining = useRemaining(expiresAt);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const handleContinue = async () => {
    setPending(true);
    setError('');
    try {
      await onContinue();
    } catch (caught) {
      // A rejected session raises the in-place sign-in instead; only
      // transient failures need a message here.
      if (!isAxiosError(caught) || caught.response?.status !== 401) {
        setError('Could not reach the server. Check your connection and try again.');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open>
      <DialogContent className="max-w-md" {...blockDismiss}>
        <DialogHeader>
          <DialogTitle>Your session will expire soon</DialogTitle>
          <DialogDescription>
            You have been inactive for a while. For your security you will be signed out in{' '}
            <span className="font-semibold tabular-nums">{formatRemaining(remaining)}</span>. Your
            unsaved work on this page is kept either way.
          </DialogDescription>
        </DialogHeader>
        {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onSignOut} disabled={pending}>
            Sign out
          </Button>
          <Button type="button" onClick={() => void handleContinue()} loading={pending}>
            Continue Session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AbsoluteExpiryWarningDialog({
  expiresAt,
  onDismiss,
}: {
  expiresAt: number;
  onDismiss: () => void;
}) {
  const remaining = useRemaining(expiresAt);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onDismiss())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Your session is ending</DialogTitle>
          <DialogDescription>
            Your sign-in reaches its maximum length at {formatClockTime(expiresAt)} (in{' '}
            <span className="font-semibold tabular-nums">{formatRemaining(remaining)}</span>) and
            cannot be extended. Save your work — you will then be asked for your password again,
            without leaving this page.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={onDismiss}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Re-authentication over the current page. The page underneath stays
 * mounted, so unsaved form state survives. Only the signed-in user can sign
 * back in here; switching user goes through "Sign out".
 */
export function ReauthDialog({
  user,
  reachedAbsoluteLimit,
  onSignedIn,
  onSignOut,
}: {
  user: AuthUser;
  reachedAbsoluteLimit: boolean;
  onSignedIn: (response: LoginResponse) => Promise<void>;
  onSignOut: () => void;
}) {
  const identifier = user.email ?? user.mobile ?? '';
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<ApiSuccessResponse<LoginResponse>>('/auth/login', {
          identifier,
          password,
        })
      ).data.data,
    onSuccess: onSignedIn,
  });

  const errorMessage = mutation.isError
    ? isAxiosError(mutation.error) && mutation.error.response
      ? ((mutation.error.response.data?.error?.message as string | undefined) ??
        'Unable to sign in. Please try again.')
      : 'Could not reach the server. Check your connection and try again.'
    : undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <Dialog open>
      <DialogContent className="max-w-md" {...blockDismiss}>
        <DialogHeader>
          <DialogTitle>Sign in to continue</DialogTitle>
          <DialogDescription>
            {reachedAbsoluteLimit
              ? 'Your session reached its maximum length.'
              : 'Your session expired after a period of inactivity.'}{' '}
            Sign in again to carry on — this page and your unsaved changes are kept. Anything that
            failed to save while you were signed out needs to be saved again.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <TextField
            id="reauth-identifier"
            label="Email or mobile number"
            autoComplete="username"
            value={identifier}
            readOnly
            width="fill"
          />
          <PasswordField
            id="reauth-password"
            label="Password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoFocus
            width="fill"
          />
          {errorMessage ? <ValidationMessage tone="error">{errorMessage}</ValidationMessage> : null}
          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onSignOut}
              disabled={mutation.isPending}
            >
              Sign out
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={mutation.isPending}>
              Sign in
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
