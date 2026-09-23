import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/infrastructure/database/prisma';
import { buildSampleStatement, importOrders, importPayments } from '../../src/modules/imports/import.service';
import { processWebhook } from '../../src/modules/webhooks/webhook.service';
import { signBody } from '../../src/modules/webhooks/webhook.signature';
import { createBusiness, createOrder } from './helpers';

describe('CSV import, against a real database', () => {
  it('imports a statement, auto-matching what it can and leaving the rest for review', async () => {
    const business = await createBusiness();
    await createOrder(business.id, { reference: 'ORD-1042', amountCents: 250000 });

    const csv = [
      'Receipt No.,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance,Account No.,Other Party Info',
      'R1,2026-09-21 10:32:00,Pay Bill Online,Completed,2500.00,,2500.00,ORD-1042,254712345678 - JOHN',
      'R2,2026-09-21 10:40:00,Business Payment,Completed,,1500.00,1000.00,,',
    ].join('\n');

    const summary = await importPayments(business.id, csv, 'MPESA');
    expect(summary.imported).toBe(1);
    expect(summary.autoMatched).toBe(1);
    expect(summary.skippedRows).toBe(1); // the withdrawal row

    const order = await prisma.order.findFirstOrThrow({ where: { businessId: business.id, reference: 'ORD-1042' } });
    expect(order.status).toBe('PAID');
  });

  it('re-importing the SAME statement a second time creates zero new payments', async () => {
    const business = await createBusiness();
    await createOrder(business.id, { reference: 'ORD-1042', amountCents: 250000 });
    const csv = [
      'Receipt No.,Completion Time,Paid In,Account No.',
      'R1,2026-09-21 10:32:00,2500.00,ORD-1042',
    ].join('\n');

    await importPayments(business.id, csv, 'MPESA');
    const second = await importPayments(business.id, csv, 'MPESA');

    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(await prisma.payment.count({ where: { businessId: business.id } })).toBe(1);
  });

  it('a payment already received via webhook is recognised as a duplicate when the same transaction later appears in a CSV import', async () => {
    const business = await createBusiness();
    const rawBody = Buffer.from(JSON.stringify({ event: 'payment.completed', provider: 'MPESA', transactionId: 'R1', amount: 2500 }));
    await processWebhook({ businessId: business.id, rawBody, signatureHeader: signBody(business.webhookSecret, rawBody) });

    const csv = ['Receipt No.,Completion Time,Paid In', 'R1,2026-09-21 10:32:00,2500.00'].join('\n');
    const summary = await importPayments(business.id, csv, 'MPESA');

    expect(summary.duplicates).toBe(1);
    expect(await prisma.payment.count({ where: { businessId: business.id } })).toBe(1);
  });

  it('the generated sample statement round-trips through the real importer cleanly', async () => {
    const business = await createBusiness();
    await Promise.all([
      createOrder(business.id, { reference: 'ORD-1', amountCents: 250000 }),
      createOrder(business.id, { reference: 'ORD-2', amountCents: 180000 }),
    ]);

    const csv = await buildSampleStatement(business.id);
    const summary = await importPayments(business.id, csv, 'MPESA');

    expect(summary.invalidRows).toBe(0); // everything our own generator writes must parse cleanly
    expect(summary.imported).toBeGreaterThan(0);
  });

  it('imports orders, creates customers from phone details, and skips duplicate references on retry', async () => {
    const business = await createBusiness();
    const csv = [
      'Reference,Amount,Description,Customer Name,Customer Phone,Date',
      'ORD-1042,2500.00,Catering,John Mwangi,0712345678,2026-09-21 10:32:00',
      'ORD-1043,1800.00,Delivery,John Mwangi,0712345678,2026-09-21 10:40:00',
    ].join('\n');

    const first = await importOrders(business.id, csv);
    expect(first.imported).toBe(2);
    expect(first.customersCreated).toBe(1);
    expect(first.invalidRows).toBe(0);

    const second = await importOrders(business.id, csv);
    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(2);
    expect(await prisma.order.count({ where: { businessId: business.id } })).toBe(2);
    expect(await prisma.customer.count({ where: { businessId: business.id } })).toBe(1);
  });
});
