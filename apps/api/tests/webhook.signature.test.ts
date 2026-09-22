import { describe, expect, it } from 'vitest';
import { signBody, verifySignature } from '../src/modules/webhooks/webhook.signature';

describe('webhook signatures', () => {
  const secret = 'a-very-secret-webhook-key';
  const body = Buffer.from(JSON.stringify({ event: 'payment.completed', amount: 2500 }));

  it('accepts a correctly signed body', () => {
    expect(verifySignature(secret, body, signBody(secret, body))) .toBe(true);
  });

  it('rejects a body signed with the wrong secret', () => {
    expect(verifySignature(secret, body, signBody('wrong-secret', body))).toBe(false);
  });

  it('rejects a body that was tampered with after signing', () => {
    const signature = signBody(secret, body);
    const tampered = Buffer.from(JSON.stringify({ event: 'payment.completed', amount: 999999 }));
    expect(verifySignature(secret, tampered, signature)).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(verifySignature(secret, body, undefined)).toBe(false);
  });

  it('rejects garbage', () => {
    expect(verifySignature(secret, body, 'not-a-real-signature')).toBe(false);
  });

  it('accepts the signature with or without the "sha256=" prefix', () => {
    const signature = signBody(secret, body);
    expect(verifySignature(secret, body, signature.replace('sha256=', ''))).toBe(true);
  });
});
