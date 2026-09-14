import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { PdfSection } from '../../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import { PdfThumbnail } from '../../../../lib/pdf/core/PdfThumbnail.js';
import { formatPdfValue } from '../../../../lib/pdf/format.js';
import type { QualityPdfBlock, QualityPdfSection } from './qualityResponseBlocks.js';

const styles = StyleSheet.create({
  description: { fontSize: 8, color: '#777777', marginBottom: 6 },
  emptyText: { fontSize: 8, color: '#777777' },
  checklistHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#eeeeee',
    borderBottom: '1 solid #333333',
    paddingVertical: 4,
  },
  checklistHeaderCell: { fontSize: 8, fontWeight: 700, color: '#333333', paddingHorizontal: 4 },
  checklistRow: {
    flexDirection: 'row',
    borderBottom: '0.5 solid #dddddd',
    paddingVertical: 4,
  },
  checklistCell: { fontSize: 8, color: '#111111', paddingHorizontal: 4 },
  textValue: { fontSize: 9, color: '#111111' },
  requirementBlock: { marginBottom: 10 },
  requirementLabel: { fontSize: 9, fontWeight: 700, color: '#333333', marginBottom: 4 },
  evidenceRow: { flexDirection: 'row', flexWrap: 'wrap' },
  evidenceItem: { width: 100, marginRight: 10, marginBottom: 10 },
  evidenceFileName: { fontSize: 7, color: '#333333', marginTop: 3 },
  evidenceMeta: { fontSize: 7, color: '#888888' },
  nonImageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottom: '0.5 solid #dddddd',
    paddingVertical: 3,
  },
  nonImageCell: { fontSize: 8, color: '#111111' },
});

function ChecklistBlockView({ rows: checklistRows }: { rows: Array<{ label: string; result: string; remarks?: string | null }> }) {
  if (checklistRows.length === 0) return <Text style={styles.emptyText}>No items configured.</Text>;
  return (
    <View>
      <View style={styles.checklistHeaderRow} fixed>
        <Text style={[styles.checklistHeaderCell, { width: '55%' }]}>Item</Text>
        <Text style={[styles.checklistHeaderCell, { width: '20%' }]}>Result</Text>
        <Text style={[styles.checklistHeaderCell, { width: '25%' }]}>Remarks</Text>
      </View>
      {checklistRows.map((row, index) => (
        <View key={`${row.label}-${index}`} style={styles.checklistRow} wrap={false}>
          <Text style={[styles.checklistCell, { width: '55%' }]}>{row.label}</Text>
          <Text style={[styles.checklistCell, { width: '20%' }]}>{formatPdfValue(row.result)}</Text>
          <Text style={[styles.checklistCell, { width: '25%' }]}>{formatPdfValue(row.remarks)}</Text>
        </View>
      ))}
    </View>
  );
}

function TableBlockView({
  columns,
  rows: tableRows,
  emptyText,
}: {
  columns: Extract<QualityPdfBlock, { kind: 'table' }>['columns'];
  rows: Array<Record<string, string>>;
  emptyText: string;
}) {
  if (tableRows.length === 0) return <Text style={styles.emptyText}>{emptyText}</Text>;
  const pdfColumns: PdfTableColumn<Record<string, string>>[] = columns.map((column) => ({
    key: column.key,
    header: column.header,
    width: column.width,
    align: column.align,
    value: (row) => row[column.key],
  }));
  return (
    <PdfTable columns={pdfColumns} rows={tableRows} rowKey={(row) => String(tableRows.indexOf(row))} />
  );
}

function AttachmentsBlockView({
  requirements,
}: {
  requirements: Extract<QualityPdfBlock, { kind: 'attachments' }>['requirements'];
}) {
  return (
    <View>
      {requirements.map((requirement) => (
        <View key={requirement.label} style={styles.requirementBlock} wrap={false}>
          <Text style={styles.requirementLabel}>
            {requirement.label}
            {requirement.required ? ' (Required)' : ''}
          </Text>
          {requirement.items.length === 0 ? (
            <Text style={styles.emptyText}>No evidence uploaded.</Text>
          ) : (
            <View style={styles.evidenceRow}>
              {requirement.items.map((item) =>
                item.isImage ? (
                  <View key={item.id} style={styles.evidenceItem}>
                    <PdfThumbnail image={item.image} width={100} height={100} />
                    <Text style={styles.evidenceFileName}>{item.fileName}</Text>
                  </View>
                ) : (
                  <View key={item.id} style={[styles.nonImageRow, { width: '100%' }]}>
                    <Text style={styles.nonImageCell}>{item.fileName}</Text>
                    <Text style={styles.nonImageCell}>{item.contentType}</Text>
                  </View>
                ),
              )}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function BlockView({ block }: { block: QualityPdfBlock }) {
  return (
    <PdfSection title={block.heading} wrap>
      {block.description ? <Text style={styles.description}>{block.description}</Text> : null}
      {block.kind === 'grid' ? <PdfKeyValueSection items={block.items} columns={3} /> : null}
      {block.kind === 'checklist' ? <ChecklistBlockView rows={block.rows} /> : null}
      {block.kind === 'table' ? (
        <TableBlockView columns={block.columns} rows={block.rows} emptyText={block.emptyText} />
      ) : null}
      {block.kind === 'text' ? <Text style={styles.textValue}>{block.value}</Text> : null}
      {block.kind === 'attachments' ? <AttachmentsBlockView requirements={block.requirements} /> : null}
    </PdfSection>
  );
}

export interface QualityBlocksRendererProps {
  sections: QualityPdfSection[];
}

/** Renders every generic QA form section/component as pure PDF content — no fetch, no business logic. */
export function QualityBlocksRenderer({ sections }: QualityBlocksRendererProps) {
  return (
    <>
      {sections.map((section) => (
        <PdfSection key={section.id} title={section.title} wrap>
          {section.description ? <Text style={styles.description}>{section.description}</Text> : null}
          {section.blocks.map((block, index) => (
            <BlockView key={`${section.id}-${index}`} block={block} />
          ))}
        </PdfSection>
      ))}
    </>
  );
}
