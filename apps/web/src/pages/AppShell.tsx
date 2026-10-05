import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  type SVGProps,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
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

/**
 * Publishes an element's live rendered height in pixels. The shell header's
 * height isn't a safe compile-time constant — the user name and role list it
 * renders aren't clamped to a single line, so it can genuinely grow (a long
 * name, several roles) without warning. Pages that need to stick content
 * directly below the header (e.g. a page-level sticky context bar) read the
 * real measured value instead of guessing an offset that would either gap or
 * overlap whenever the header isn't at its usual height.
 */
function useObservedHeightPx<T extends HTMLElement>(): [RefObject<T | null>, number | null] {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setHeight(node.getBoundingClientRect().height);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      // Deliberately re-measure via getBoundingClientRect rather than
      // trusting entry.contentRect: contentRect is the content box only
      // (excludes padding/border), which would under-report this element's
      // real occupied height by exactly its padding+border — the offset
      // this hook exists to get right.
      setHeight(node.getBoundingClientRect().height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, height];
}

/** Subset of MediaQueryList this hook relies on, plus the legacy
 * addListener/removeListener pair some older WebViews still only support —
 * mirrors packages/theme/src/system-preference.ts's defensive shape. */
interface CompatibleMediaQueryList {
  matches: boolean;
  addEventListener?: (type: 'change', listener: (event: { matches: boolean }) => void) => void;
  removeEventListener?: (type: 'change', listener: (event: { matches: boolean }) => void) => void;
  addListener?: (listener: (event: { matches: boolean }) => void) => void;
  removeListener?: (listener: (event: { matches: boolean }) => void) => void;
}

function getMediaQueryList(query: string): CompatibleMediaQueryList | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return undefined;
  }
  return window.matchMedia(query);
}

/**
 * Below `COMPACT_SIDEBAR_QUERY`'s threshold there isn't enough width for both
 * an expanded ~16rem sidebar rail and a comfortable header (user identity +
 * theme toggle + logout) — so the shell forces the compact icon-only rail in
 * that range regardless of the user's own expand/collapse preference, which
 * continues to apply once there's room for it again. Mirrors
 * subscribeToSystemPreference's modern/legacy-listener handling.
 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => getMediaQueryList(query)?.matches ?? false);

  useEffect(() => {
    const mediaQueryList = getMediaQueryList(query);
    if (!mediaQueryList) return;

    // No sync-on-mount call here: the useState lazy initializer above
    // already reads the current `matches` value for first render — this
    // effect only needs to subscribe to subsequent changes.
    const handleChange = (event: { matches: boolean }) => setMatches(event.matches);

    if (typeof mediaQueryList.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', handleChange);
      return () => mediaQueryList.removeEventListener?.('change', handleChange);
    }
    if (typeof mediaQueryList.addListener === 'function') {
      mediaQueryList.addListener(handleChange);
      return () => mediaQueryList.removeListener?.(handleChange);
    }
    return undefined;
  }, [query]);

  return matches;
}

/** Below 1280px (but at/above the 768px breakpoint where the sidebar exists
 * at all — see the `aside`'s `md:flex`), force the compact rail. At 1024px
 * this is always true; at 1280px/1440px it's always false, leaving the
 * user's own preference in charge. */
const COMPACT_SIDEBAR_QUERY = '(max-width: 1279px)';

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
 * The header's user-identity block has no natural ceiling on its content
 * (a long display name, or several roles joined by ", ") — `min-w-0` lets it
 * actually shrink inside the header's flex row (flex items default to a
 * content-based min-width otherwise) and `truncate` turns what would
 * otherwise be an overflow/collision with the theme+logout controls into a
 * single-line ellipsis. The Tooltip (focusable, same pattern as the
 * collapsed nav links above) keeps the untruncated name/roles discoverable
 * rather than silently lost.
 */
function UserIdentitySummary({ name, roles }: { name: string | undefined; roles: string[] | undefined }) {
  const rolesText = roles?.join(', ') ?? '';
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            tabIndex={0}
            className={cn(
              'min-w-0 flex-1 cursor-default rounded-sm',
              'focus-visible:outline-hidden focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)]',
            )}
          >
            <div className="truncate text-sm font-medium text-foreground">{name}</div>
            <div className="truncate text-xs text-muted-foreground">{rolesText}</div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <div className="font-medium">{name}</div>
          <div className="text-xs opacity-80">{rolesText}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
  const isCompactViewport = useMediaQuery(COMPACT_SIDEBAR_QUERY);
  const effectiveCollapsed = collapsed || isCompactViewport;
  const [headerRef, headerHeight] = useObservedHeightPx<HTMLElement>();
  const mainStyle =
    headerHeight != null
      ? ({ '--app-shell-header-height': `${headerHeight}px` } as CSSProperties)
      : undefined;

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
          'fixed inset-y-0 left-0 hidden flex-col overflow-hidden border-r border-border bg-shell py-6 md:flex',
          'transition-[width] duration-200 ease-out',
          effectiveCollapsed
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
            src={effectiveCollapsed ? '/erve-favicon.png' : '/erve-logo.png'}
            alt="Erve"
            className={effectiveCollapsed ? 'h-8 w-8' : 'h-8 w-auto'}
          />
        </NavLink>
        <nav
          data-scrollbar-hidden={effectiveCollapsed || undefined}
          className={cn(
            'mt-8 min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden',
            // Hide the native scrollbar ONLY in collapsed mode: a visible OS
            // scrollbar eats into the collapsed rail's ~3rem content width
            // and physically overlaps the centered 2.5rem icon buttons.
            // Wheel/keyboard/touch scrolling still works via overflow-y-auto
            // above; only the track's rendering is suppressed, so no width
            // is ever reserved or reclaimed for it (which also avoids a
            // scrollbar "flash" while the sidebar's width transitions).
            // Expanded mode keeps the native scrollbar, since it's the only
            // visual cue that more nav items exist below the fold and there
            // is no icon column to overlap in the first place.
            effectiveCollapsed
              ? '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
              : '[scrollbar-color:var(--erp-shell-scrollbar-thumb)_var(--erp-shell-scrollbar-track)] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-[var(--erp-shell-scrollbar-track)] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--erp-shell-scrollbar-thumb)] [&::-webkit-scrollbar-thumb:hover]:bg-[var(--erp-shell-scrollbar-thumb-hover)]',
          )}
        >
          {navSections.map((section, index) => (
            <div key={section.heading ?? `section-${index}`}>
              {section.heading && (
                <div
                  aria-hidden={effectiveCollapsed || undefined}
                  className={cn(NAV_SECTION_HEADING_CLASS, effectiveCollapsed && 'invisible')}
                >
                  {section.heading}
                </div>
              )}
              <div className="space-y-1">
                {section.items.map((item) => (
                  <AppShellNavLink key={item.to} item={item} collapsed={effectiveCollapsed} />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-4 shrink-0 overflow-hidden border-t border-border pt-4">
          {!isCompactViewport && (
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
          )}
          <div className="mt-3 flex h-7 items-center justify-center">
            {effectiveCollapsed ? (
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
          effectiveCollapsed
            ? 'md:pl-[var(--erp-shell-sidebar-collapsed-width)]'
            : 'md:pl-[var(--erp-shell-sidebar-width)]',
        )}
      >
        <header
          ref={headerRef}
          className="sticky top-0 z-10 border-b border-border bg-shell/95 px-4 py-3 backdrop-blur-sm md:px-8"
        >
          <div className="flex items-center justify-between gap-4">
            <UserIdentitySummary name={user?.name} roles={user?.roles} />
            <div className="flex shrink-0 items-center gap-4">
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
        <main className="px-4 py-6 md:px-8" style={mainStyle}>
          {children}
        </main>
      </div>
    </div>
  );
}
