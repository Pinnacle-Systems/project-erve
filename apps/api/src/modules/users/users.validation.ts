import { z } from 'zod';
import { ROLES } from '@erve/types';

export const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  mobile: z.string().min(1).optional(),
  password: z.string().min(8),
  roles: z.array(z.enum(ROLES)).min(1, 'At least one role is required'),
});

export const updateStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']),
});

export const roleNameSchema = z.enum(ROLES);

export const assignRoleSchema = z.object({
  roleName: roleNameSchema,
});

export const distributorMappingSchema = z.object({
  distributorId: z.string().min(1),
});

export const factoryMappingSchema = z.object({
  factoryId: z.string().min(1),
});
