import { type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Button } from '@erve/primitives';
import { useAuth } from '../auth/AuthContext.js';
import { ThemeModeMenu } from '../theme/ThemeModeMenu.js';

export interface AppShellNavItem {
  to: string;
  label: string;
  end?: boolean;
}

export interface AppShellNavSection {
  heading?: string;
  items: AppShellNavItem[];
}

export interface AppShellProps {
  navSections: AppShellNavSection[];
  children: ReactNode;
}

const navLinkClassName = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-2 text-sm ${isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-surface-muted'}`;

export function AppShell({ navSections, children }: AppShellProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const mobileNavItems = navSections.flatMap((section) => section.items);

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-surface px-5 py-6 md:block">
        <NavLink to="/dashboard" className="flex items-center" aria-label="Erve dashboard">
          <img src="/erve-logo.png" alt="Erve" className="h-8 w-auto" />
        </NavLink>
        <nav className="mt-8 space-y-1">
          {navSections.map((section, index) => (
            <div key={section.heading ?? `section-${index}`}>
              {section.heading && (
                <div className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.heading}
                </div>
              )}
              {section.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClassName}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="md:pl-64">
        <header className="sticky top-0 z-10 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur-sm md:px-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-foreground">{user?.name}</div>
              <div className="text-xs text-muted-foreground">{user?.roles.join(', ')}</div>
            </div>
            <div className="flex items-center gap-4">
              <ThemeModeMenu />
              <Button
                variant="secondary"
                onClick={async () => {
                  await logout();
                  navigate('/login');
                }}
              >
                Log out
              </Button>
            </div>
          </div>
          <nav className="mt-3 flex gap-2 overflow-x-auto md:hidden">
            {mobileNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-md px-3 py-2 text-sm ${
                    isActive ? 'bg-primary text-primary-foreground' : 'bg-surface-muted text-muted-foreground'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
