import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ValidationMessage,
} from '@erve/primitives';
import { apiClient } from '../../../lib/api-client.js';
import { PasswordField } from '../PasswordField.js';
import { toErrorMessage } from './toErrorMessage.js';

export function ResetPasswordDialog({
  userId,
  open,
  onOpenChange,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match');
      }
      await apiClient.post(`/users/${userId}/reset-password`, { password });
    },
    onSuccess: () => {
      setSuccess(true);
      setPassword('');
      setConfirmPassword('');
    },
    onError: (caught) => setError(toErrorMessage(caught, 'Unable to reset password')),
  });

  const close = () => {
    setPassword('');
    setConfirmPassword('');
    setError('');
    setSuccess(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
        </DialogHeader>

        {success ? (
          <div className="space-y-4">
            <ValidationMessage tone="success">
              Password reset. The user&apos;s existing sessions were revoked — they must sign in
              again with the new password.
            </ValidationMessage>
            <DialogFooter>
              <Button type="button" onClick={close}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
          >
            <p className="text-sm text-muted-foreground">
              This immediately sets a new password for this user and revokes their existing
              sessions — they will be signed out everywhere and must sign in again with the new
              password. The current password is never shown.
            </p>
            <PasswordField
              label="New password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />
            <PasswordField
              label="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
            />
            {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" loading={mutation.isPending}>
                Reset Password
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
