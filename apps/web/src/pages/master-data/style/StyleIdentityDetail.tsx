import type { ReactNode } from 'react';
import { StatusBadge } from '@erve/app-components';
import { DescriptionList } from '@erve/layout';
import type { Style } from '../types.js';

export function StyleIdentityDetail({ style }: { style: Style }) {
  const fields: Array<[string, ReactNode]> = [
    ['Style Number', style.styleNumber],
    ['Style Name', style.styleName],
    ['LMIX Number', style.lmixNumber],
    [
      'Season',
      <StatusBadge
        key="season"
        label={`${style.season.displayName} — ${style.season.name}`}
        tone={style.season.status === 'ACTIVE' ? 'info' : 'muted'}
      />,
    ],
    ['Category', style.categoryDescription],
    ['Item Name Group', style.itemNameGroup],
    ['IP Name', style.ipName],
    ['Licensor', style.licensor],
    ['Colour', style.colour],
    ['Description', style.description],
  ];

  return (
    <DescriptionList columns={3}>
      {fields.map(([label, value]) => (
        <DescriptionList.Item key={label} label={label} value={value} />
      ))}
    </DescriptionList>
  );
}
