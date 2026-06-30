import { Badge } from "@erve/primitives";
import type { BadgeVariant } from "@erve/primitives";

export type DocumentStatusTone =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "posted"
  | "cancelled"
  | "pending";
export type StatusBadgeTone = BadgeVariant | DocumentStatusTone;

export interface StatusBadgeProps {
  label: string;
  tone?: StatusBadgeTone;
  status?: string;
  className?: string;
}

const documentStatusClasses: Partial<Record<StatusBadgeTone, string>> = {
  draft: "bg-[var(--erp-status-draft-bg)] text-[var(--erp-status-draft-fg)] border-[var(--erp-status-draft-border)]",
  submitted:
    "bg-[var(--erp-status-submitted-bg)] text-[var(--erp-status-submitted-fg)] border-[var(--erp-status-submitted-border)]",
  approved:
    "bg-[var(--erp-status-approved-bg)] text-[var(--erp-status-approved-fg)] border-[var(--erp-status-approved-border)]",
  rejected:
    "bg-[var(--erp-status-rejected-bg)] text-[var(--erp-status-rejected-fg)] border-[var(--erp-status-rejected-border)]",
  posted: "bg-[var(--erp-status-posted-bg)] text-[var(--erp-status-posted-fg)] border-[var(--erp-status-posted-border)]",
  cancelled:
    "bg-[var(--erp-status-cancelled-bg)] text-[var(--erp-status-cancelled-fg)] border-[var(--erp-status-cancelled-border)]",
  pending:
    "bg-[var(--erp-status-pending-bg)] text-[var(--erp-status-pending-fg)] border-[var(--erp-status-pending-border)]",
};

const badgeTone = (tone: StatusBadgeTone): BadgeVariant =>
  tone in documentStatusClasses ? "default" : (tone as BadgeVariant);

export const StatusBadge = ({ label, tone = "default", status, className }: StatusBadgeProps) => {
  const resolvedTone = (status as DocumentStatusTone | undefined) ?? tone;

  return (
    <Badge
      variant={badgeTone(resolvedTone)}
      className={[documentStatusClasses[resolvedTone], className].filter(Boolean).join(" ")}
    >
      {label}
    </Badge>
  );
};

StatusBadge.displayName = "StatusBadge";
