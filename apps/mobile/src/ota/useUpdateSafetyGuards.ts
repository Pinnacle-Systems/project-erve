import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import {
  DirtyFieldTracker,
  pendingMutationReason,
  protectedRouteReason,
  type UpdateGuardRegistry,
} from './update-guards.js';

/**
 * Feeds live UI state into the guard registry. Mount once, inside both the
 * QueryClientProvider and the Router. Reads state only — it never alters what a
 * page does, so ERP workflows are untouched.
 *
 * In-flight saves are read synchronously from the query client's mutation
 * cache at decision time (not mirrored through React state), so a save that
 * started a millisecond ago is always seen.
 */
export function useUpdateSafetyGuards(registry: UpdateGuardRegistry): void {
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const pathRef = useRef(pathname);
  const trackerRef = useRef<DirtyFieldTracker | null>(null);

  // Route changes are discrete and long before any activation decision.
  useEffect(() => {
    pathRef.current = pathname;
  });

  useEffect(() => {
    const tracker = new DirtyFieldTracker();
    trackerRef.current = tracker;
    const stopTracking = tracker.start();
    const stopWatchingMutations = queryClient.getMutationCache().subscribe(() => registry.notify());
    const unregister = [
      registry.register(() => protectedRouteReason(pathRef.current)),
      registry.register(() => pendingMutationReason(queryClient)),
      registry.register(() => tracker.blockingReason()),
    ];
    return () => {
      for (const release of unregister) release();
      stopWatchingMutations();
      stopTracking();
      trackerRef.current = null;
    };
  }, [registry, queryClient]);

  // A new screen starts with a clean slate for unsaved-field tracking, and
  // observers (the update banner) are told the safety picture may have changed.
  useEffect(() => {
    trackerRef.current?.reset();
    registry.notify();
  }, [pathname, registry]);
}
