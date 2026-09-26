import type { ReactNode } from 'react';
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
}

export function KpiCard({ title, value, subValues, loading, footnote }: KpiCardProps) {
  return (
    <Card padding="md" className="flex flex-col gap-2">
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
    </Card>
  );
}
