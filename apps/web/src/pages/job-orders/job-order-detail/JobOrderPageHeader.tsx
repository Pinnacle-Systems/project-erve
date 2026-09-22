import { Link } from 'react-router-dom';
import { PageHeader } from '@erve/app-components';
import { Button } from '@erve/primitives';
import type { UsePdfActionResult } from '../../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../../lib/pdf/components/PdfActionButtons.js';

export interface JobOrderPageHeaderProps {
  jobOrderNumber: string;
  factoryName: string;
  pdfAction: UsePdfActionResult;
}

// Title/subtitle/breadcrumb-equivalent (Back) and the PDF actions only —
// operational status and the Send/Confirm/Cancel actions live in
// JobOrderStickyContext, the page's single canonical action location, so
// they aren't rendered in two places at once.
export function JobOrderPageHeader({ jobOrderNumber, factoryName, pdfAction }: JobOrderPageHeaderProps) {
  return (
    <PageHeader
      title={jobOrderNumber}
      subtitle={factoryName}
      secondaryActions={
        <>
          <PdfActionButtons
            isGenerating={pdfAction.isGenerating}
            error={pdfAction.error}
            onDownload={pdfAction.handleDownload}
            onPrint={pdfAction.handlePrint}
          />
          <Button asChild variant="secondary">
            <Link to="/job-orders">Back</Link>
          </Button>
        </>
      }
    />
  );
}
