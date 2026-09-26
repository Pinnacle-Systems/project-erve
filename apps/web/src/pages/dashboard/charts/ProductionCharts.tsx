import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Panel } from '@erve/layout';
import type { FactoryProductionWorkload, FactoryQuantityFlow, JobOrderPipelineBucket } from '@erve/types';
import { JOB_ORDER_STATUS_LABELS } from '../../job-orders/job-order-ui.js';
import { CHART_GRID_COLOR, CHART_MUTED_COLOR, CHART_SERIES_COLORS } from './chart-colors.js';

const STATUS_ORDER = Object.keys(JOB_ORDER_STATUS_LABELS);

// Bar chart of persisted Job Order status, stacked by Record Origin — origin
// is additive within a status (RPT3 8.2), so stacking is safe here; delayed
// is not a status and is never mixed into this chart.
export function ProductionPipelineChart({ pipeline }: { pipeline: JobOrderPipelineBucket[] }) {
  const byStatus = new Map<string, { status: string; LIVE_WORKFLOW: number; HISTORICAL_IMPORT: number }>();
  for (const bucket of pipeline) {
    const row = byStatus.get(bucket.status) ?? { status: bucket.status, LIVE_WORKFLOW: 0, HISTORICAL_IMPORT: 0 };
    row[bucket.recordOrigin] = bucket.count;
    byStatus.set(bucket.status, row);
  }
  const data = [...byStatus.values()]
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
    .map((row) => ({
      ...row,
      label: JOB_ORDER_STATUS_LABELS[row.status as keyof typeof JOB_ORDER_STATUS_LABELS] ?? row.status,
    }));

  if (data.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">No Job Orders match this view.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
        <XAxis dataKey="label" angle={-30} textAnchor="end" height={70} interval={0} tick={{ fontSize: 11, fill: CHART_MUTED_COLOR }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: CHART_MUTED_COLOR }} />
        <Tooltip />
        <Legend />
        <Bar dataKey="LIVE_WORKFLOW" name="Live workflow" stackId="origin" fill={CHART_SERIES_COLORS[0]} />
        <Bar dataKey="HISTORICAL_IMPORT" name="Historical import" stackId="origin" fill={CHART_SERIES_COLORS[1]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Grouped (never stacked) Open vs Delayed per Factory — Delayed is a subset
// of Open, so stacking them would double-count (RPT3 8.3).
export function FactoryWorkloadChart({ workload }: { workload: FactoryProductionWorkload[] }) {
  const data = workload.map((row) => ({
    name: row.factory.name,
    Open: row.openJobOrders,
    Delayed: row.delayedJobOrders,
  }));

  if (data.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">No Factory has open Job Orders in this view.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
        <XAxis dataKey="name" angle={-30} textAnchor="end" height={70} interval={0} tick={{ fontSize: 11, fill: CHART_MUTED_COLOR }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: CHART_MUTED_COLOR }} />
        <Tooltip />
        <Legend />
        <Bar dataKey="Open" fill={CHART_SERIES_COLORS[0]} />
        <Bar dataKey="Delayed" fill={CHART_SERIES_COLORS[4]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Grouped bars per Factory: Ordered / Prepared / Final QA Passed / Factory
// Dispatched are independent factual measures, never a funnel, never
// stacked, never a percentage (RPT3 8.4). Cancelled ordered quantity is
// its own separate bar — it never inflates the Ordered bar.
export function ProductionQuantityFlowChart({ quantityFlow }: { quantityFlow: FactoryQuantityFlow[] }) {
  const data = quantityFlow.map((row) => ({
    name: row.factory.name,
    Ordered: row.orderedPieces,
    'Cancelled (excluded from Ordered)': row.cancelledOrderedPieces,
    Prepared: row.preparedPieces,
    'Final QA Passed': row.qaPassedPieces,
    'Factory Dispatched': row.factoryDispatchedPieces,
  }));

  if (data.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">No production quantity in this view.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
        <XAxis dataKey="name" angle={-30} textAnchor="end" height={70} interval={0} tick={{ fontSize: 11, fill: CHART_MUTED_COLOR }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: CHART_MUTED_COLOR }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Ordered" fill={CHART_SERIES_COLORS[0]} />
        <Bar dataKey="Cancelled (excluded from Ordered)" fill={CHART_MUTED_COLOR} />
        <Bar dataKey="Prepared" fill={CHART_SERIES_COLORS[1]} />
        <Bar dataKey="Final QA Passed" fill={CHART_SERIES_COLORS[2]} />
        <Bar dataKey="Factory Dispatched" fill={CHART_SERIES_COLORS[3]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ProductionPipelinePanel({ pipeline }: { pipeline: JobOrderPipelineBucket[] }) {
  return (
    <Panel title="Production Pipeline" description="Persisted Job Order status, split by Record Origin.">
      <ProductionPipelineChart pipeline={pipeline} />
    </Panel>
  );
}

export function FactoryWorkloadPanel({ workload }: { workload: FactoryProductionWorkload[] }) {
  return (
    <Panel title="Factory Workload" description="Open Job Orders per Factory, with the Delayed subset shown alongside.">
      <FactoryWorkloadChart workload={workload} />
    </Panel>
  );
}

export function ProductionQuantityFlowPanel({ quantityFlow }: { quantityFlow: FactoryQuantityFlow[] }) {
  return (
    <Panel
      title="Production Quantity Flow"
      description="Independent factual measures per Factory — not a conversion funnel."
    >
      <ProductionQuantityFlowChart quantityFlow={quantityFlow} />
    </Panel>
  );
}
