// Shared, professionally formatted "Instructions" worksheet for every
// downloadable bulk-import template (ISS-071). One field-reference table
// layout is reused by all templates so field documentation stays
// maintainable and visually consistent; only the content (module name,
// summary, usage notes and field docs) varies per template.
//
// The literal marker text below is also checked by each importer's parser
// (e.g. master-import.parser.ts) so a renamed Instructions worksheet, or its
// CSV export, is rejected as import data rather than treated as records —
// keep this string unchanged if you edit the layout.
import ExcelJS from 'exceljs';

export const MASTER_IMPORT_INSTRUCTIONS_MARKER = 'ERVE MASTER IMPORT INSTRUCTIONS - DO NOT IMPORT';

export interface ImportFieldDoc {
  name: string;
  description: string;
  required: boolean;
  dataType: string;
  example: string;
  validation: string;
  notes?: string;
}

export interface ImportInstructionsContent {
  moduleName: string;
  summary: string;
  purpose: string;
  /** Short operational notes shown above the field table (upload steps, limits, create-only behavior, etc). */
  usageNotes: string[];
  dataWorksheetName: string;
  fields: ImportFieldDoc[];
}

const TABLE_COLUMNS: Array<{ header: string; width: number }> = [
  { header: 'Field Name', width: 24 },
  { header: 'Description', width: 42 },
  { header: 'Required / Optional', width: 16 },
  { header: 'Data Type / Format', width: 26 },
  { header: 'Example Value', width: 30 },
  { header: 'Validation / Allowed Values', width: 42 },
  { header: 'Notes', width: 34 },
];
const LAST_COLUMN = TABLE_COLUMNS.length;
const HEADER_FILL = 'FF1F4E78';
const HEADER_FONT_COLOR = 'FFFFFFFF';
const SECTION_FILL = 'FFD9E2F3';
const REQUIRED_COLOR = 'FFB00020';
const OPTIONAL_COLOR = 'FF2E7D32';

function wrappedHeight(text: string, charsPerLine = 42, lineHeight = 14, minHeight = 30): number {
  const lines = text.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return Math.max(minHeight, lines * lineHeight);
}

/** Appends a styled "Instructions" worksheet to `workbook` as its second (or later) visible sheet. */
export function addInstructionsWorksheet(workbook: ExcelJS.Workbook, content: ImportInstructionsContent): void {
  const sheet = workbook.addWorksheet('Instructions');
  sheet.getColumn(1).width = TABLE_COLUMNS[0]!.width;
  for (let i = 0; i < TABLE_COLUMNS.length; i++) sheet.getColumn(i + 1).width = TABLE_COLUMNS[i]!.width;

  let r = 1;
  const title = sheet.getRow(r);
  title.getCell(1).value = MASTER_IMPORT_INSTRUCTIONS_MARKER;
  sheet.mergeCells(r, 1, r, LAST_COLUMN);
  title.getCell(1).font = { bold: true, size: 13, color: { argb: HEADER_FONT_COLOR } };
  title.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  title.getCell(1).alignment = { vertical: 'middle' };
  title.height = 24;
  r += 2;

  const paragraph = (text: string, bold = false): void => {
    const row = sheet.getRow(r);
    row.getCell(1).value = text;
    sheet.mergeCells(r, 1, r, LAST_COLUMN);
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    if (bold) row.getCell(1).font = { bold: true };
    row.height = wrappedHeight(text, 160, 14, 16);
    r += 1;
  };

  paragraph(`Module: ${content.moduleName}`, true);
  paragraph(content.summary);
  paragraph(`Purpose: ${content.purpose}`);
  paragraph(
    `Enter your records in the "${content.dataWorksheetName}" worksheet (the first worksheet in this file). ` +
      'Do not modify, reorder, rename or remove its column headers, and do not enter any data in this Instructions worksheet.',
  );
  for (const note of content.usageNotes) paragraph(note);
  r += 1;

  const heading = sheet.getRow(r);
  heading.getCell(1).value = 'Field Reference';
  sheet.mergeCells(r, 1, r, LAST_COLUMN);
  heading.getCell(1).font = { bold: true, size: 12 };
  heading.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
  heading.height = 20;
  r += 1;

  const tableHeaderRowNumber = r;
  const headerRow = sheet.getRow(r);
  TABLE_COLUMNS.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true, color: { argb: HEADER_FONT_COLOR } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { wrapText: true, vertical: 'middle' };
  });
  headerRow.height = 22;
  r += 1;

  for (const field of content.fields) {
    const row = sheet.getRow(r);
    row.getCell(1).value = field.name;
    row.getCell(2).value = field.description;
    const requiredCell = row.getCell(3);
    requiredCell.value = field.required ? 'Required' : 'Optional';
    requiredCell.font = { bold: true, color: { argb: field.required ? REQUIRED_COLOR : OPTIONAL_COLOR } };
    row.getCell(4).value = field.dataType;
    row.getCell(5).value = field.example;
    row.getCell(6).value = field.validation;
    row.getCell(7).value = field.notes ?? '';
    row.eachCell((cell) => {
      if (cell.alignment?.wrapText) return;
      cell.alignment = { wrapText: true, vertical: 'top' };
    });
    const longest = Math.max(
      field.description.length / (TABLE_COLUMNS[1]!.width - 2),
      field.validation.length / (TABLE_COLUMNS[5]!.width - 2),
      (field.notes ?? '').length / (TABLE_COLUMNS[6]!.width - 2),
    );
    row.height = Math.max(30, Math.ceil(longest) * 15 + 15);
    r += 1;
  }

  sheet.views = [{ state: 'frozen', ySplit: tableHeaderRowNumber }];

  const closing = sheet.getRow(r + 1);
  closing.getCell(1).value =
    'Example values above are illustrative only; confirm actual business values before importing. Never copy these rows into the data worksheet.';
  sheet.mergeCells(r + 1, 1, r + 1, LAST_COLUMN);
  closing.getCell(1).alignment = { wrapText: true, vertical: 'top' };
  closing.getCell(1).font = { italic: true };
  closing.height = wrappedHeight(String(closing.getCell(1).value), 160, 14, 16);
}

/** Builds the plain, unstyled data worksheet (header row only) that every template's first sheet uses. */
export function addDataWorksheet(workbook: ExcelJS.Workbook, name: string, headers: string[]): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name);
  const row = sheet.getRow(1);
  headers.forEach((header, index) => {
    row.getCell(index + 1).value = header;
  });
  sheet.columns = headers.map(() => ({ width: 24 }));
  return sheet;
}
