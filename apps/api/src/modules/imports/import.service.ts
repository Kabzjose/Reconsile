import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, Provider } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { ValidationError } from '../../shared/errors';
import { receivePayment } from '../payments/payment.receive';
import { parseStatement, type RowIssue } from './import.parser';

const MAX_ROWS = 2000;

export interface ImportSummary {
  batchId: string;
  columns: Record<string, string>;
  rowsRead: number;
  imported: number;
  duplicates: number;
  autoMatched: number;
  suggested: number;
  needsReview: number;
  skippedRows: number;
  invalidRows: number;
  failed: number;
  errors: RowIssue[];
}

/**
 * Every row goes through the same door as a webhook (store, idempotent insert, reconcile),
 * so re-uploading the same statement can never double-count a payment.
 */
export async function importPayments(businessId: string, csv: string, provider: Provider): Promise<ImportSummary> {
  const parsed = parseStatement(csv);
  if (parsed.rows.length > MAX_ROWS) {
    throw new ValidationError(`That statement has ${parsed.rows.length} payments; import at most ${MAX_ROWS} at a time. Split the file by date.`);
  }

  const batchId = randomUUID();
  const summary: ImportSummary = {
    batchId,
    columns: parsed.columns,
    rowsRead: parsed.rows.length + parsed.issues.length + parsed.skipped,
    imported: 0,
    duplicates: 0,
    autoMatched: 0,
    suggested: 0,
    needsReview: 0,
    skippedRows: parsed.skipped,
    invalidRows: parsed.issues.length,
    failed: 0,
    errors: [...parsed.issues],
  };

  // One at a time: each row is its own small transaction, and a bad row can't sink the rest.
  for (const row of parsed.rows) {
    try {
      const received = await receivePayment(
        {
          businessId,
          provider,
          externalReference: row.externalReference,
          billReference: row.billReference,
          amountCents: row.amountCents,
          payerPhone: row.payerPhone,
          payerName: row.payerName,
          paidAt: row.paidAt,
          metadata: row.payerPhoneRaw ? { payerPhoneRaw: row.payerPhoneRaw } : undefined,
        },
        { source: 'CSV_IMPORT', batchId, rawPayload: { line: row.line, ...row.raw } as Prisma.InputJsonValue },
      );

      if (received.duplicate) {
        summary.duplicates++;
        continue;
      }
      summary.imported++;
      const outcome = received.reconciliation?.outcome;
      if (outcome === 'AUTO_MATCHED') summary.autoMatched++;
      else if (outcome === 'SUGGESTED') summary.suggested++;
      else summary.needsReview++;
    } catch (error) {
      summary.failed++;
      summary.errors.push({ line: row.line, message: error instanceof Error ? error.message : 'Unexpected error' });
    }
  }

  summary.errors = summary.errors.slice(0, 50);
  return summary;
}

// ───────────────────────────── demo helper ─────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
/** Statements print Nairobi time. */
function formatNairobi(date: Date) {
  const d = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
const money = (cents: number) => (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/**
 * A realistic statement built from THIS business's unpaid orders, so the demo import always has
 * something to match: clean payments, a Till payment with no account number, an unknown payer,
 * a withdrawal and a failed transaction. Receipt numbers are derived from the order ids, so
 * downloading it twice and importing both times shows duplicate protection.
 */
export async function buildSampleStatement(businessId: string, now = new Date()): Promise<string> {
  const orders = await prisma.order.findMany({
    where: { businessId, status: 'UNPAID' },
    include: { customer: { select: { name: true, phone: true } } },
    orderBy: { createdAt: 'asc' },
    take: 6,
  });

  const receipt = (seed: string) => `SIM${createHash('sha1').update(seed).digest('hex').slice(0, 8).toUpperCase()}`;
  const lines = ['Receipt No.,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance,Account No.,Other Party Info'];
  let balance = 0;

  const add = (row: { id: string; at: Date; details: string; status?: string; paidIn?: number; withdrawn?: number; account?: string; party?: string }) => {
    balance += (row.paidIn ?? 0) - (row.withdrawn ?? 0);
    lines.push(
      [
        row.id,
        formatNairobi(row.at),
        row.details,
        row.status ?? 'Completed',
        row.paidIn ? money(row.paidIn) : '',
        row.withdrawn ? money(row.withdrawn) : '',
        money(balance),
        row.account ?? '',
        row.party ?? '',
      ]
        .map(cell)
        .join(','),
    );
  };

  orders.forEach((order, i) => {
    const at = new Date(Math.min(order.createdAt.getTime() + (3 + i * 2) * 60_000, now.getTime()));
    const phone = order.customer?.phone ?? `2547${String(10_000_000 + ((i * 7_919_113) % 89_999_999))}`;
    const masked = i === 2; // real statements often mask the number
    const noAccount = i === 3; // a Till payment: nobody typed an account number
    add({
      id: receipt(`order:${order.id}`),
      at,
      details: noAccount ? 'Customer Payment to Till' : 'Pay Bill Online',
      paidIn: order.amountCents - order.allocatedCents,
      account: noAccount ? '' : order.reference,
      party: `${masked ? `${phone.slice(0, 5)}***${phone.slice(-3)}` : phone} - ${order.customer?.name ?? 'CUSTOMER'}`.toUpperCase(),
    });
  });

  add({ id: receipt(`orphan:${businessId}`), at: new Date(now.getTime() - 20 * 60_000), details: 'Pay Bill Online', paidIn: 470_000, party: '254733000111 - UNKNOWN PAYER' });
  add({ id: receipt(`withdrawal:${businessId}`), at: new Date(now.getTime() - 10 * 60_000), details: 'Business Payment to supplier', withdrawn: 150_000 });
  add({ id: receipt(`failed:${businessId}`), at: new Date(now.getTime() - 5 * 60_000), details: 'Pay Bill Online', status: 'Failed', paidIn: 90_000 });

  return lines.join('\n') + '\n';
}
