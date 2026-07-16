import { type ReactNode, type SVGProps, useState } from 'react';
import { NavLink, useMatch, useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@erve/primitives';
import { useAuth } from '../auth/AuthContext.js';
import { ThemeModeMenu } from '../theme/ThemeModeMenu.js';
import { PoweredByPinnacleBranding } from '../branding/PoweredByPinnacleBranding.js';

export interface AppShellNavItem {
  to: string;
  label: string;
  end?: boolean;
  /** Rendered at a fixed size by AppShell itself, so every nav item stays visually consistent regardless of which icon it uses. */
  icon: LucideIcon;
}

export interface AppShellNavSection {
  heading?: string;
  items: AppShellNavItem[];
}

export interface AppShellProps {
  navSections: AppShellNavSection[];
  children: ReactNode;
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'erve.sidebarCollapsed';

function getStoredSidebarCollapsed(): boolean {
  if (typeof localStorage === 'undefined') {
    return false;
  }
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function setStoredSidebarCollapsed(collapsed: boolean): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // best-effort persistence, same as erve.themePreference
  }
}

/**
 * Every nav item shares one fixed row height and flex layout in both
 * collapsed and expanded states so icons land at the same vertical position
 * regardless of sidebar width — only the horizontal treatment (centered
 * icon-only square vs. left-aligned icon+label row) differs.
 */
const NAV_ROW_CLASS = 'flex h-10 items-center overflow-hidden rounded-md text-sm';
const NAV_SECTION_HEADING_CLASS =
  'flex h-9 shrink-0 items-end whitespace-nowrap px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground';

function navLinkClassName(isActive: boolean, collapsed: boolean) {
  return cn(
    NAV_ROW_CLASS,
    collapsed ? 'mx-auto w-10 justify-center' : 'w-full gap-2 px-3',
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-surface-muted',
  );
}

const NAV_ICON_CLASS = 'h-[18px] w-[18px]';

/**
 * Renders one nav item's link. Collapsed mode clips and fades the persistent
 * non-wrapping label while `aria-label` preserves the accessible name. A
 * Tooltip keeps the full label discoverable on hover and keyboard focus —
 * a native `title`
 * attribute only surfaces on mouse hover, which fails the collapsed
 * sidebar's "icon-only but still fully labeled" requirement for keyboard
 * users.
 */
function AppShellNavLink({ item, collapsed }: { item: AppShellNavItem; collapsed: boolean }) {
  // TooltipTrigger's `asChild` slot needs a concrete class string. Passing
  // NavLink's className callback through the slot stringifies the callback
  // in collapsed mode and drops the fixed row geometry.
  const isActive = useMatch({ path: item.to, end: item.end ?? false }) !== null;
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      aria-label={item.label}
      className={navLinkClassName(isActive, collapsed)}
    >
      <item.icon aria-hidden="true" className={cn(NAV_ICON_CLASS, 'shrink-0')} />
      <span
        aria-hidden="true"
        className={cn(
          'min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity,visibility] duration-150 ease-out',
          collapsed
            ? 'invisible max-w-0 opacity-0'
            : 'visible max-w-[calc(var(--erp-shell-sidebar-width)-5rem)] opacity-100',
        )}
      >
        {item.label}
      </span>
    </NavLink>
  );

  if (!collapsed) {
    return link;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ChevronIcon(props: SVGProps<SVGSVGElement>) {
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
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

/**
 * Collapsed sidebar's Pinnacle branding has no adjacent visible "Powered by"
 * text (no room), so the accessible name lives entirely on the compact
 * logo's `alt`; this tooltip is purely a sighted-hover/focus affordance on
 * top of that.
 */
function SidebarCollapsedBranding() {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={cn(
              'mx-auto flex w-fit cursor-default items-center justify-center rounded-sm',
              'focus-visible:outline-hidden focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)]',
            )}
          >
            <PoweredByPinnacleBranding variant="compact" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">Powered by Pinnacle Systems</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function AppShell({ navSections, children }: AppShellProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const mobileNavItems = navSections.flatMap((section) => section.items);
  const [collapsed, setCollapsed] = useState(getStoredSidebarCollapsed);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      setStoredSidebarCollapsed(next);
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 hidden flex-col overflow-hidden border-r border-border bg-surface py-6 md:flex',
          'transition-[width] duration-200 ease-out',
          collapsed
            ? 'w-[var(--erp-shell-sidebar-collapsed-width)] px-2'
            : 'w-[var(--erp-shell-sidebar-width)] px-5',
        )}
      >
        <NavLink
          to="/dashboard"
          className="flex h-8 shrink-0 items-center justify-center overflow-hidden"
          aria-label="Erve dashboard"
        >
          <img
            src={collapsed ? '/erve-favicon.png' : '/erve-logo.png'}
            alt="Erve"
            className={collapsed ? 'h-8 w-8' : 'h-8 w-auto'}
          />
        </NavLink>
        <nav className="mt-8 min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden">
          {navSections.map((section, index) => (
            <div key={section.heading ?? `section-${index}`}>
              {section.heading && (
                <div
                  aria-hidden={collapsed || undefined}
                  className={cn(NAV_SECTION_HEADING_CLASS, collapsed && 'invisible')}
                >
                  {section.heading}
                </div>
              )}
              <div className="space-y-1">
                {section.items.map((item) => (
                  <AppShellNavLink key={item.to} item={item} collapsed={collapsed} />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-4 shrink-0 overflow-hidden border-t border-border pt-4">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-foreground transition-colors',
              'hover:bg-surface-muted',
              'focus-visible:outline-hidden focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)]',
              collapsed ? 'mx-auto' : 'ml-auto',
            )}
          >
            <ChevronIcon
              className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')}
            />
          </button>
          <div className="mt-3 flex h-7 items-center justify-center">
            {collapsed ? (
              <SidebarCollapsedBranding />
            ) : (
              <PoweredByPinnacleBranding variant="row" className="justify-center" />
            )}
          </div>
        </div>
      </aside>
      <div
        className={cn(
          'transition-[padding-left] duration-200 ease-out',
          collapsed
            ? 'md:pl-[var(--erp-shell-sidebar-collapsed-width)]'
            : 'md:pl-[var(--erp-shell-sidebar-width)]',
        )}
      >
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
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-surface-muted text-muted-foreground'
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
