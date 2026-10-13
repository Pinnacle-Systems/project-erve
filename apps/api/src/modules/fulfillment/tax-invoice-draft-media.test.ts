import { beforeEach, expect, it, vi } from 'vitest';
import { readDraftInvoiceImage } from './tax-invoice-draft-media.service.js';
const db = vi.hoisted(() => ({
  invoice: vi.fn(),
  primary: vi.fn(),
  locks: vi.fn(),
  content: vi.fn(),
}));
vi.mock('../../db/prisma.js', () => ({
  prisma: {
    $transaction: async (read: (tx: unknown) => unknown) =>
      read({
        taxInvoice: { findUnique: db.invoice },
        styleImage: { findFirst: db.primary },
        $executeRaw: db.locks,
        $queryRaw: db.locks,
      }),
  },
}));
vi.mock('../../storage/index.js', () => ({
  getFileStorage: () => ({ read: db.content }),
  FileNotFoundInStorageError: class extends Error {},
}));
const actor = {
  id: 'acct',
  email: 'test@erve.test',
  name: 'Accountant',
  roles: ['ACCOUNTANT' as const],
  mobile: null,
  status: 'ACTIVE' as const,
  authVersion: 1,
  distributorIds: [],
  factoryIds: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  db.invoice.mockResolvedValue({ status: 'DRAFT', lines: [{ styleId: 'style-1' }] });
  db.primary.mockResolvedValue({
    id: 'primary-1',
    file: { storageKey: 'style-images/private-path.png', mimeType: 'image/png' },
  });
  db.content.mockResolvedValue(Buffer.from('image'));
});
it('returns current primary content only after invoice membership and status checks', async () => {
  expect(await readDraftInvoiceImage(actor, 'inv-1', 'style-1', 'primary-1')).toMatchObject({
    data: Buffer.from('image'),
  });
  expect(db.invoice).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'inv-1' } }));
  expect(db.primary).toHaveBeenCalledWith(
    expect.objectContaining({ where: { styleId: 'style-1' } }),
  );
  expect(db.content).toHaveBeenCalledWith('style-images/private-path.png');
});
it('uses an opaque content validator without exposing a storage key', async () => {
  db.content.mockResolvedValue(Buffer.from('image'));
  expect((await readDraftInvoiceImage(actor, 'inv-1', 'style-1', 'primary-1')).etag).toMatch(
    /^"[a-f0-9]{64}"$/,
  );
});
it.each([
  null,
  { status: 'FINALIZED', lines: [{ styleId: 'style-1' }] },
  { status: 'DRAFT', lines: [{ styleId: 'another-style' }] },
])('denies missing, finalized and unrelated invoice images', async (invoice) => {
  db.invoice.mockResolvedValue(invoice);
  await expect(readDraftInvoiceImage(actor, 'inv-1', 'style-1', 'primary-1')).rejects.toMatchObject(
    { statusCode: 404 },
  );
  expect(db.content).not.toHaveBeenCalled();
});
it('denies a stale or non-primary image', async () => {
  db.primary.mockResolvedValue({ id: 'replacement' });
  await expect(readDraftInvoiceImage(actor, 'inv-1', 'style-1', 'primary-1')).rejects.toMatchObject(
    { statusCode: 404 },
  );
  expect(db.content).not.toHaveBeenCalled();
});
it('denies roles without invoice visibility before accessing data', async () => {
  await expect(
    readDraftInvoiceImage({ ...actor, roles: ['MERCHANDISER'] }, 'inv-1', 'style-1', 'primary-1'),
  ).rejects.toMatchObject({ statusCode: 403 });
  expect(db.invoice).not.toHaveBeenCalled();
});
