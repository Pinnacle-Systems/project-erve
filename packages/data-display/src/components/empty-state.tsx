import { forwardRef, type ReactNode } from 'react';
import {
  EmptyState as AppEmptyState,
  type EmptyStateDensity,
  type EmptyStateTone,
} from '@erve/app-components';

/**
 * UX-11 compatibility adapter: existing data-display consumers keep the
 * density, tone, action and ref API. The only EmptyState implementation now
 * lives in @erve/app-components, with both legacy presentations preserved.
 */
export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  density?: EmptyStateDensity | null;
  tone?: EmptyStateTone | null;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>((props, ref) => (
  <AppEmptyState {...props} ref={ref} presentation="data-display" />
));
EmptyState.displayName = 'EmptyState';
