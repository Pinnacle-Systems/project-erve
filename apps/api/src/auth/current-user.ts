import type { Prisma, UserStatus } from '@prisma/client';
import type { Role } from '@erve/types';

export const currentUserSelect = {
  id: true,
  email: true,
  mobile: true,
  name: true,
  status: true,
  userRoles: { select: { role: { select: { name: true } } } },
  userDistributors: { select: { distributorId: true } },
  userFactories: { select: { factoryId: true } },
} satisfies Prisma.UserSelect;

type CurrentUserRecord = Prisma.UserGetPayload<{ select: typeof currentUserSelect }>;

export interface CurrentUser {
  id: string;
  email: string;
  mobile: string | null;
  name: string;
  status: UserStatus;
  roles: Role[];
  distributorIds: string[];
  factoryIds: string[];
}

export function toCurrentUser(record: CurrentUserRecord): CurrentUser {
  return {
    id: record.id,
    email: record.email,
    mobile: record.mobile,
    name: record.name,
    status: record.status,
    roles: record.userRoles.map((userRole) => userRole.role.name as Role),
    distributorIds: record.userDistributors.map((mapping) => mapping.distributorId),
    factoryIds: record.userFactories.map((mapping) => mapping.factoryId),
  };
}
