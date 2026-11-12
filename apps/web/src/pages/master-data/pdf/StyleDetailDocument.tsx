import { StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { PdfDocument } from '../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../lib/pdf/core/PdfMetaSection.js';
import { PdfKeyValueSection } from '../../../lib/pdf/core/PdfKeyValueSection.js';
import { PdfThumbnail } from '../../../lib/pdf/core/PdfThumbnail.js';
import { PdfTable, type PdfTableColumn } from '../../../lib/pdf/core/PdfTable.js';
import type { StyleDetailFactoryRow, StyleDetailPdfViewModel } from './buildStyleDetailViewModel.js';

const styles = StyleSheet.create({
  // Same values as the shared PdfSection (title 10pt/700/#333, 6pt gap); its 12pt gap below a section is
  // applied above the next heading instead (`sectionTitleSpaced`), because wrapping the content in a View to
  // carry that margin makes react-pdf move the whole block to the next page, stranding the heading.
  sectionTitle: { fontSize: 10, fontWeight: 700, marginBottom: 6, color: '#333333' },
  sectionTitleSpaced: { marginTop: 12 },
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
    header: 'Ex-Factory Rate',
    width: '30%',
    align: 'right',
    value: (row) => row.exFactoryPrice,
  },
];

/**
 * Why the three sections below are not `PdfSection`s (which defaults to `wrap={false}`): their content has no
 * upper bound (free-text description, any number of Sizes, any number of Factory mappings), and react-pdf cannot
 * paginate an unbreakable block taller than a page. It squashes the page's whole flex column instead, stacking
 * the sections on top of each other and running table rows off the bottom edge. These sections must flow.
 *
 * The heading is a direct child of the Page (not nested in the section's own View) on purpose: react-pdf ignores
 * `minPresenceAhead` on the first child of a container, so inside `PdfSection` it could never keep the heading
 * with its content. As a Page child it moves to the next page unless this much space remains below it -- enough
 * for a heading plus one key/value row, one chip row, or the table header and its first row.
 */
const SECTION_MIN_PRESENCE_AHEAD = 48;

/** Key/value items up to this many characters stay whole; a longer one (a huge description) may split across pages. */
const UNBREAKABLE_ITEM_MAX_CHARS = 1000;

/**
 * The header subtitle is "<Style number> — <Style name>". Two lines hold every realistic Style name; a longer
 * one would grow past the 72pt header band and overprint the body. The full name is always in Style Details.
 */
const HEADER_SUBTITLE_MAX_LINES = 2;

function FlowingSection({
  title,
  children,
  followsSection = false,
}: {
  title: string;
  children: ReactNode;
  /** True when another section precedes this one (adds the 12pt gap PdfSection would have put below it). */
  followsSection?: boolean;
}) {
  return (
    <>
      <Text
        style={followsSection ? [styles.sectionTitle, styles.sectionTitleSpaced] : styles.sectionTitle}
        minPresenceAhead={SECTION_MIN_PRESENCE_AHEAD}
      >
        {title}
      </Text>
      {children}
    </>
  );
}

export interface StyleDetailDocumentProps {
  viewModel: StyleDetailPdfViewModel;
}

/** Portrait by design, pure render — no HTTP, no business logic, no form chrome/obsolete multi-season data. */
export function StyleDetailDocument({ viewModel }: StyleDetailDocumentProps) {
  return (
    <PdfDocument orientation="portrait">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} subtitleMaxLines={HEADER_SUBTITLE_MAX_LINES} />
      <PdfMetaSection generatedAt={viewModel.generatedAt} generatedBy={viewModel.generatedBy} />

      <View style={styles.imageRow}>
        <View style={styles.imageWrapper}>
          <PdfThumbnail image={viewModel.image} width={120} height={120} />
        </View>
        <Text style={styles.seasonBadge}>{viewModel.seasonLabel}</Text>
      </View>

      <FlowingSection title="Style Details">
        <PdfKeyValueSection
          items={viewModel.identityItems}
          columns={3}
          unbreakableItemMaxChars={UNBREAKABLE_ITEM_MAX_CHARS}
        />
      </FlowingSection>

      <FlowingSection title="Valid Sizes" followsSection>
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
      </FlowingSection>

      {viewModel.factoryRows.length > 0 ? (
        <FlowingSection title="Factory Mappings" followsSection>
          <PdfTable columns={factoryColumns} rows={viewModel.factoryRows} rowKey={(row) => row.id} />
        </FlowingSection>
      ) : null}

      <PdfFooter />
    </PdfDocument>
  );
}
