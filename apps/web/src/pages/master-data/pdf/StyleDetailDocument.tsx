import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { PdfDocument } from '../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../lib/pdf/core/PdfKeyValueSection.js';
import { PdfThumbnail } from '../../../lib/pdf/core/PdfThumbnail.js';
import { PdfTable, type PdfTableColumn } from '../../../lib/pdf/core/PdfTable.js';
import type { StyleDetailFactoryRow, StyleDetailPdfViewModel } from './buildStyleDetailViewModel.js';

const styles = StyleSheet.create({
  imageRow: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-start' },
  imageWrapper: { marginRight: 16 },
  seasonBadge: {
    fontSize: 8,
    backgroundColor: '#eef2ff',
    color: '#3730a3',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 3,
    alignSelf: 'flex-start',
  },
  sizeRow: { flexDirection: 'row', flexWrap: 'wrap' },
  sizeChip: {
    fontSize: 8,
    backgroundColor: '#f1f1f1',
    color: '#333333',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 3,
    marginRight: 6,
    marginBottom: 6,
  },
  emptyText: { fontSize: 8, color: '#777777' },
});

const factoryColumns: PdfTableColumn<StyleDetailFactoryRow>[] = [
  { key: 'name', header: 'Factory', width: '70%', value: (row) => row.name },
  {
    key: 'price',
    header: 'Ex-Factory Price',
    width: '30%',
    align: 'right',
    value: (row) => row.exFactoryPrice,
  },
];

export interface StyleDetailDocumentProps {
  viewModel: StyleDetailPdfViewModel;
}

/** Portrait by design, pure render — no HTTP, no business logic, no form chrome/obsolete multi-season data. */
export function StyleDetailDocument({ viewModel }: StyleDetailDocumentProps) {
  return (
    <PdfDocument orientation="portrait">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection generatedAt={viewModel.generatedAt} generatedBy={viewModel.generatedBy} />

      <View style={styles.imageRow}>
        <View style={styles.imageWrapper}>
          <PdfThumbnail image={viewModel.image} width={120} height={120} />
        </View>
        <Text style={styles.seasonBadge}>{viewModel.seasonLabel}</Text>
      </View>

      <PdfSection title="Style Details">
        <PdfKeyValueSection items={viewModel.identityItems} columns={3} />
      </PdfSection>

      <PdfSection title="Valid Sizes">
        <View style={styles.sizeRow}>
          {viewModel.sizeLabels.length === 0 ? (
            <Text style={styles.emptyText}>—</Text>
          ) : (
            viewModel.sizeLabels.map((label) => (
              <Text key={label} style={styles.sizeChip}>
                {label}
              </Text>
            ))
          )}
        </View>
      </PdfSection>

      {viewModel.factoryRows.length > 0 ? (
        <PdfSection title="Factory Mappings">
          <PdfTable columns={factoryColumns} rows={viewModel.factoryRows} rowKey={(row) => row.id} />
        </PdfSection>
      ) : null}

      <PdfFooter />
    </PdfDocument>
  );
}
