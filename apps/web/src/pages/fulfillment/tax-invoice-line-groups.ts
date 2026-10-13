import type { TaxInvoiceArchivedImage, TaxInvoiceLineView, TaxInvoiceView } from '@erve/types';
import { formatInvoiceMoney } from './tax-invoice-ui.js';

function decimal(value: string): string {
  const text = formatInvoiceMoney(value);
  if (text === 'Unavailable') throw new Error('Invalid authoritative monetary value');
  return text.replace(/[₹,]/g, '').replace('−', '-');
}

/** Adds authoritative amounts for display only. Never calculates rates, tax or rounding. */
export function sumInvoiceAmounts(values: Array<string | null>): string | null {
  if (values.some((value) => value === null)) return null;
  const parts = values.map((value) => decimal(value!).split('.'));
  const scale = Math.max(2, ...parts.map((part) => part[1]!.length));
  const sum = parts.reduce((total, [whole, fraction]) => {
    const magnitude = BigInt(whole!.replace('-', '') + fraction!.padEnd(scale, '0'));
    return total + (whole!.startsWith('-') ? -magnitude : magnitude);
  }, 0n);
  const digits = (sum < 0n ? -sum : sum).toString().padStart(scale + 1, '0');
  return `${sum < 0n ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

function financialKey(value: string | null): string | null {
  return value === null ? null : decimal(value).replace(/0+$/, '').replace(/\.$/, '');
}

export interface TaxInvoiceLineGroup {
  id: string;
  sourceLineIds: string[];
  sourceLines: TaxInvoiceLineView[];
  styleNumber: string;
  styleName: string;
  description: string | null;
  colour: string | null;
  image: TaxInvoiceArchivedImage | null;
  sizes: string;
  quantity: number;
  taxableValue: string | null;
}

/** Draft metadata and issued snapshots are separate inputs; legacy identity is never guessed. */
export function buildTaxInvoiceLineGroups(invoice: TaxInvoiceView): TaxInvoiceLineGroup[] {
  const draft = invoice.status === 'DRAFT';
  const snapshot =
    !draft && invoice.documentSnapshot?.schemaVersion === 'ERVE_TAX_INVOICE_DOCUMENT_V1'
      ? invoice.documentSnapshot
      : null;
  const issuedById = new Map(snapshot?.lines.map((line, index) => [line.lineId, { line, index }]));
  const groups = new Map<
    string,
    {
      group: TaxInvoiceLineGroup;
      sizes: Map<string, { label: string; quantity: number; order: number; code: string }>;
    }
  >();
  for (const line of invoice.lines) {
    const issuedEntry = issuedById.get(line.id);
    const issued = issuedEntry?.line;
    if (issued && (issued.quantity !== line.quantity || issued.style.id !== line.style.id))
      throw new Error('Issued presentation does not match its financial line');
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 0)
      throw new Error('Invoice quantity exceeds safe presentation range');
    const identity = draft ? line.style : issued?.style;
    const key = identity
      ? JSON.stringify([
          identity.id,
          identity.styleNumber,
          identity.styleName,
          issued?.style.description,
          issued?.style.colour,
          line.hsn?.code,
          financialKey(line.styleMrp),
          financialKey(line.distributorPricingPercentage),
          financialKey(line.finalUnitRate),
          financialKey(line.gstPercent),
          invoice.gstTreatment,
          issued?.image?.id,
        ])
      : `legacy:${line.id}`;
    let entry = groups.get(key);
    if (!entry) {
      entry = {
        sizes: new Map(),
        group: {
          id: line.id,
          sourceLineIds: [],
          sourceLines: [],
          styleNumber: identity?.styleNumber ?? 'Not recorded',
          styleName: identity?.styleName ?? '',
          description: issued?.style.description ?? null,
          colour: issued?.style.colour ?? null,
          image: issued?.image ?? null,
          sizes: '',
          quantity: 0,
          taxableValue: null,
        },
      };
      groups.set(key, entry);
    }
    entry.group.sourceLineIds.push(line.id);
    entry.group.sourceLines.push(line);
    entry.group.id = [entry.group.id, line.id].sort()[0]!;
    entry.group.quantity += line.quantity;
    if (!Number.isSafeInteger(entry.group.quantity))
      throw new Error('Invoice quantity exceeds safe presentation range');
    if (line.quantity === 0) continue;
    const size = draft ? line.size : issued?.size;
    const sizeKey = size ? JSON.stringify([size.code, size.label]) : line.id;
    const value = entry.sizes.get(sizeKey) ?? {
      label: size?.label ?? 'Not recorded',
      quantity: 0,
      code: size?.code ?? line.id,
      order:
        size?.sortOrder ??
        (draft ? Number.MAX_SAFE_INTEGER : (issuedEntry?.index ?? Number.MAX_SAFE_INTEGER)),
    };
    value.quantity += line.quantity;
    value.order = Math.min(
      value.order,
      size?.sortOrder ??
        (draft ? Number.MAX_SAFE_INTEGER : (issuedEntry?.index ?? Number.MAX_SAFE_INTEGER)),
    );
    entry.sizes.set(sizeKey, value);
  }
  return [...groups.values()]
    .sort((a, b) => a.group.id.localeCompare(b.group.id))
    .map(({ group, sizes }) => ({
      ...group,
      sourceLineIds: [...group.sourceLineIds].sort(),
      sourceLines: [...group.sourceLines].sort((a, b) => a.id.localeCompare(b.id)),
      taxableValue: sumInvoiceAmounts(group.sourceLines.map((line) => line.taxableValue)),
      sizes: [...sizes.values()]
        .sort((a, b) => a.order - b.order || a.code.localeCompare(b.code))
        .map((size) =>
          /^\d+$/.test(size.label)
            ? `${size.label}-${size.quantity}`
            : `${size.label}: ${size.quantity}`,
        )
        .join(', '),
    }));
}
