import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhooks are signed: the sender computes HMAC-SHA256 of the RAW request body using the
 * business's webhook secret and sends it as `X-Reconcile-Signature: sha256=<hex>`.
 * Anyone who doesn't hold the secret can't produce a valid signature, so they can't forge payments.
 *
 * Note: Safaricom's Daraja callbacks are NOT signed this way. In production you'd put a gateway in front
 * that verifies Daraja's source and re-signs the event for this endpoint.
 */

export const SIGNATURE_HEADER = 'x-reconcile-signature';

export function signBody(secret: string, rawBody: Buffer | string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

export function verifySignature(secret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (!header) return false;
  const provided = header.startsWith('sha256=') ? header : `sha256=${header}`;
  const expected = signBody(secret, rawBody);

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on different lengths, and a plain === would leak timing information.
  return a.length === b.length && timingSafeEqual(a, b);
}
