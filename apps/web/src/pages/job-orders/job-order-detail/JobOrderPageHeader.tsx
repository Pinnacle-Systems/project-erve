import { Link } from 'react-router-dom';
import { PageHeader } from '@erve/app-components';
import { Button } from '@erve/primitives';
import type { UsePdfActionResult } from '../../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../../lib/pdf/components/PdfActionButtons.js';
import { StyleThumbnailCell } from '../../../components/style/StyleThumbnailCell.js';
import { StyleIdentityUnavailable } from '../../../components/style/StyleIdentityUnavailable.js';
import { IDENTITY_HEADER_IMAGE_SIZE } from '../../../components/style/identity-header-image-size.js';
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
  // A Job Order is exactly one Style by business rule — same as an Order
  // Sheet — regardless of how many source Order Sheets or Size/allocation
  // lines it has. resolveJobOrderPrimaryStyle's "inconsistent" branch is a
  // defensive check against legacy data that violates that rule, never a
  // legitimate "this Job Order has several Styles" case, so it's never
  // rendered as if nothing were wrong.
  const primaryStyle = resolveJobOrderPrimaryStyle(lines);
  return (
    <PageHeader
      title={jobOrderNumber}
      subtitle={factoryName}
      leadingVisual={
        primaryStyle.consistent ? (
          <StyleThumbnailCell
            styleId={primaryStyle.style.styleId}
            image={primaryStyle.style.primaryImage}
            size={IDENTITY_HEADER_IMAGE_SIZE}
            viewerTitle={primaryStyle.style.styleNumber}
          />
        ) : (
          <StyleIdentityUnavailable
            size={IDENTITY_HEADER_IMAGE_SIZE}
            reason="Style identity unavailable — this Job Order's lines disagree on Style, which should never happen. Reported for investigation, not guessed."
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
