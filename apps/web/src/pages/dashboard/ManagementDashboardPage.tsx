import { lazy, Suspense, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse, ReportOperationsSummary, ReportRecordOriginFilter } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { SelectField, SelectItem, ValidationMessage } from '@erve/primitives';
import { ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { FinancialYearSelect } from '../../lib/financial-years.js';
import { JOB_ORDER_STATUS_LABELS, QUALITY_RUNTIME_STATUS_LABELS } from '../job-orders/job-order-ui.js';
import { canFilterJobOrdersByFactory, canNavigateToJobOrders } from '../../auth/permissions.js';
import { useAuth } from '../../auth/AuthContext.js';
import { KpiCard } from './KpiCard.js';
import { useSeasonOptionsQuery } from './use-season-options.js';
import { useFactoryOptionsQuery } from './use-factory-options.js';

// Recharts (and every chart component) loads only once a viewer actually
// reaches the Dashboard, and stays out of the app's initial bundle — see
// the PR description for the before/after bundle-size measurement.
const ChartsSection = lazy(() => import('./charts/ChartsSection.js'));

const DEFAULT_RECORD_ORIGIN: ReportRecordOriginFilter = 'LIVE_WORKFLOW';

export function ManagementDashboardPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const mayFilterByFactory = canFilterJobOrdersByFactory(user);

  const financialYearId = searchParams.get('financialYearId') ?? '';
  const seasonId = searchParams.get('seasonId') ?? '';
  const factoryId = mayFilterByFactory ? (searchParams.get('factoryId') ?? '') : '';
  const recordOrigin = (searchParams.get('recordOrigin') as ReportRecordOriginFilter | null) ?? DEFAULT_RECORD_ORIGIN;

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  const params = useMemo(
    () => ({
      financialYearId: financialYearId || undefined,
      seasonId: seasonId || undefined,
      factoryId: factoryId || undefined,
      recordOrigin,
    }),
    [financialYearId, seasonId, factoryId, recordOrigin],
  );

  const summaryQuery = useQuery({
    queryKey: ['reports', 'operations-summary', params],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<ReportOperationsSummary>>(
        '/reports/operations/summary',
        { params },
      );
      return res.data.data;
    },
  });

  const seasonOptionsQuery = useSeasonOptionsQuery();
  const factoryOptionsQuery = useFactoryOptionsQuery(mayFilterByFactory);

  // RPT3 8.9/8.10 — a drilldown link is rendered only when the viewer can
  // reach the destination route; otherwise the card/chart shows the
  // aggregate with no link at all.
  const canDrillIntoJobOrders = canNavigateToJobOrders(user);
  function jobOrdersDrilldownHref(extra?: Record<string, string>): string | undefined {
    if (!canDrillIntoJobOrders) return undefined;
    const query = new URLSearchParams();
    if (factoryId) query.set('factoryId', factoryId);
    if (recordOrigin !== DEFAULT_RECORD_ORIGIN) query.set('recordOrigin', recordOrigin);
    for (const [key, value] of Object.entries(extra ?? {})) query.set(key, value);
    const queryString = query.toString();
    return queryString ? `/job-orders?${queryString}` : '/job-orders';
  }

  const summary = summaryQuery.data;
  const loading = summaryQuery.isLoading;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        subtitle="Company-wide operational reporting across production, QA, fulfillment and Sale-or-Return."
      />

      <div className="flex flex-wrap items-end gap-3">
        <FinancialYearSelect
          aria-label="Financial Year"
          value={financialYearId}
          onValueChange={(value) => setFilter('financialYearId', value)}
          allLabel="All Financial Years"
        />
        <SelectField
          aria-label="Current Style Season"
          value={seasonId || 'ALL'}
          onValueChange={(value) => setFilter('seasonId', value === 'ALL' ? '' : value)}
          density="compact"
          width="md"
        >
          <SelectItem value="ALL">All Seasons</SelectItem>
          {(seasonOptionsQuery.data ?? []).map((season) => (
            <SelectItem key={season.id} value={season.id}>
              {season.displayName ?? season.name}
            </SelectItem>
          ))}
        </SelectField>
        {mayFilterByFactory ? (
          <SelectField
            aria-label="Factory"
            value={factoryId || 'ALL'}
            onValueChange={(value) => setFilter('factoryId', value === 'ALL' ? '' : value)}
            density="compact"
            width="md"
          >
            <SelectItem value="ALL">All factories</SelectItem>
            {(factoryOptionsQuery.data ?? []).map((factory) => (
              <SelectItem key={factory.id} value={factory.id}>
                {factory.name}
              </SelectItem>
            ))}
          </SelectField>
        ) : null}
        <SelectField
          aria-label="Record Origin"
          value={recordOrigin}
          onValueChange={(value) => setFilter('recordOrigin', value === DEFAULT_RECORD_ORIGIN ? '' : value)}
          density="compact"
          width="sm"
        >
          <SelectItem value="LIVE_WORKFLOW">Live workflow</SelectItem>
          <SelectItem value="HISTORICAL_IMPORT">Historical import</SelectItem>
          <SelectItem value="ALL">All records</SelectItem>
        </SelectField>
      </div>

      {summaryQuery.isError ? (
        <ErrorState
          title="Unable to load the dashboard"
          description="Something went wrong loading reporting data. Try again."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {(loading || summary?.production) && (
            <KpiCard
              title="Open Job Orders"
              loading={loading}
              value={summary?.production?.openTotal}
              subValues={Object.entries(summary?.production?.openByStatus ?? {}).map(([status, count]) => ({
                label: JOB_ORDER_STATUS_LABELS[status as keyof typeof JOB_ORDER_STATUS_LABELS] ?? status,
                value: count,
              }))}
              href={jobOrdersDrilldownHref()}
            />
          )}
          {(loading || summary?.production) && (
            <KpiCard
              title="Delayed Job Orders"
              loading={loading}
              value={summary?.production?.delayed}
              href={jobOrdersDrilldownHref({ delayed: 'true' })}
            />
          )}
          {(loading || summary?.qa) && (
            <KpiCard
              title="QA-Passed Available Stock"
              loading={loading}
              value={summary?.qa?.availableStockPieces}
              footnote="Pieces released by QA, not yet allocated to a Dispatch Order."
            />
          )}
          {(loading || summary?.packing?.piecesAwaitingPacking !== undefined) && (
            <KpiCard
              title="Packing Pending"
              loading={loading}
              value={summary?.packing?.piecesAwaitingPacking}
              subValues={
                summary?.packing?.packingListsAwaitingCompletion !== undefined
                  ? [
                      {
                        label: 'Packing Lists awaiting completion',
                        value: summary.packing.packingListsAwaitingCompletion,
                      },
                    ]
                  : undefined
              }
            />
          )}
          {(loading || summary?.packing?.cartonsNeverAudited !== undefined) && (
            <KpiCard
              title="Cartons Awaiting Audit"
              loading={loading}
              value={
                summary?.packing
                  ? (summary.packing.cartonsNeverAudited ?? 0) + (summary.packing.cartonsNeedingReinspection ?? 0)
                  : undefined
              }
              subValues={
                summary?.packing
                  ? [
                      { label: 'Never audited', value: summary.packing.cartonsNeverAudited ?? 0 },
                      { label: 'Needs reinspection', value: summary.packing.cartonsNeedingReinspection ?? 0 },
                    ]
                  : undefined
              }
            />
          )}
          {(loading || summary?.delivery) && (
            <KpiCard
              title="Awaiting Delivery Confirmation"
              loading={loading}
              value={summary?.delivery?.awaitingConfirmation}
            />
          )}
          {(loading || summary?.saleReturn) && (
            <KpiCard
              title="Sale-or-Return Remaining with Distributors"
              loading={loading}
              value={summary?.saleReturn?.remainingWithDistributors}
            />
          )}
          {(loading || summary?.qa) && (
            <KpiCard
              title="QA Work Status"
              loading={loading}
              value={
                summary?.qa
                  ? Object.values(summary.qa.workByStatus).reduce((sum, count) => sum + count, 0)
                  : undefined
              }
              subValues={
                summary?.qa
                  ? [
                      ...Object.entries(summary.qa.workByStatus).map(([status, count]) => ({
                        label: QUALITY_RUNTIME_STATUS_LABELS[status as keyof typeof QUALITY_RUNTIME_STATUS_LABELS] ?? status,
                        value: count,
                      })),
                      { label: 'Reconciliation conflicts', value: summary.qa.reconciliationConflicts },
                    ]
                  : undefined
              }
            />
          )}
        </div>
      )}

      {!loading && summary && summary.sectionsOmitted.length > 0 ? (
        <ValidationMessage tone="info">
          Some sections are hidden because your role does not have access to that area.
        </ValidationMessage>
      ) : null}

      {!summaryQuery.isError ? (
        <Suspense fallback={<LoadingState variant="rows" label="Loading charts" rows={6} />}>
          <ChartsSection
            filters={params}
            canViewProduction
            canViewFulfillment
            canViewSaleReturn
          />
        </Suspense>
      ) : null}
    </div>
  );
}
