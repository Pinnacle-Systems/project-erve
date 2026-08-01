import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type {
  ApiSuccessResponse,
  AssignedFactoryTaskSummary,
  AuthUser,
  JobOrderDetail,
  PaginatedResponse,
  QaQueueSummary,
  QaReworkTaskView,
} from '@erve/types';
import { apiClient } from '../lib/api-client.js';
import { QA_OPERATION_ROLES } from '@erve/shared';

const operationalQaRoles = [...QA_OPERATION_ROLES, 'MERCHANDISER'] as const;
const oversightRoles = ['ADMIN', 'MERCHANDISER'] as const;

function hasRole(user: AuthUser, roles: readonly AuthUser['roles'][number][]) {
  return roles.some((role) => user.roles.includes(role));
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ').toLowerCase();
}

function SummaryLink({
  to,
  title,
  value,
  detail,
}: {
  to: string;
  title: string;
  value?: number | string;
  detail: string;
}) {
  return (
    <Link
      to={to}
      className="block min-h-28 rounded-xl border border-border bg-surface p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold text-foreground">{title}</h2>
        {value !== undefined && (
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-sm font-semibold text-primary">
            {value}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
      <span className="mt-3 inline-block text-sm font-medium text-[var(--erp-text-link)]">
        Open {title.toLowerCase()} →
      </span>
    </Link>
  );
}

export function DashboardPage({ user }: { user: AuthUser }) {
  const canUseFactoryTasks = user.roles.includes('FACTORY_USER');
  const canUseQa = hasRole(user, operationalQaRoles);
  const canOversee = hasRole(user, oversightRoles);
  const canUseRework = canUseFactoryTasks || canOversee;

  const factoryTasks = useQuery({
    queryKey: ['factory-tasks', 'mobile-home'],
    enabled: canUseFactoryTasks,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<PaginatedResponse<AssignedFactoryTaskSummary>>>(
          '/job-orders/assigned-tasks',
          { params: { limit: 6 } },
        )
      ).data.data,
  });
  const qaQueue = useQuery({
    queryKey: ['qa-queue', 'mobile-home'],
    enabled: canUseQa,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<PaginatedResponse<QaQueueSummary>>>('/qa/queue', {
          params: { limit: 100 },
        })
      ).data.data,
  });
  const rework = useQuery({
    queryKey: ['factory-rework'],
    enabled: canUseRework,
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<QaReworkTaskView[]>>('/qa/rework')).data.data,
  });
  const operationalJobs = useQuery({
    queryKey: ['operational-job-orders', 'mobile-home'],
    enabled: canOversee,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<PaginatedResponse<JobOrderDetail>>>('/job-orders', {
          params: { limit: 50 },
        })
      ).data.data,
  });

  const activeFactoryTasks =
    factoryTasks.data?.items.filter((task) => !['CLOSED', 'CANCELLED'].includes(task.status)) ?? [];
  const activeOperationalJobs =
    operationalJobs.data?.items.filter(
      (job) => !['DRAFT', 'CLOSED', 'CANCELLED'].includes(job.status),
    ) ?? [];
  const actionRequired = activeFactoryTasks.filter((task) => task.actionRequired).length;
  const pendingQa = qaQueue.data?.items.filter((task) => task.status !== 'QA_APPROVED') ?? [];
  const pendingApprovals = canOversee
    ? (qaQueue.data?.items.filter(
        (task) =>
          task.status === 'QA_IN_PROGRESS' &&
          task.totals.availableToInspect === 0 &&
          task.totals.awaitingReinspection === 0,
      ).length ?? 0)
    : 0;
  const failedQueries = [factoryTasks, qaQueue, rework, operationalJobs].filter(
    (query) => query.isError,
  );
  const recent = [
    ...(factoryTasks.data?.items.map((task) => ({
      id: `factory-${task.id}`,
      to: `/factory-tasks/${task.id}`,
      title: task.jobOrderNumber,
      detail: `${statusLabel(task.status)} · ${task.currentStage?.name ?? 'Production updated'}`,
      updatedAt: task.updatedAt,
    })) ?? []),
    ...(qaQueue.data?.items.map((task) => ({
      id: `qa-${task.id}`,
      to: `/qa/${task.id}`,
      title: task.jobOrderNumber,
      detail: `${statusLabel(task.status)} · ${task.factory.name}`,
      updatedAt: task.updatedAt,
    })) ?? []),
    ...activeOperationalJobs.map((job) => ({
      id: `operations-${job.id}`,
      to: `/job-orders/${job.id}`,
      title: job.jobOrderNumber,
      detail: `${statusLabel(job.status)} · ${job.factory.name}`,
      updatedAt: job.updatedAt,
    })),
  ]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4);

  const hasOperationalAccess = canUseFactoryTasks || canUseQa || canUseRework;

  return (
    <main className="min-h-full space-y-5 bg-background px-4 py-5">
      <header>
        <p className="text-sm text-muted-foreground">Welcome back, {user.name}</p>
        <h1 className="text-2xl font-semibold text-foreground">Operations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your current work and the areas available to your role.
        </p>
      </header>

      {failedQueries.length > 0 && (
        <section className="rounded-xl border border-danger/40 bg-surface p-4" role="alert">
          <p className="font-medium">Some operational summaries could not be refreshed.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Other available areas remain usable. Check your connection and try again.
          </p>
          <button
            className="mt-3 min-h-11 rounded-md bg-primary px-4 text-primary-foreground"
            onClick={() => failedQueries.forEach((query) => void query.refetch())}
          >
            Retry summaries
          </button>
        </section>
      )}

      {hasOperationalAccess ? (
        <section aria-labelledby="work-heading">
          <h2 id="work-heading" className="mb-3 text-sm font-semibold text-muted-foreground">
            AVAILABLE TO YOU
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {canUseFactoryTasks && (
              <SummaryLink
                to="/factory-tasks"
                title="Active job orders"
                value={activeFactoryTasks.length}
                detail={
                  factoryTasks.isLoading
                    ? 'Loading assigned production work…'
                    : `${actionRequired} require your next production action.`
                }
              />
            )}
            {canOversee && (
              <SummaryLink
                to="/job-orders"
                title="Active job orders"
                value={`${activeOperationalJobs.length}${operationalJobs.data?.pageInfo.hasMore ? '+' : ''}`}
                detail={
                  operationalJobs.isLoading
                    ? 'Loading factory production status…'
                    : 'Monitor current production across factories.'
                }
              />
            )}
            {canUseQa && (
              <SummaryLink
                to="/qa"
                title="QA queue"
                value={`${pendingQa.length}${qaQueue.data?.pageInfo.hasMore ? '+' : ''}`}
                detail={
                  qaQueue.isLoading
                    ? 'Loading inspections and reinspections…'
                    : `${pendingQa.length} active QA outcomes need review.`
                }
              />
            )}
            {canUseRework && (
              <SummaryLink
                to="/factory-rework"
                title={
                  canOversee && !canUseFactoryTasks ? 'Factory exceptions and rework' : 'QA rework'
                }
                value={rework.data?.length}
                detail={
                  rework.isLoading
                    ? 'Loading open rework…'
                    : `${rework.data?.length ?? 0} open rework tasks need follow-up.`
                }
              />
            )}
            {canOversee && (
              <SummaryLink
                to="/qa?filter=IN_PROGRESS"
                title="Pending approvals"
                value={pendingApprovals}
                detail="Completed inspection outcomes ready for final QA approval."
              />
            )}
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-semibold text-foreground">No mobile operational work assigned</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your current role has no mobile workflows. Configuration, reporting, and other
            administration remain available on the web application.
          </p>
        </section>
      )}

      {recent.length > 0 && (
        <section aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="text-lg font-semibold text-foreground">
            Recent operational activity
          </h2>
          <div className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
            {recent.map((item) => (
              <Link key={item.id} to={item.to} className="block min-h-16 px-4 py-3">
                <span className="block font-medium text-foreground">{item.title}</span>
                <span className="block text-sm text-muted-foreground">{item.detail}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
