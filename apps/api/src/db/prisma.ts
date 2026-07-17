import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

// Re-exported so the rest of the app imports the generated client through
// this single module instead of reaching into src/generated/ directly.
export { Prisma };
export type {
  DistributorStatus,
  FactoryConfirmationStatus,
  FactoryStatus,
  JobOrderStatus,
  PriceListStatus,
  ProcessFlowStatus,
  ProcessFlowVersionStatus,
  ProductionStageStatus,
  PurchaseMode,
  PurchaseOrderLineStatus,
  PurchaseOrderStatus,
  RoleName,
  SizeStatus,
  SizeType,
  StyleStatus,
  UserStatus,
} from '../generated/prisma/client.js';

declare global {
  var __prisma: PrismaClient | undefined;
}

// Prisma 7 dropped its bundled query engine — a driver adapter now owns the
// actual database connection.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = globalThis.__prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}
