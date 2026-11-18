import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Button } from '@erve/primitives';
import { otaGuards, otaService } from './ota-runtime.js';
import type { OtaStatus, OtaUpdateService } from './ota-service.js';
import type { UpdateGuardRegistry } from './update-guards.js';
import { useUpdateSafetyGuards } from './useUpdateSafetyGuards.js';

interface OtaContextValue {
  service: OtaUpdateService;
  guards: UpdateGuardRegistry;
}

const OtaContext = createContext<OtaContextValue>({ service: otaService, guards: otaGuards });

export function useOtaService(): OtaUpdateService {
  return useContext(OtaContext).service;
}

export function useOtaStatus(): OtaStatus {
  const service = useOtaService();
  return useSyncExternalStore(service.subscribe, service.getStatus, service.getStatus);
}

interface OtaProviderProps {
  children?: ReactNode;
  /** Test seams; production uses the process-wide singletons. */
  service?: OtaUpdateService;
  guards?: UpdateGuardRegistry;
  /** Test seam for the foreground/background lifecycle source. */
  onForeground?: (handler: () => void) => () => void;
}

function capacitorForeground(handler: () => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => undefined;
  const subscription = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) handler();
  });
  return () => {
    void subscription.then((listener) => listener.remove());
  };
}

/**
 * Mount inside QueryClientProvider and the Router. It:
 *  - confirms to the native updater that this bundle rendered (cancelling the
 *    automatic rollback) once the first frame has been committed;
 *  - checks for updates at launch and on every return to the foreground;
 *  - applies a staged update on resume, but only when no safety guard objects;
 *  - renders the update banner.
 */
export function OtaProvider({
  children,
  service = otaService,
  guards = otaGuards,
  onForeground = capacitorForeground,
}: OtaProviderProps) {
  useUpdateSafetyGuards(guards);

  useEffect(() => guards.subscribe(() => service.refreshGuardState()), [guards, service]);

  useEffect(() => {
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      void service.markReady().then(() => {
        if (!cancelled) void service.checkForUpdate('launch');
      });
    });
    const stopForeground = onForeground(() => {
      void service.onResume();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stopForeground();
    };
  }, [service, onForeground]);

  return (
    <OtaContext.Provider value={{ service, guards }}>
      {children}
      <OtaUpdateBanner />
    </OtaContext.Provider>
  );
}

const BANNER_CLASS =
  'pointer-events-auto flex items-center justify-between gap-3 rounded-lg border border-border ' +
  'bg-surface px-4 py-3 text-sm text-foreground shadow-lg';

/**
 * Only actionable states surface here. Offline / server-unavailable results are
 * quiet by design (they are shown, with a retry, in the Account sheet) so a
 * flaky connection never nags a user in the middle of work.
 */
export const BANNER_HEIGHT_VAR = '--ota-banner-height';

/**
 * While the banner is shown, publishes its height as a CSS variable so scrolling
 * content can leave room for it (the banner floats over the bottom edge and would
 * otherwise cover the last control on a page — observed on a device, where it hid
 * most of a Submit button). Cleared again when the banner goes away.
 */
function useReserveBannerSpace(ref: RefObject<HTMLElement | null>, visible: boolean) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!visible || !element) return undefined;
    const root = document.documentElement;
    const apply = () => root.style.setProperty(BANNER_HEIGHT_VAR, `${element.offsetHeight}px`);
    apply();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(BANNER_HEIGHT_VAR);
    };
  }, [ref, visible]);
}

export function OtaUpdateBanner() {
  const service = useOtaService();
  const status = useOtaStatus();
  const bannerRef = useRef<HTMLDivElement>(null);

  let content: ReactNode = null;
  if (status.staged) {
    content = status.blockedBy ? (
      <p role="status">
        An app update is ready. It will install when you finish your current task.
      </p>
    ) : (
      <>
        <p role="status">An app update is ready.</p>
        <Button onClick={() => void service.activateStagedIfSafe()}>Restart now</Button>
      </>
    );
  } else if (status.nativeUpdateRequired) {
    content = (
      <p role="status">
        A new version of the Erve app must be installed to keep receiving updates. Ask your
        administrator for the latest app file.
      </p>
    );
  } else if (status.notice && status.notice.kind !== 'native-mismatch') {
    content = (
      <>
        <p role="status">
          The last app update could not be applied, so the previous version was restored.
        </p>
        <Button variant="secondary" onClick={() => service.dismissNotice()}>
          Dismiss
        </Button>
      </>
    );
  }

  useReserveBannerSpace(bannerRef, Boolean(content));
  if (!content) return null;
  return (
    <div
      ref={bannerRef}
      data-testid="ota-banner"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className={BANNER_CLASS}>{content}</div>
    </div>
  );
}
