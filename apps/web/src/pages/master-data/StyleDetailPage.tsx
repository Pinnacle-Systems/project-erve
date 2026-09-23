import { useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { useAuth } from '../../auth/AuthContext.js';
import { canManageStyles } from '../../auth/permissions.js';
import { apiClient } from '../../lib/api-client.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { StyleImagesPanel } from './StyleImagesPanel.js';
import { StyleIdentityDetail } from './style/StyleIdentityDetail.js';
import { StyleCommercialDetail } from './style/StyleCommercialDetail.js';
import type { Style } from './types.js';

export function StyleDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const styleQuery = useQuery({
    queryKey: ['style', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<Style>>(`/styles/${id}`);
      return response.data.data;
    },
  });
  const style = styleQuery.data;

  const generateStyleDetailPdf = useCallback(async () => {
    if (!style) throw new Error('Style not loaded');
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateStyleDetailPdfBlob } = await import('./pdf/generateStyleDetailPdf.js');
    return generateStyleDetailPdfBlob(style, {
      generatedAt: new Date().toISOString(),
      generatedBy: user?.name,
    });
  }, [style, user?.name]);

  const styleDetailPdfFilename = useCallback(
    () => buildPdfFilename(['ERVE-Style', style?.styleNumber]),
    [style?.styleNumber],
  );

  const pdfAction = usePdfAction({ generate: generateStyleDetailPdf, filename: styleDetailPdfFilename });

  if (styleQuery.isLoading) {
    return <LoadingState label="Loading style" />;
  }
  if (styleQuery.isError) {
    return <ErrorState title="Unable to load style" description={styleQuery.error.message} />;
  }
  if (!style) {
    return (
      <EmptyState title="Style not found" description="The selected style could not be loaded." />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={style.styleNumber}
        subtitle={style.styleName}
        status={
          <StatusBadge
            label={style.status}
            tone={style.status === 'ACTIVE' ? 'success' : 'muted'}
          />
        }
        primaryAction={
          <div className="flex items-start gap-3">
            <PdfActionButtons
              isGenerating={pdfAction.isGenerating}
              error={pdfAction.error}
              onDownload={pdfAction.handleDownload}
              onPrint={pdfAction.handlePrint}
            />
            {canManageStyles(user) ? (
              <Button asChild>
                <Link to={`/master-data/styles/${style.id}/edit`}>Edit</Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <Panel title="Identity & Classification">
        <StyleIdentityDetail style={style} />
      </Panel>

      <Panel title="Commercial & Tax">
        <StyleCommercialDetail style={style} />
      </Panel>

      <StyleImagesPanel
        styleId={style.id}
        images={style.images}
        canManage={canManageStyles(user)}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Valid Sizes">
          <div className="flex flex-wrap gap-2">
            {style.sizes.map((size) => (
              <StatusBadge
                key={size.id}
                label={size.code}
                tone={size.mappingStatus === 'ACTIVE' ? 'info' : 'muted'}
              />
            ))}
          </div>
        </Panel>
        <Panel title="Factory Mappings">
          <div className="divide-y divide-border-subtle">
            {style.factories.map((factory) => (
              <div
                key={factory.id}
                className="flex justify-between gap-3 py-2 text-sm text-foreground"
              >
                <span>{factory.name}</span>
                <span className="font-medium">{factory.exFactoryPrice.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
