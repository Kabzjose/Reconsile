import express, { Router } from 'express';
import { processWebhook } from './webhook.service';
import { SIGNATURE_HEADER } from './webhook.signature';

export const webhookRouter = Router();

// Public (no JWT): the HMAC signature is the authentication.
// It takes the body RAW, because the signature is computed over the exact bytes that were sent;
// parsing to JSON and re-serialising would change them.
webhookRouter.post('/payments/:businessId', express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const result = await processWebhook({
    businessId: String(req.params.businessId),
    rawBody,
    signatureHeader: req.header(SIGNATURE_HEADER),
  });
  res.status(result.httpStatus).json(result.body);
});
