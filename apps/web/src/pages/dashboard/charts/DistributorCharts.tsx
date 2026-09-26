import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Panel } from '@erve/layout';
import type { DistributorReturnReportRow, SaleOrReturnReportRow } from '@erve/types';
import { CHART_GRID_COLOR, CHART_MUTED_COLOR, CHART_SERIES_COLORS } from './chart-colors.js';

const TOP_N_DISTRIBUTORS = 10;

// Horizontal stacked bar per Distributor, bounded to the top N by
// remainingWithDistributor (RPT3 8.6). The stacked total is `received`,
// split mutually-exclusively into Sold / Returned / Approved awaiting
// receipt / Other remaining (= availableForActualSale). Pending requested
// overlaps remaining stock, so it is rendered as a separate adjacent value,
// never stacked into the same total.
export function DistributorSorPositionChart({ rows }: { rows: SaleOrReturnReportRow[] }) {
  const byDistributor = new Map<
    string,
    { name: string; sold: number; returned: number; approvedAwaitingReceipt: number; pendingRequested: number; remainingWithDistributor: number }
  >();
  for (const row of rows) {
    const existing = byDistributor.get(row.distributor.id) ?? {
      name: row.distributor.name,
      sold: 0,
      returned: 0,
      approvedAwaitingReceipt: 0,
      pendingRequested: 0,
      remainingWithDistributor: 0,
    };
    existing.sold += row.sold;
    existing.returned += row.returned;
    existing.approvedAwaitingReceipt += row.approvedAwaitingReceipt;
    existing.pendingRequested += row.pendingRequested;
    existing.remainingWithDistributor += row.remainingWithDistributor;
    byDistributor.set(row.distributor.id, existing);
  }
  const data = [...byDistributor.values()]
    .sort((a, b) => b.remainingWithDistributor - a.remainingWithDistributor)
    .slice(0, TOP_N_DISTRIBUTORS)
    .map((row) => ({
      name: row.name,
      Sold: row.sold,
      Returned: row.returned,
      'Approved awaiting receipt': row.approvedAwaitingReceipt,
      'Other remaining': Math.max(0, row.remainingWithDistributor - row.approvedAwaitingReceipt),
      pendingRequested: row.pendingRequested,
    }));

  if (data.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">No Sale-or-Return positions match this view.</p>;
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={Math.max(220, data.length * 44)}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: CHART_MUTED_COLOR }} />
          <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11, fill: CHART_MUTED_COLOR }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Sold" stackId="position" fill={CHART_SERIES_COLORS[2]} />
          <Bar dataKey="Returned" stackId="position" fill={CHART_SERIES_COLORS[4]} />
          <Bar dataKey="Approved awaiting receipt" stackId="position" fill={CHART_SERIES_COLORS[3]} />
          <Bar dataKey="Other remaining" stackId="position" fill={CHART_SERIES_COLORS[0]} />
        </BarChart>
      </ResponsiveContainer>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
        {data.map((row) => (
          <div key={row.name} className="flex justify-between gap-2">
            <dt>{row.name} — pending requested</dt>
            <dd className="font-medium tabular-nums text-foreground">{row.pendingRequested.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function DistributorSorPositionPanel({ rows }: { rows: SaleOrReturnReportRow[] }) {
  return (
    <Panel
      title="Sale-or-Return Distributor Position"
      description="Top Distributors by remaining stock. Pending requested overlaps remaining stock and is shown separately."
    >
      <DistributorSorPositionChart rows={rows} />
    </Panel>
  );
}

const RETURN_STATUS_ORDER = ['SUBMITTED', 'APPROVED', 'RECEIVED', 'REJECTED', 'CANCELLED'];

export function DistributorReturnStatusChart({ rows }: { rows: DistributorReturnReportRow[] }) {
  const byStatus = new Map<string, number>();
  for (const row of rows) {
    if (!row.status) continue;
    byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + row.requested);
  }
  const data = RETURN_STATUS_ORDER.filter((status) => byStatus.has(status)).map((status) => ({
    status: status.charAt(0) + status.slice(1).toLowerCase(),
    count: byStatus.get(status) ?? 0,
  }));

  if (data.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">No Distributor Returns match this view.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
        <XAxis dataKey="status" tick={{ fontSize: 11, fill: CHART_MUTED_COLOR }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: CHART_MUTED_COLOR }} />
        <Tooltip />
        <Bar dataKey="count" fill={CHART_SERIES_COLORS[0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DistributorReturnStatusPanel({ rows }: { rows: DistributorReturnReportRow[] }) {
  return (
    <Panel title="Distributor Return Status" description="Requested quantity by return status.">
      <DistributorReturnStatusChart rows={rows} />
    </Panel>
  );
}
