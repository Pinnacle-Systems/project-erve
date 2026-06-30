import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { AuditTrail, PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { Style } from './types.js';

export function StyleDetailPage() {
  const { id } = useParams();
  const styleQuery = useQuery({
    queryKey: ['style', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<Style>>(`/styles/${id}`);
      return response.data.data;
    },
  });
  const style = styleQuery.data;

  if (styleQuery.isLoading) {
    return <LoadingState label="Loading style" />;
  }
  if (!style) {
    return <EmptyState title="Style not found" description="The selected style could not be loaded." />;
  }

  const fields = [
    ['Style Number', style.styleNumber],
    ['Style Name', style.styleName],
    ['Description', style.description],
    ['Category', style.categoryDescription],
    ['Item Name Group', style.itemNameGroup],
    ['IP Name', style.ipName],
    ['Licensor', style.licensor],
    ['Colour', style.colour],
    ['LMIX Number', style.lmixNumber],
    ['HSN Code', style.hsnCode],
    ['HSN Description', style.hsnDescription],
    ['Final MRP', style.finalMrp.toFixed(2)],
    ['Royalty %', style.royaltyPercentage ?? '-'],
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={style.styleNumber}
        subtitle={style.styleName}
        status={<StatusBadge label={style.status} tone={style.status === 'ACTIVE' ? 'success' : 'muted'} />}
        primaryAction={
          <Button asChild>
            <Link to={`/master-data/styles/${style.id}/edit`}>Edit</Link>
          </Button>
        }
      />

      <Panel title="Style Details">
        <DescriptionList columns={3}>
          {fields.map(([label, value]) => (
            <DescriptionList.Item key={label} label={label} value={value} />
          ))}
        </DescriptionList>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Valid Sizes">
          <div className="flex flex-wrap gap-2">
            {style.sizes.map((size) => (
              <StatusBadge key={size.id} label={size.code} tone={size.mappingStatus === 'ACTIVE' ? 'info' : 'muted'} />
            ))}
          </div>
        </Panel>
        <Panel title="Factory Mappings">
          <div className="divide-y divide-border-subtle">
            {style.factories.map((factory) => (
              <div key={factory.id} className="flex justify-between gap-3 py-2 text-sm text-foreground">
                <span>{factory.name}</span>
                <span className="font-medium">{factory.exFactoryPrice.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Audit">
        <AuditTrail items={[]} emptyState="Audit events will appear here." />
      </Panel>
    </div>
  );
}
