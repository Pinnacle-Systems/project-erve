import type { QualityExecutionView } from '@erve/types';

type Section = QualityExecutionView['sections'][number];
type Component = Section['components'][number];
type Field = Record<string, unknown>;
const fields = (value: unknown): Field[] =>
  Array.isArray(value)
    ? value.filter((item): item is Field => item !== null && typeof item === 'object')
    : [];
const normalized = (value: unknown) =>
  String(value ?? '')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .toUpperCase();
const provenance = new Set([
  'CUSTOMER',
  'CUSTOMER_NAME',
  'DISTRIBUTOR',
  'DISTRIBUTOR_NAME',
  'PURCHASE_ORDER',
  'PURCHASE_ORDER_NUMBER',
  'ORDER_NUMBER',
  'PO_NUMBER',
  'ORDER_SHEET',
  'ORDER_SHEET_NUMBER',
  'ORDER_SHEET_REFERENCE',
  'ORDER_SHEET_ID',
  'EIOS',
  'EIOS_NUMBER',
  'EIOS_REFERENCE',
  'MERCHANDISER',
  'MERCHANDISER_NAME',
]);
const identityLabels: Record<string, string> = {
  JOB_ORDER_NUMBER: 'Job Order',
  FACTORY_NAME: 'Factory',
  SUPPLIER_NAME: 'Factory',
  STYLE_NUMBER: 'Style',
  ORDER_QUANTITY: 'Job Order quantity',
  SEASON_SNAPSHOT: 'Season snapshot',
};
function systemField(component: Component, field: Field): boolean {
  return (
    field.source !== 'USER' && (field.source === 'SYSTEM' || component.type === 'SYSTEM_CONTEXT')
  );
}
function source(field: Field): string {
  return normalized(field.sourceKey ?? field.key);
}
/** Derived context is filtered for display only; authored fields and response payloads are untouched. */
export function qualityPresentationSections(
  sections: Section[],
  consolidateIdentity = false,
): Section[] {
  return sections.flatMap((section) => {
    const components = section.components.flatMap((component) => {
      if (!['SYSTEM_CONTEXT', 'FIELD_GROUP', 'QUANTITY_RECONCILIATION'].includes(component.type))
        return [component];
      const property = Array.isArray(component.config.fields) ? 'fields' : 'metrics';
      const definitions = fields(component.config[property]);
      const allowed = (field: Field) =>
        !systemField(component, field) ||
        (!provenance.has(source(field)) && !(consolidateIdentity && identityLabels[source(field)]));
      const visible = definitions.filter(allowed);
      const systemValue = component.systemValue?.filter((item) => {
        const definition = definitions.find((field) => field.key === item.key) ?? { key: item.key };
        return allowed(definition);
      });
      if (visible.length === 0 && (!systemValue || systemValue.length === 0)) return [];
      return [{ ...component, config: { ...component.config, [property]: visible }, systemValue }];
    });
    return components.length ? [{ ...section, components }] : [];
  });
}

/** Available system identity only. Never derive a quantity, customer or historical Season. */
export function qualityIdentityItems(
  execution: QualityExecutionView,
): Array<{ label: string; value: string }> {
  const items = new Map<string, string>();
  for (const section of execution.sections)
    for (const component of section.components) {
      if (!['SYSTEM_CONTEXT', 'FIELD_GROUP', 'QUANTITY_RECONCILIATION'].includes(component.type))
        continue;
      for (const field of fields(component.config.fields ?? component.config.metrics)) {
        const key = source(field);
        const label = identityLabels[key];
        if (!label || label === 'Job Order' || label === 'Style' || !systemField(component, field))
          continue;
        const value = component.systemValue?.find((item) => item.key === field.key);
        if (value?.available && value.value !== null && value.value !== undefined)
          items.set(label, String(value.value));
      }
    }
  return [...items].map(([label, value]) => ({ label, value }));
}
