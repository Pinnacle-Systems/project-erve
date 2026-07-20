import bcrypt from 'bcryptjs';
import type { AuthUser, Role } from '@erve/types';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';
import { verifyPassword } from '../../auth/password.js';
import { currentUserSelect, toCurrentUser } from '../../auth/current-user.js';
import { normalizeEmail } from '../../utils/email.js';
import {
  createRefreshSession,
  issueTokenResponse,
  type TokenResponse,
} from './refresh-session.service.js';

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email/mobile number or password';

// A precomputed hash with no matching plaintext. Used so a login attempt
// against a nonexistent identifier still pays the bcrypt.compare cost,
// keeping failure timing indistinguishable from a wrong-password failure.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('no-such-account', 12);

export async function login(identifier: string, password: string): Promise<TokenResponse> {
  // Emails are stored canonically (trim + lowercase, same as create/edit) —
  // mobile numbers have no case concept, so only whitespace is trimmed.
  const normalizedIdentifier = identifier.includes('@')
    ? normalizeEmail(identifier)
    : identifier.trim();

  const record = await prisma.user.findFirst({
    where: { OR: [{ email: normalizedIdentifier }, { mobile: normalizedIdentifier }] },
    select: { ...currentUserSelect, passwordHash: true },
  });

  const passwordValid = await verifyPassword(password, record?.passwordHash ?? DUMMY_PASSWORD_HASH);

  if (!record || !passwordValid || record.status !== 'ACTIVE') {
    throw HttpError.unauthorized(INVALID_CREDENTIALS_MESSAGE);
  }

  const currentUser = toCurrentUser(record);
  const refreshToken = await createRefreshSession(currentUser.id, currentUser.authVersion);

  return issueTokenResponse(currentUser, refreshToken);
}

export interface MeResponse extends AuthUser {
  status: string;
  distributors: Array<{ id: string; code: string; name: string }>;
  factories: Array<{ id: string; code: string; name: string }>;
}

export async function getMe(userId: string): Promise<MeResponse> {
  const record = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      mobile: true,
      name: true,
      status: true,
      userRoles: { select: { role: { select: { name: true } } } },
      userDistributors: {
        select: { distributor: { select: { id: true, code: true, name: true } } },
      },
      userFactories: { select: { factory: { select: { id: true, code: true, name: true } } } },
    },
  });

  if (!record) {
    throw HttpError.notFound('User not found');
  }

  return {
    id: record.id,
    email: record.email,
    mobile: record.mobile,
    name: record.name,
    status: record.status,
    roles: record.userRoles.map((userRole) => userRole.role.name as Role),
    distributors: record.userDistributors.map((mapping) => mapping.distributor),
    factories: record.userFactories.map((mapping) => mapping.factory),
  };
}
