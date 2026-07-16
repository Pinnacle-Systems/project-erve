import { type SVGProps, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@erve/primitives';
import { useAuth } from '../auth/AuthContext.js';
import { ThemeModeSelector } from '../theme/ThemeModeSelector.js';

function PersonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </svg>
  );
}

function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

const ICON_BUTTON_CLASS =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition-colors ' +
  'hover:bg-surface-muted focus-visible:outline-hidden focus-visible:ring-[length:var(--erp-focus-ring-width)] ' +
  'focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)]';

/**
 * Top-right account trigger for the mobile authenticated shell. Opens a
 * bottom sheet (not the small anchored popover `ThemeModeControl` uses on
 * desktop — poor touch UX stacked inside another sheet) containing the
 * signed-in user's identity, theme selection, and log out.
 */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  if (!user) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" aria-label="Account menu" className={ICON_BUTTON_CLASS}>
          <PersonIcon className="h-6 w-6" />
        </button>
      </DialogTrigger>
      <DialogContent variant="bottom-sheet" aria-describedby={undefined}>
        <div className="flex items-center justify-between gap-4">
          <DialogTitle>Account</DialogTitle>
          <DialogClose asChild>
            <button type="button" aria-label="Close" className={ICON_BUTTON_CLASS}>
              <CloseIcon className="h-5 w-5" />
            </button>
          </DialogClose>
        </div>

        <div className="mt-1">
          <p className="text-sm font-medium text-foreground">{user.name}</p>
          <p className="text-xs text-muted-foreground">{user.roles.join(', ')}</p>
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Theme
          </div>
          <ThemeModeSelector />
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <Button
            variant="secondary"
            width="fill"
            onClick={async () => {
              setOpen(false);
              await logout();
              navigate('/login');
            }}
          >
            Log out
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

AccountMenu.displayName = 'AccountMenu';
