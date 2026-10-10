import { Link } from 'react-router-dom';
import { PageHeader } from '@erve/app-components';
import { Button } from '@erve/primitives';
import type { UsePdfActionResult } from '../../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../../lib/pdf/components/PdfActionButtons.js';
import { StyleThumbnailCell } from '../../../components/style/StyleThumbnailCell.js';
import { resolveJobOrderPrimaryStyle, type JobOrderPrimaryStyle } from '../resolveJobOrderPrimaryStyle.js';

export interface JobOrderPageHeaderProps {
  jobOrderNumber: string;
  factoryName: string;
  lines: JobOrderPrimaryStyle[];
  pdfAction: UsePdfActionResult;
}

// Title/subtitle/breadcrumb-equivalent (Back) and the PDF actions only —
// operational status and the Send/Confirm/Cancel actions live in
// JobOrderStickyContext, the page's single canonical action location, so
// they aren't rendered in two places at once.
export function JobOrderPageHeader({ jobOrderNumber, factoryName, lines, pdfAction }: JobOrderPageHeaderProps) {
  const primaryStyle = resolveJobOrderPrimaryStyle(lines);
  return (
    <PageHeader
      title={jobOrderNumber}
      subtitle={factoryName}
      // Multi-Style fallback (legacy/inconsistent data only — the business
      // model guarantees one Style per Job Order): render nothing rather
      // than guess a line's image, matching the resolver's own contract.
      leadingVisual={
        primaryStyle.consistent && (
          <StyleThumbnailCell
            styleId={primaryStyle.style.styleId}
            image={primaryStyle.style.primaryImage}
            size={56}
            viewerTitle={primaryStyle.style.styleNumber}
          />
        )
      }
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
