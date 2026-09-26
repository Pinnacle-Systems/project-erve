import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@erve/layout';
import { Skeleton } from '@erve/primitives';

export interface KpiCardSubValue {
  label: string;
  value: number;
}

export interface KpiCardProps {
  title: string;
  /** The card's headline number. Omit only while `loading` — a real factual
   * zero is always rendered as "0", never hidden (RPT2 7.4 / 20). */
  value?: number;
  subValues?: KpiCardSubValue[];
  loading?: boolean;
  footnote?: ReactNode;
  /** A drilldown destination (RPT3 8.9/8.10) — omit entirely when the
   * viewer cannot reach the destination route, rather than rendering a
   * disabled or dead link. */
  href?: string;
}

export function KpiCard({ title, value, subValues, loading, footnote, href }: KpiCardProps) {
  const content = (
    <>
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {loading ? (
        <Skeleton className="h-8 w-20" />
      ) : (
        <p className="text-3xl font-semibold tabular-nums">{(value ?? 0).toLocaleString()}</p>
      )}
      {subValues && subValues.length > 0 && !loading ? (
        <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {subValues.map((sub) => (
            <div key={sub.label} className="flex items-baseline gap-1">
              <dt>{sub.label}</dt>
              <dd className="font-medium tabular-nums text-foreground">{sub.value.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {footnote ? <div className="mt-1 text-xs text-muted-foreground">{footnote}</div> : null}
    </>
  );

  if (href && !loading) {
    return (
      <Link to={href} className="block">
        <Card padding="md" className="flex flex-col gap-2 transition-shadow hover:shadow-panel">
          {content}
        </Card>
      </Link>
    );
  }

  return (
    <Card padding="md" className="flex flex-col gap-2">
      {content}
    </Card>
  );
}
