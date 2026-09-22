import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { ConflictError, UnauthorizedError } from '../../shared/errors';
import { signToken } from '../../shared/security/jwt';
import { hashPassword, verifyPassword } from '../../shared/security/password';
import type { LoginInput, RegisterInput } from './auth.schemas';

// A real bcrypt hash of a random string. When the email doesn't exist we still run a
// comparison against it, so "unknown email" and "wrong password" take the same time
// and an attacker can't discover which emails are registered.
const DUMMY_HASH = '$2b$12$c1wJj.2mhF63GY/I1vdcIeosbUZrCBDNlrj34psmHqUfcOBLQ1APO';

export interface AuthResult {
  token: string;
  user: { id: string; email: string };
  business: { id: string; name: string };
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const passwordHash = await hashPassword(input.password);

  try {
    // One nested write = one transaction: a business never exists without its first user.
    const business = await prisma.business.create({
      data: {
        name: input.businessName,
        // Secret used later to authenticate this business's payment webhooks.
        webhookSecret: randomBytes(32).toString('hex'),
        users: { create: { email: input.email, passwordHash } },
      },
      include: { users: true },
    });

    const user = business.users[0]!;
    return {
      token: signToken({ userId: user.id, businessId: business.id }),
      user: { id: user.id, email: user.email },
      business: { id: business.id, name: business.name },
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictError('An account with this email already exists');
    }
    throw error;
  }
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { business: { select: { id: true, name: true } } },
  });

  const passwordOk = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk) {
    // Same message for both cases on purpose.
    throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  return {
    token: signToken({ userId: user.id, businessId: user.businessId }),
    user: { id: user.id, email: user.email },
    business: user.business,
  };
}

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { business: { select: { id: true, name: true } } },
  });
  // The token was valid but the account is gone (deleted, DB reset, ...).
  if (!user) throw new UnauthorizedError('Account no longer exists', 'INVALID_TOKEN');

  return { user: { id: user.id, email: user.email }, business: user.business };
}
