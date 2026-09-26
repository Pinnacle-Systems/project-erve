import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Panel } from '@erve/layout';
import type { ReportFulfillment } from '@erve/types';
import { CHART_GRID_COLOR, CHART_MUTED_COLOR, CHART_SERIES_COLORS } from './chart-colors.js';

function MiniStatusBarChart({ counts }: { counts: Record<string, number> }) {
  const data = Object.entries(counts).map(([status, count]) => ({
    status: status.replaceAll('_', ' '),
    count,
  }));
  if (data.length === 0 || data.every((row) => row.count === 0)) {
    return <p className="p-4 text-center text-xs text-muted-foreground">No records in this view.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
        <XAxis dataKey="status" tick={{ fontSize: 10, fill: CHART_MUTED_COLOR }} interval={0} angle={-20} textAnchor="end" height={40} />
        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: CHART_MUTED_COLOR }} width={28} />
        <Tooltip />
        <Bar dataKey="count" fill={CHART_SERIES_COLORS[0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Bar-based visualization across distinct entity groups — each family
// keeps its own status vocabulary and its own small chart; they are never
// combined into one fake additive total (RPT3 8.5).
export function FulfillmentStatusCharts({ fulfillment }: { fulfillment: ReportFulfillment }) {
  const packingAuditCounts = {
    'Never audited': fulfillment.packingAudit.neverAudited,
    'Needs reinspection': fulfillment.packingAudit.needingReinspection,
    'Currently passed': fulfillment.packingAudit.currentlyPassed,
  };
  const deliveryCounts = {
    'User confirmed': fulfillment.delivery.userConfirmed,
    'Legacy assumed full receipt': fulfillment.delivery.legacyAssumedFullReceipt,
  };
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Panel title="Factory Packing" density="compact">
        <MiniStatusBarChart counts={fulfillment.factoryDispatch} />
      </Panel>
      <Panel title="Packing Audit" density="compact">
        <MiniStatusBarChart counts={packingAuditCounts} />
      </Panel>
      <Panel title="Factory Invoice" density="compact">
        <MiniStatusBarChart counts={fulfillment.factoryInvoice} />
      </Panel>
      <Panel title="Erve Packing" density="compact">
        <MiniStatusBarChart counts={fulfillment.ervePackingList} />
      </Panel>
      <Panel title="Erve Dispatch" density="compact">
        <MiniStatusBarChart counts={fulfillment.erveDispatch} />
      </Panel>
      <Panel title="Delivery Source" density="compact">
        <MiniStatusBarChart counts={deliveryCounts} />
      </Panel>
    </div>
  );
}
