import { Prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';

export interface MasterCreateOptions {
  /** Runs before commit; any failure rolls back the master, code and audit. */
  onCreatedInTransaction?: (
    tx: Prisma.TransactionClient,
    created: { id: string; code: string },
  ) => Promise<void>;
}

export interface FactoryCreateOptions extends MasterCreateOptions {
  /** Internal ADMIN-only compatibility for sealed historical bundles. */
  legacyImportCode?: string;
}

type MasterCodeNamespace = 'FAC' | 'DST' | 'STR';
const tables: Record<MasterCodeNamespace, string> = {
  FAC: 'factories',
  DST: 'distributors',
  STR: 'retail_stores',
};

async function lockMasterCodeNamespace(tx: Prisma.TransactionClient, namespace: MasterCodeNamespace) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`master-code:${namespace}`}, 0))`;
}

export async function reserveLegacyFactoryCode(tx: Prisma.TransactionClient, code: string): Promise<string> {
  await lockMasterCodeNamespace(tx, 'FAC');
  if (/^FAC-[0-9]{6,}$/.test(code)) {
    const serial = BigInt(code.slice(4));
    const counter = await tx.masterCodeCounter.findUnique({ where: { namespace: 'FAC' } });
    if (!counter || counter.lastAllocatedSerial < serial) {
      await tx.masterCodeCounter.upsert({
        where: { namespace: 'FAC' },
        create: { namespace: 'FAC', lastAllocatedSerial: serial },
        update: { lastAllocatedSerial: serial },
      });
    }
  }
  return code;
}

/** Independent of Financial Year and all transaction/document sequences. */
export async function allocateMasterCode(
  tx: Prisma.TransactionClient,
  namespace: MasterCodeNamespace,
): Promise<string> {
  await lockMasterCodeNamespace(tx, namespace);
  // Retain the persisted high-water mark even if an allocated row is deleted.
  // Also account for existing codes, including targets restored from legacy data.
  const [existing] = await tx.$queryRaw<Array<{ serial: bigint }>>(Prisma.sql`
    SELECT COALESCE(MAX(substring(code from 5)::bigint), 0) AS serial
    FROM ${Prisma.raw(tables[namespace])}
    WHERE code ~ ${`^${namespace}-[0-9]{6,}$`}
  `);
  const counter = await tx.masterCodeCounter.findUnique({ where: { namespace } });
  const serial =
    (counter && counter.lastAllocatedSerial > existing!.serial
      ? counter.lastAllocatedSerial
      : existing!.serial) + 1n;
  await tx.masterCodeCounter.upsert({
    where: { namespace },
    create: { namespace, lastAllocatedSerial: serial },
    update: { lastAllocatedSerial: serial },
  });
  return `${namespace}-${serial.toString().padStart(6, '0')}`;
}

export function assertImmutableMasterCode(input: Record<string, unknown>, code: string): void {
  if (input.code !== undefined && input.code !== code) {
    throw HttpError.badRequest('Code cannot be changed after creation');
  }
}
