# INV-008 Tax Invoice PDF handoff

Finalized invoices expose Print and Download PDF to ADMIN and ACCOUNTANT using
the existing authenticated invoice read and shared PDF lifecycle. Drafts have
neither action. Generation is lazy and retryable; it never finalizes an invoice.

The adapter consumes finalized financial and versioned document snapshots.
Grand total, signed round-off and final payable come directly from PR0 fields.
Amount words follow the frozen payable, or original grand total when a legacy
payable snapshot is unavailable. No line, GST or payable policy is recalculated.
Compatible presentation groups sum only issued line amounts and retain source
line IDs. Groups require matching Style, colour, HSN, MRP, rate and tax treatment.

Style identity, descriptions, colour, sizes and images come from the issued
snapshot. Current masters cannot change them. Verified multiple Dispatch Orders
are separate from EIPL and Erve Dispatch. Legitimate historical EISO values are
preserved verbatim, without conversion or inferred mapping. Unavailable
provenance is displayed honestly. Previously issued legacy records remain
untouched; missing snapshots are neither reconstructed nor treated as zero.

The A4 portrait document uses existing React-PDF infrastructure with parties,
references, compact images, size breakdown, HSN/MRP/rate/quantity/taxable rows,
financial and HSN summaries, amount words, declarations, signature space and
frozen seller/bank details. Long descriptions continue without duplicating
amounts; headers repeat. Declaration 2 uses issued applicability and FY without
claiming an unsnapshotted turnover exemption. RCM No is bold. E-Way references
are marked not recorded because capture belongs to INV-009.

Images use authenticated invoice-owned archive paths and retain aspect ratio.
JPEG uses the existing resolver at print quality; invoice-specific PNG/WebP
conversion preserves transparency. Failed images show placeholders. Shared
Style viewers, media implementations and permissions remain unchanged.

Verification covers actual PDF rendering, frozen amounts, historical EISO,
multiple orders, legacy gaps, grouping, long fields, pagination, image failures
and role-restricted actions. Native verification uses a disposable GitHub
desktop, guarded fresh Postgres and synthetic parties/images. It downloads
actual PDFs, opens native PDF/print previews and replaces a Style image after
issuance to prove archival independence. Inspection reconciles backend totals,
references, A4 bounds, image aspect/transparency and repeat authorized reads.
Private historical invoices and credentials are excluded from uploaded evidence.

Credit Notes and reports must consume issued payable/round-off snapshots and
handle legacy absence. Credit allocation, cancellation and E-Way capture remain
outside this PR. No schema/API behavior, GST activation, EI seed, production
migration, live invoice issue or deployment dispatch is included.
