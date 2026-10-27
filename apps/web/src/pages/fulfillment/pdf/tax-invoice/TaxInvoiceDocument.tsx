import { taxInvoiceGstComponents } from '../../tax-invoice-gst-presentation.js';
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
    height: 46,
  },
  logo: { width: 120, height: 28, objectFit: 'contain' },
  title: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    fontSize: 14,
    fontWeight: 700,
    textAlign: 'center',
  },
  identity: { position: 'absolute', left: 140, right: 0, top: 24, fontSize: 8, textAlign: 'right' },
  references: { fontSize: 8, lineHeight: 1.2, marginBottom: 6 },
  referenceRow: { flexDirection: 'row', marginBottom: 2 },
  referenceCell: { width: '50%', paddingRight: 8 },
  bold: { fontWeight: 700 },
  parties: { flexDirection: 'row', borderWidth: 0.5, borderColor: '#999999', marginBottom: 6 },
  party: { width: '50%', padding: 6, fontSize: 8, lineHeight: 1.2 },
  partyTitle: { fontWeight: 700, fontSize: 9, marginBottom: 3 },
  image: { width: 26, height: 26, objectFit: 'contain' },
  imageCaption: { fontSize: 7, color: '#666666' },
  group: { borderBottom: '0.5 solid #999999' },
  financialSummary: { flexDirection: 'row', paddingVertical: 2 },
  columnHeading: { fontSize: 7, fontWeight: 700, textAlign: 'right', paddingHorizontal: 3 },
  tableHeading: {
    flexDirection: 'row',
    backgroundColor: '#eeeeee',
    paddingVertical: 4,
    borderBottom: '0.5 solid #999999',
  },
  styleIdentity: { width: '18%', paddingHorizontal: 3 },
  colour: { fontSize: 7, lineHeight: 1.2 },
  financialValue: { fontSize: 8, textAlign: 'right' },
  styleCode: { fontSize: 8, fontWeight: 700, lineHeight: 1.2 },
  groupDetails: { paddingHorizontal: 3, paddingTop: 2, paddingBottom: 3 },
  groupName: { fontSize: 8, fontWeight: 700, lineHeight: 1.2 },
  detailText: { fontSize: 8, lineHeight: 1.2 },
  sizeList: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
  sizeToken: { maxWidth: '100%', marginRight: 6 },
  totals: { alignItems: 'flex-end', marginTop: 6, borderTop: '0.5 solid #999999', paddingTop: 4 },
  totalColumn: { width: '50%', paddingRight: 8 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    paddingVertical: 0,
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
  eoe: { fontSize: 8, textAlign: 'left', marginTop: 6 },
  cancelledWatermark: {
    position: 'absolute',
    top: 260,
    left: 40,
    right: 40,
    textAlign: 'center',
    fontSize: 54,
    fontWeight: 700,
    color: '#E11D48',
    opacity: 0.16,
  },
  cancelledBanner: {
    borderWidth: 1,
    borderColor: '#E11D48',
    backgroundColor: '#FFF1F2',
    padding: 6,
    marginBottom: 6,
  },
  cancelledBannerTitle: {
    color: '#9F1239',
    fontSize: 9,
    fontWeight: 700,
  },
  cancelledBannerDetails: {
    color: '#BE123C',
    fontSize: 8,
    marginTop: 2,
  },
});

/** Recover complete display tokens, retaining the original string if a label is ambiguous. */
function sizeTokens(sizes: string): string[] {
  const tokens = sizes
    .match(/(?:^|, )[\s\S]*?(?:: \d+|-\d+)(?=, |$)/g)
    ?.map((token) => token.replace(/^, /, ''));
  return tokens?.join(', ') === sizes ? tokens : [sizes];
}

const financialColumns = [
  { label: 'S.No.', width: '5%', left: true },
  { label: 'Image', width: '7%', left: true },
  { label: 'Style', width: '18%', left: true },
  { label: 'Size : Qty', width: '24%', left: true },
  { label: 'Qty', width: '5%' },
  { label: 'HSN / GST', width: '11%' },
  { label: 'MRP (INR)', width: '9%' },
  { label: 'Rate (INR)', width: '9%' },
  { label: 'Taxable (INR)', width: '12%' },
];
function FinancialCell({ value, width }: { value: string | number; width: string }) {
  return (
    <View style={{ width, paddingHorizontal: 3 }}>
      <Text style={styles.financialValue}>{value}</Text>
    </View>
  );
}
function Sizes({ tokens }: { tokens: string[] }) {
  return (
    <View style={styles.sizeList}>
      {tokens.map((token, index) => (
        <View key={index} style={styles.sizeToken} wrap={false}>
          <Text style={styles.detailText}>
            {token}
            {index < tokens.length - 1 ? ',' : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Ordinary Styles are complete table rows. Oversized identity/colour/Sizes flow below once. */
function InvoiceGroup({
  group,
  last,
  serial,
}: {
  group: TaxInvoicePdfGroup;
  last: boolean;
  serial: number;
}) {
  const tokens = sizeTokens(group.sizes);
  // Layout selection never slices or changes the issued identity or quantities.
  const flowingIdentity =
    group.styleNumber.length + group.styleName.length > 180 ||
    /[\r\n]/.test(group.styleNumber + group.styleName);
  const flowingDetails =
    flowingIdentity ||
    /[\r\n]/.test(group.colour + group.sizes) ||
    group.colour.length > 80 ||
    tokens.length > 12 ||
    tokens.some((token) => token.length > 60);
  return (
    <>
      <View
        style={[styles.financialSummary, ...(flowingDetails ? [] : [styles.group])]}
        wrap={false}
        minPresenceAhead={last ? 180 : 24}
      >
        <View style={{ width: '5%', paddingHorizontal: 3 }}>
          <Text style={styles.detailText}>{serial}</Text>
        </View>
        <View style={{ width: '7%', paddingHorizontal: 3, alignItems: 'center' }}>
          {'dataUri' in group.image ? (
            <Image src={group.image.dataUri} style={styles.image} />
          ) : (
            <View>
              <PdfThumbnail image={{ placeholder: true }} width={26} height={19} />
              <Text style={styles.imageCaption}>Missing</Text>
            </View>
          )}
        </View>
        <View style={styles.styleIdentity}>
          {flowingIdentity ? (
            <Text style={styles.groupName}>Style details below</Text>
          ) : (
            <>
              <Text style={styles.styleCode}>{group.styleNumber}</Text>
              {group.styleName && <Text style={styles.groupName}>{group.styleName}</Text>}
            </>
          )}
          {!flowingDetails && <Text style={styles.colour}>Colour: {group.colour}</Text>}
        </View>
        <View style={{ width: '24%', paddingHorizontal: 3 }}>
          {flowingDetails ? (
            <Text style={styles.colour}>Size details below</Text>
          ) : (
            <Sizes tokens={tokens} />
          )}
        </View>
        <FinancialCell value={group.quantity} width="5%" />
        <FinancialCell
          value={`${group.hsnCode} / ${group.gstPercent}${group.gstPercent === 'Unavailable' ? '' : '%'}`}
          width="11%"
        />
        <FinancialCell value={group.mrp} width="9%" />
        <FinancialCell value={group.rate} width="9%" />
        <FinancialCell value={group.taxable} width="12%" />
      </View>
      {flowingDetails && (
        <View style={[styles.groupDetails, styles.group]}>
          {flowingIdentity && (
            <>
              <Text style={styles.styleCode} orphans={2} widows={2}>
                {group.styleNumber}
              </Text>
              <Text style={styles.groupName} orphans={2} widows={2}>
                {group.styleName}
              </Text>
            </>
          )}
          <Text style={styles.detailText} orphans={2} widows={2}>
            Colour: {group.colour}
          </Text>
          <Sizes tokens={tokens} />
        </View>
      )}
    </>
  );
}
function hsnColumns(
  treatment: TaxInvoicePdfViewModel['gstTreatment'],
): PdfTableColumn<NonNullable<TaxInvoicePdfViewModel['hsnSummary']>[number]>[] {
  const components = taxInvoiceGstComponents(treatment);
  return [
    { key: 'hsn', header: 'HSN / SAC', width: '18%', value: (row) => row.hsnCode },
    { key: 'gst', header: 'GST', width: '10%', align: 'right', value: (row) => row.gstPercent },
    {
      key: 'taxable',
      header: 'Taxable',
      width: '22%',
      align: 'right',
      value: (row) => row.taxable,
    },
    ...components.map((component) => ({
      key: component.key,
      header: component.label,
      width: `${30 / components.length}%`,
      align: 'right' as const,
      value: (row: NonNullable<TaxInvoicePdfViewModel['hsnSummary']>[number]) => row[component.key],
    })),
    {
      key: 'total',
      header: 'Total GST',
      width: '20%',
      align: 'right',
      value: (row) => row.totalGst,
    },
  ];
}
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
  const components = taxInvoiceGstComponents(model.gstTreatment);
  return (
    <PdfDocument orientation="portrait">
      {model.isCancelled && (
        <Text style={styles.cancelledWatermark} fixed>
          CANCELLED
        </Text>
      )}
      <View style={styles.header} fixed>
        {logoSrc ? (
          <Image src={logoSrc} style={styles.logo} />
        ) : (
          <Text style={styles.bold}>ERVE INDIA</Text>
        )}
        <Text style={styles.title}>Tax Invoice</Text>
        <Text style={styles.identity}>
          {model.invoiceNumber} | {model.invoiceDate}
        </Text>
      </View>
      {model.isCancelled && (
        <View style={styles.cancelledBanner}>
          <Text style={styles.cancelledBannerTitle}>THIS TAX INVOICE HAS BEEN CANCELLED</Text>
          <Text style={styles.cancelledBannerDetails}>
            {model.cancelledAt ? `Cancelled date: ${model.cancelledAt}` : 'Cancelled'}
            {model.cancellationReason ? ` · Reason: ${model.cancellationReason}` : ''}
          </Text>
        </View>
      )}
      <View style={styles.references}>
        {model.references.replacesInvoiceNumber !== null && (
          <View style={styles.referenceRow}>
            <Text style={[styles.referenceCell, styles.bold]}>
              Replaces Cancelled Invoice: {model.references.replacesInvoiceNumber}
            </Text>
          </View>
        )}
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
      <View>
        <View style={styles.tableHeading} fixed minPresenceAhead={64}>
          {financialColumns.map((column) => (
            <Text
              key={column.label}
              style={[
                styles.columnHeading,
                { width: column.width, textAlign: column.left ? 'left' : 'right' },
              ]}
            >
              {column.label}
            </Text>
          ))}
        </View>
        {model.groups.map((group, index) => (
          <InvoiceGroup
            key={group.id}
            group={group}
            serial={index + 1}
            last={index === model.groups.length - 1}
          />
        ))}
        <View style={styles.totals} wrap={false} minPresenceAhead={90}>
          <View style={styles.totalColumn}>
            <TotalRow label="Taxable value" value={model.totals.taxable} />
            {components.length ? (
              components.map((component) => (
                <TotalRow
                  key={component.key}
                  label={component.label}
                  value={model.totals[component.key]}
                />
              ))
            ) : (
              <TotalRow label="Tax components" value="Unavailable: GST treatment is unresolved" />
            )}
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
      </View>
      <Text style={styles.sectionTitle} minPresenceAhead={26}>
        HSN-wise tax summary (INR)
      </Text>
      {!components.length ? (
        <Text style={styles.unavailable}>
          HSN tax summary unavailable: GST treatment is unresolved.
        </Text>
      ) : model.hsnSummary ? (
        <PdfTable
          columns={hsnColumns(model.gstTreatment)}
          rows={model.hsnSummary}
          rowKey={(row) => row.id}
        />
      ) : (
        <Text style={styles.unavailable}>Issued HSN summary unavailable.</Text>
      )}
      <Text style={styles.eoe}>E.&amp;O.E.</Text>
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
        <Text>No signature required</Text>
      </View>
      <PdfFooter />
    </PdfDocument>
  );
}
