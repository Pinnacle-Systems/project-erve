import { z } from 'zod';
import { ROLES } from '@erve/types';
import { normalizeEmail } from '../../utils/email.js';

// Normalize (trim + lowercase) before validating format, so surrounding
// whitespace or casing never causes a spurious "invalid email" rejection.
const normalizedEmail = z.string().transform(normalizeEmail).pipe(z.email());

export const createUserSchema = z.object({
  name: z.string().min(1),
  email: normalizedEmail,
  mobile: z.string().min(1).optional(),
  password: z.string().min(8),
  roles: z.array(z.enum(ROLES)).min(1, 'At least one role is required'),
});

export const updateUserSchema = z
  .object({
    name: z.string().min(1).optional(),
    email: normalizedEmail.optional(),
  })
  .refine((value) => value.name !== undefined || value.email !== undefined, {
    message: 'At least one field must be provided',
  });

export const resetPasswordSchema = z.object({
  password: z.string().min(8),
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

export const listUsersQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  role: roleNameSchema.optional(),
});
