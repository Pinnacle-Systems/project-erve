import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { StyleSizeGrid } from '../../components/style-size-grid/StyleSizeGrid.js';
import { SourceLinesDisclosure } from '../../components/style-size-grid/StyleSizeMetricMatrix.js';
import { groupSourceLinesByStyle } from './style-size-grouping.js';
import type { DistributorSalesReportLineView, DistributorSalesReportView } from './types.js';

/**
 * One independent business context per Erve Dispatch + source Sale Order: a Style sold under two
 * Dispatches (or two orders) is two separate rows, never one merged quantity.
 */
function contextOf(line: DistributorSalesReportLineView) {
  return `${line.erveDispatch.id}::${line.saleOrderId}`;
}

function groupByContext(lines: DistributorSalesReportLineView[]) {
  const contexts = new Map<string, DistributorSalesReportLineView[]>();
  for (const line of lines) contexts.set(contextOf(line), [...(contexts.get(contextOf(line)) ?? []), line]);
  return [...contexts.values()];
}

export function DistributorSalesReportDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['distributor-sales-report', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<DistributorSalesReportView>>(`/distributor-sales-reports/${id}`);
      return res.data.data;
    },
  });
  const report = query.data;

  if (query.isLoading) return <LoadingState label="Loading sales report" />;
  if (query.isError)
    return <ErrorState title="Unable to load sales report" description={query.error.message} />;
  if (!report) return <EmptyState title="Sales report not found" tone="error" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Sales Report · ${new Date(report.reportDate).toLocaleDateString()}`}
        subtitle={report.distributor.name}
        secondaryActions={
          <Button variant="secondary" onClick={() => navigate('/fulfillment/distributor-sales-reports')}>
            Back
          </Button>
        }
      />

      <Panel title="Report Details">
        <DescriptionList columns={4}>
          <DescriptionList.Item label="Distributor" value={report.distributor.name} />
          <DescriptionList.Item label="Submitted By" value={report.submittedBy.name} />
          <DescriptionList.Item label="Submitted At" value={new Date(report.submittedAt).toLocaleString()} />
          {report.remarks && <DescriptionList.Item label="Remarks" value={report.remarks} span={2} />}
        </DescriptionList>
      </Panel>

      <Panel title="Lines" padding="sm">
        {report.lines.length === 0 ? (
          <EmptyState title="No lines" />
        ) : (
          <div className="space-y-6">
            {groupByContext(report.lines).map((contextLines) => {
              const first = contextLines[0]!;
              const { columns, rows } = groupSourceLinesByStyle(contextLines);
              const hasSplitCell = rows.some((row) =>
                Object.values(row.sourcesBySize).some((sources) => sources.length > 1),
              );
              return (
                <section key={contextOf(first)} aria-label={`${first.erveDispatch.erveDispatchNumber} ${first.saleOrderNumber}`}>
                  <h3 className="mb-2 text-sm font-medium">
                    {first.erveDispatch.erveDispatchNumber}
                    <span className="font-normal text-muted-foreground"> · Order {first.saleOrderNumber}</span>
                  </h3>
                  <StyleSizeGrid
                    variant="readOnly"
                    columns={columns}
                    rows={rows.map((row) => ({
                      styleId: row.styleId,
                      styleNumber: row.styleNumber,
                      styleName: row.styleName,
                      primaryImage: row.primaryImage,
                      values: Object.fromEntries(
                        Object.entries(row.sourcesBySize).map(([sizeId, sources]) => [
                          sizeId,
                          sources.reduce((sum, source) => sum + source.quantitySold, 0),
                        ]),
                      ),
                    }))}
                  />
                  {hasSplitCell && (
                    <div className="mt-2">
                      <SourceLinesDisclosure summary="Source lines (a Style / Size was reported on more than one line)">
                        <ul className="space-y-0.5">
                          {contextLines.map((line) => (
                            <li key={line.id} className="tabular-nums">
                              {line.styleNumber} / {line.sizeLabel}: {line.quantitySold.toLocaleString()}{' '}
                              <span className="text-muted-foreground">(line {line.id})</span>
                            </li>
                          ))}
                        </ul>
                      </SourceLinesDisclosure>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
