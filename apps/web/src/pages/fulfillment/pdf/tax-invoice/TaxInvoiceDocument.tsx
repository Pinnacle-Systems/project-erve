import { Image, StyleSheet, Text, View } from '@react-pdf/renderer';
import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfThumbnail } from '../../../../lib/pdf/core/PdfThumbnail.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import type { TaxInvoicePdfGroup, TaxInvoicePdfViewModel } from './buildTaxInvoiceViewModel.js';

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: 18,
    left: 28,
    right: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1 solid #999999',
    paddingBottom: 8,
  },
  logo: { width: 120, height: 28, objectFit: 'contain' },
  title: { fontSize: 14, fontWeight: 700, textAlign: 'right' },
  identity: { fontSize: 9, textAlign: 'right', marginTop: 3 },
  references: { fontSize: 8, lineHeight: 1.2, marginBottom: 6 },
  referenceRow: { flexDirection: 'row', marginBottom: 2 },
  referenceCell: { width: '50%', paddingRight: 8 },
  bold: { fontWeight: 700 },
  parties: { flexDirection: 'row', borderWidth: 0.5, borderColor: '#999999', marginBottom: 6 },
  party: { width: '50%', padding: 6, fontSize: 8, lineHeight: 1.2 },
  partyTitle: { fontWeight: 700, fontSize: 9, marginBottom: 3 },
  image: { width: 28, height: 28, objectFit: 'contain' },
  continuation: { fontSize: 7, color: '#666666' },
  totals: { flexDirection: 'row', marginTop: 6, borderTop: '0.5 solid #999999', paddingTop: 4 },
  totalColumn: { width: '50%', paddingRight: 8 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    paddingVertical: 1,
    gap: 5,
  },
  payable: { fontSize: 10, fontWeight: 700 },
  words: { fontSize: 9, marginTop: 5, marginBottom: 6, lineHeight: 1.2 },
  sectionTitle: { fontSize: 9, fontWeight: 700, marginTop: 6, marginBottom: 3 },
  declarations: { flexDirection: 'row', marginTop: 6, fontSize: 8, lineHeight: 1.2 },
  declarationColumn: { width: '66%', paddingRight: 12 },
  declaration: { marginBottom: 3 },
  signature: { width: '34%', textAlign: 'right' },
  signatureLabel: { marginTop: 30 },
  bank: {
    fontSize: 8,
    lineHeight: 1.2,
    textAlign: 'center',
    borderTop: '0.5 solid #999999',
    paddingTop: 5,
    marginTop: 6,
  },
  unavailable: { fontSize: 8, color: '#555555', marginTop: 4 },
});

interface DisplayRow extends TaxInvoicePdfGroup {
  descriptionPart: string;
  sizesPart: string;
  continuation: boolean;
}
function textParts(text: string, limit: number): string[] {
  const characters = Array.from(text);
  return characters.length === 0
    ? ['']
    : Array.from({ length: Math.ceil(characters.length / limit) }, (_, index) =>
        characters.slice(index * limit, (index + 1) * limit).join(''),
      );
}
/** Bound row height without losing issued descriptions/sizes or duplicating financial amounts. */
export function taxInvoiceDisplayRows(groups: TaxInvoicePdfGroup[]): DisplayRow[] {
  return groups.flatMap((group) => {
    const description = [
      group.styleName,
      group.description === group.styleName ? null : group.description,
    ]
      .filter(Boolean)
      .join('\n');
    const descriptions = textParts(description, 160);
    const sizes = textParts(group.sizes, 80);
    return Array.from({ length: Math.max(descriptions.length, sizes.length) }, (_, index) => ({
      ...group,
      id: `${group.id}:${index}`,
      descriptionPart: descriptions[index] ?? '',
      sizesPart: sizes[index] ?? '',
      continuation: index > 0,
    }));
  });
}
const lineColumns: PdfTableColumn<DisplayRow>[] = [
  {
    key: 'style',
    header: 'Style',
    width: '9%',
    render: (row) => (
      <View>
        <Text style={{ fontSize: 7 }}>{textParts(row.styleNumber, 6).join('\n')}</Text>
        {row.continuation && <Text style={styles.continuation}>continued</Text>}
      </View>
    ),
  },
  { key: 'description', header: 'Description', width: '21%', value: (row) => row.descriptionPart },
  { key: 'colour', header: 'Colour', width: '7%', value: (row) => row.colour },
  {
    key: 'image',
    header: 'Image',
    width: '7%',
    render: (row) =>
      row.continuation ? null : 'dataUri' in row.image ? (
        <Image src={row.image.dataUri} style={styles.image} />
      ) : (
        <View>
          <PdfThumbnail image={{ placeholder: true }} width={28} height={18} />
          <Text style={styles.continuation}>Missing</Text>
        </View>
      ),
  },
  { key: 'sizes', header: 'Size : Qty', width: '12%', value: (row) => row.sizesPart },
  {
    key: 'hsn',
    header: 'HSN / GST',
    width: '9%',
    value: (row) =>
      `${row.hsnCode}\n${row.gstPercent === 'Unavailable' ? 'Unavailable' : `${row.gstPercent}%`}`,
  },
  {
    key: 'mrp',
    header: 'MRP (INR)',
    width: '8%',
    align: 'right',
    value: (row) => (row.continuation ? '' : row.mrp),
  },
  {
    key: 'qty',
    header: 'Qty',
    width: '5%',
    align: 'right',
    value: (row) => (row.continuation ? '' : row.quantity),
  },
  {
    key: 'rate',
    header: 'Rate (INR)',
    width: '10%',
    align: 'right',
    value: (row) => (row.continuation ? '' : row.rate),
  },
  {
    key: 'amount',
    header: 'Taxable (INR)',
    width: '12%',
    align: 'right',
    value: (row) => (row.continuation ? '' : row.taxable),
  },
];
const hsnColumns: PdfTableColumn<NonNullable<TaxInvoicePdfViewModel['hsnSummary']>[number]>[] = [
  { key: 'hsn', header: 'HSN / SAC', width: '16%', value: (row) => row.hsnCode },
  { key: 'gst', header: 'GST', width: '8%', align: 'right', value: (row) => row.gstPercent },
  { key: 'taxable', header: 'Taxable', width: '16%', align: 'right', value: (row) => row.taxable },
  { key: 'cgst', header: 'CGST', width: '15%', align: 'right', value: (row) => row.cgst },
  { key: 'sgst', header: 'SGST', width: '15%', align: 'right', value: (row) => row.sgst },
  { key: 'igst', header: 'IGST', width: '15%', align: 'right', value: (row) => row.igst },
  { key: 'total', header: 'Total GST', width: '15%', align: 'right', value: (row) => row.totalGst },
];
function TotalRow({
  label,
  value,
  payable = false,
}: {
  label: string;
  value: string;
  payable?: boolean;
}) {
  return (
    <View style={styles.totalRow}>
      <Text style={payable ? styles.bold : undefined}>{label}</Text>
      <Text style={payable ? styles.payable : undefined}>{value}</Text>
    </View>
  );
}
export function TaxInvoiceDocument({
  viewModel: model,
  logoSrc = '/erve-logo.png',
}: {
  viewModel: TaxInvoicePdfViewModel;
  logoSrc?: string | null;
}) {
  return (
    <PdfDocument orientation="portrait">
      <View style={styles.header} fixed>
        {logoSrc ? (
          <Image src={logoSrc} style={styles.logo} />
        ) : (
          <Text style={styles.bold}>ERVE INDIA</Text>
        )}
        <View>
          <Text style={styles.title}>Tax Invoice</Text>
          <Text style={styles.identity}>
            {model.invoiceNumber} | {model.invoiceDate}
          </Text>
        </View>
      </View>
      <View style={styles.references}>
        <View style={styles.referenceRow}>
          <Text style={styles.referenceCell}>
            Dispatch Orders: {model.references.dispatchOrders.join(', ') || 'Unavailable'}
          </Text>
          <Text style={styles.referenceCell}>
            LR: {model.references.lrNumber ?? 'Not recorded'} | Place of Supply:{' '}
            {model.placeOfSupply}
          </Text>
        </View>
        {model.references.historicalEiso !== null && (
          <Text>Historical Buyer Order (EISO): {model.references.historicalEiso}</Text>
        )}
        <View style={styles.referenceRow}>
          <Text style={styles.referenceCell}>Source EIPL: {model.references.eipl}</Text>
          <Text style={styles.referenceCell}>
            Erve Dispatch: {model.references.erveDispatch ?? 'Not recorded'}
          </Text>
        </View>
        <View style={styles.referenceRow}>
          <Text style={styles.referenceCell}>
            E-Way Bill: Not recorded | E-Way date: Not recorded
          </Text>
          <Text style={styles.referenceCell}>
            Transport:{' '}
            {[model.references.transporter, model.references.vehicleNumber]
              .filter(Boolean)
              .join(' | ') || 'Not recorded'}
          </Text>
        </View>
      </View>
      <View style={styles.parties}>
        <View style={styles.party}>
          <Text style={styles.partyTitle}>Buyer (Bill-To)</Text>
          <Text style={styles.bold}>{model.billToName}</Text>
          <Text>{model.billToAddress}</Text>
          <Text>GSTIN: {model.billToGstin}</Text>
        </View>
        <View style={styles.party}>
          <Text style={styles.partyTitle}>Consignee (Ship-To)</Text>
          <Text style={styles.bold}>{model.shipToName}</Text>
          <Text>{model.shipToAddress}</Text>
        </View>
      </View>
      {model.legacyPresentation && (
        <Text style={styles.unavailable}>
          Issued Style, image and order details are unavailable for this legacy invoice.
        </Text>
      )}
      <PdfTable
        columns={lineColumns}
        rows={taxInvoiceDisplayRows(model.groups)}
        rowKey={(row) => row.id}
      />
      <View style={styles.totals} wrap={false}>
        <View style={styles.totalColumn}>
          <TotalRow label="Taxable value" value={model.totals.taxable} />
          <TotalRow label="CGST" value={model.totals.cgst} />
          <TotalRow label="SGST" value={model.totals.sgst} />
          <TotalRow label="IGST" value={model.totals.igst} />
          <TotalRow label="Total GST" value={model.totals.gst} />
        </View>
        <View style={styles.totalColumn}>
          <TotalRow
            label={
              model.totals.totalLabel === 'Original issued total'
                ? 'Grand total'
                : 'Grand total (before round-off)'
            }
            value={model.totals.grandTotal}
          />
          <TotalRow
            label="Round-off adjustment"
            value={model.totals.roundOffAdjustment ?? 'Unavailable'}
          />
          <TotalRow label={model.totals.totalLabel} value={model.totals.payable} payable />
          <TotalRow label="Total physical quantity" value={`${model.totalQuantity} pcs`} />
        </View>
      </View>
      <Text style={styles.words}>Amount chargeable (in words): {model.totals.amountWords}</Text>
      <Text style={styles.sectionTitle}>HSN-wise tax summary (INR)</Text>
      {model.hsnSummary ? (
        <PdfTable columns={hsnColumns} rows={model.hsnSummary} rowKey={(row) => row.id} />
      ) : (
        <Text style={styles.unavailable}>Issued HSN summary unavailable.</Text>
      )}
      <View style={styles.declarations} wrap={false}>
        <View style={styles.declarationColumn}>
          <Text style={styles.bold}>Declarations</Text>
          <Text style={styles.declaration}>
            1) We declare that this invoice shows the actual price of the goods described and that
            all particulars are true and correct.
          </Text>
          <Text style={styles.declaration}>2) {model.eInvoiceDeclaration}</Text>
          <Text>
            3) Whether GST is payable under RCM: <Text style={styles.bold}>No</Text>
          </Text>
        </View>
        <View style={styles.signature}>
          <Text style={styles.bold}>For {model.sellerName}</Text>
          <Text style={styles.signatureLabel}>Authorised Signatory</Text>
        </View>
      </View>
      <View style={styles.bank} wrap={false}>
        <Text style={styles.bold}>{model.sellerName}</Text>
        <Text>
          {model.sellerAddress} | GSTIN: {model.sellerGstin}
        </Text>
        <Text>{model.bankDetails}</Text>
        <Text>This is a system-generated invoice.</Text>
      </View>
      <PdfFooter />
    </PdfDocument>
  );
}
