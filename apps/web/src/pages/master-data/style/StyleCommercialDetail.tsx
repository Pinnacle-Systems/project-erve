import { DescriptionList } from '@erve/layout';
import type { Style } from '../types.js';

export function StyleCommercialDetail({ style }: { style: Style }) {
  const fields: Array<[string, string | number | null]> = [
    ['HSN Code', style.hsnCode],
    ['HSN Description', style.hsnDescription],
    ['Final MRP', style.finalMrp.toFixed(2)],
    ['Royalty %', style.royaltyPercentage ?? '-'],
  ];

  return (
    <DescriptionList columns={3}>
      {fields.map(([label, value]) => (
        <DescriptionList.Item key={label} label={label} value={value} />
      ))}
    </DescriptionList>
  );
}
