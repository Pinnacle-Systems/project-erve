import * as XLSX from 'xlsx';

/** Independent reconciliation against raw canonical cells, not the import parser. */
export function assertCanonicalStyleMetadata(
  snapshot: unknown,
  workbookBytes: Buffer,
  worksheet: string,
  options: { allowedSyntheticStyleNumbers?: string[] } = {},
) {
  const workbook = XLSX.read(workbookBytes, { type: 'buffer' });
  const sheet = workbook.Sheets[worksheet];
  if (!sheet) throw new Error('Canonical Style worksheet is unavailable');
  const sourceRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    raw: false,
    defval: '',
  });
  const styles = (
    snapshot as { business: { styles: Array<Record<string, unknown> & { styleNumber: string }> } }
  ).business.styles;
  const columns = {
    'IP Name': 'ipName',
    Licensor: 'licensor',
    Colour: 'colour',
    Description: 'description',
    Category: 'categoryDescription',
  };
  let valuesChecked = 0;
  let stylesChecked = 0;
  for (const style of styles) {
    const source = sourceRows.find(
      (row) => String(row['Style Number']).trim() === style.styleNumber,
    );
    if (!source) {
      if (
        options.allowedSyntheticStyleNumbers?.includes(style.styleNumber) &&
        String(style.styleName ?? style.name).startsWith('PR8 ENGINEERING ONLY')
      )
        continue;
      throw new Error('Loaded Style has no matching canonical source identity');
    }
    stylesChecked++;
    for (const [header, field] of Object.entries(columns)) {
      if (!Object.hasOwn(source, header)) continue;
      if (String(source[header] ?? '').trim() !== String(style[field] ?? '').trim())
        throw new Error(`Loaded Style metadata differs from canonical source: ${header}`);
      valuesChecked++;
    }
  }
  return { status: 'PASS', stylesChecked, valuesChecked };
}
