import { randomBytes } from 'node:crypto';
import { env } from '../../config/env';
import { prisma } from '../../infrastructure/database/prisma';
import { NotFoundError } from '../../shared/errors';

function toDto(business: { id: string; name: string; webhookSecret: string; createdAt: Date }) {
  return {
    id: business.id,
    name: business.name,
    webhookSecret: business.webhookSecret,
    // Append this to the API's public URL. Requests must carry X-Reconcile-Signature (see the docs).
    webhookPath: `/api/webhooks/payments/${business.id}`,
    simulatorEnabled: env.ENABLE_SIMULATOR,
    createdAt: business.createdAt,
  };
}

export async function getBusiness(businessId: string) {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw new NotFoundError('Business not found');
  return toDto(business);
}

/** Use if the secret leaks: the old one stops working immediately. */
export async function rotateWebhookSecret(businessId: string) {
  const business = await prisma.business.update({
    where: { id: businessId },
    data: { webhookSecret: randomBytes(32).toString('hex') },
  });
  return toDto(business);
}
