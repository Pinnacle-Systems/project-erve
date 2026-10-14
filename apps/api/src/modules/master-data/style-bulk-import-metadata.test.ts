import { beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createId } from '@erve/shared';
import { prisma } from '../../db/prisma.js';
import { createTestSeason, createTestUser, resetDatabase } from '../../test/helpers.js';
import { currentUserSelect, toCurrentUser } from '../../auth/current-user.js';
import {
  executeBulkStyleImport,
  parseBulkStyleImportSheet,
  planBulkStyleImport,
} from './style-bulk-import.service.js';

const metadata = {
  'IP Name': 'Engineering IP',
  Licensor: 'Engineering Licensor',
  Colour: 'Blue',
  Description: 'Source description\nwith a second line',
  Category: 'Engineering Category',
};
function workbook(fields: Record<string, string> = metadata) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.json_to_sheet([
      {
        'Style Number': 'PR8-METADATA-001',
        'Style Name': 'Engineering Style',
        'Final MRP': '100',
        'Season Code': 'AW25',
        'Size Codes': 'S',
        Barcodes: 'PR8-METADATA-BARCODE',
        ...fields,
      },
    ]),
    'Styles',
  );
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
async function actor() {
  await createTestSeason({ code: 'AW25' });
  await prisma.size.create({
    data: { id: createId(), code: 'S', label: 'S', sizeType: 'ALPHA', sortOrder: 1 },
  });
  const id = await createTestUser({
    email: 'pr8-metadata@test.local',
    password: 'password123',
    roles: ['ADMIN'],
  });
  return toCurrentUser(
    await prisma.user.findUniqueOrThrow({ where: { id }, select: currentUserSelect }),
  );
}
beforeEach(resetDatabase);
describe('Style import preserves supplied descriptive master values', () => {
  it('parses canonical IP, Licensor, Colour, Description and Category columns', () => {
    expect(parseBulkStyleImportSheet(workbook(), 'Styles')[0]).toMatchObject({
      ipName: metadata['IP Name'],
      licensor: metadata.Licensor,
      colour: metadata.Colour,
      description: metadata.Description,
      categoryDescription: metadata.Category,
    });
  });
  it('persists metadata and exactly reruns without allocating another Style', async () => {
    const user = await actor(),
      bytes = workbook();
    const result = await executeBulkStyleImport(
      user,
      await planBulkStyleImport(bytes, 'Styles'),
      'metadata.xlsx',
    );
    expect(result.results[0]?.outcome).toBe('COMPLETED');
    const stored = await prisma.style.findUniqueOrThrow({
      where: { styleNumber: 'PR8-METADATA-001' },
    });
    expect(stored).toMatchObject({
      ipName: metadata['IP Name'],
      licensor: metadata.Licensor,
      colour: metadata.Colour,
      description: metadata.Description,
      categoryDescription: metadata.Category,
    });
    expect((await planBulkStyleImport(bytes, 'Styles')).rows[0]?.status).toBe('SKIP_EXISTING');
    await executeBulkStyleImport(user, await planBulkStyleImport(bytes, 'Styles'), 'metadata.xlsx');
    expect(await prisma.style.count()).toBe(1);
    expect(await prisma.styleSize.count()).toBe(1);
    expect((await prisma.style.findUniqueOrThrow({ where: { id: stored.id } })).updatedAt).toEqual(
      stored.updatedAt,
    );
  });
  it.each(['IP Name', 'Licensor', 'Colour', 'Description', 'Category'])(
    'holds conflicting %s values for review without overwriting',
    async (field) => {
      const user = await actor();
      await executeBulkStyleImport(
        user,
        await planBulkStyleImport(workbook(), 'Styles'),
        'metadata.xlsx',
      );
      const stored = await prisma.style.findUniqueOrThrow({
        where: { styleNumber: 'PR8-METADATA-001' },
      });
      const changed = await planBulkStyleImport(
        workbook({ ...metadata, [field]: 'Changed source value' }),
        'Styles',
      );
      expect(changed.rows[0]).toMatchObject({
        status: 'REJECTED',
        reason: 'EXISTING_STYLE_CONFLICT',
      });
      await executeBulkStyleImport(user, changed, 'changed.xlsx');
      expect(await prisma.style.findUniqueOrThrow({ where: { id: stored.id } })).toEqual(stored);
    },
  );
  it('preserves existing metadata when optional columns were not supplied', async () => {
    const user = await actor();
    await executeBulkStyleImport(
      user,
      await planBulkStyleImport(workbook(), 'Styles'),
      'metadata.xlsx',
    );
    expect((await planBulkStyleImport(workbook({}), 'Styles')).rows[0]?.status).toBe(
      'SKIP_EXISTING',
    );
  });
  it('rechecks metadata drift between preview and execution', async () => {
    const user = await actor(),
      bytes = workbook();
    await executeBulkStyleImport(user, await planBulkStyleImport(bytes, 'Styles'), 'metadata.xlsx');
    const plan = await planBulkStyleImport(bytes, 'Styles');
    await prisma.style.update({
      where: { styleNumber: 'PR8-METADATA-001' },
      data: { licensor: 'Changed after preview' },
    });
    expect((await executeBulkStyleImport(user, plan, 'metadata.xlsx')).results[0]?.outcome).toBe(
      'FAILED',
    );
    expect(
      (await prisma.style.findUniqueOrThrow({ where: { styleNumber: 'PR8-METADATA-001' } }))
        .licensor,
    ).toBe('Changed after preview');
  });
});
