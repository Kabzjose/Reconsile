import { parse } from 'csv-parse/sync';
import { normalizeKenyanPhone } from '../../shared/phone';
import { MAX_AMOUNT_CENTS, normalizeReference } from '../../shared/schemas';
import { ValidationError } from '../../shared/errors';

/**
 * Reads a payments statement CSV (M-Pesa Paybill/Till export, or any bank CSV with similar columns).
 *
 * Real exports differ between sources and change over time, so nothing depends on column ORDER or
 * exact spelling: headers are matched by name, ignoring case, spaces and punctuation
 * ("Receipt No.", "receipt_no" and "RECEIPTNO" are the same column), and the header row can sit
 * below a few lines of account details. Rows we can't use are reported, never silently dropped.
 *
 * PURE: text in, structured result out.
 */

export interface ParsedRow {
  line: number;
  externalReference: string;
  paidAt: Date;
  amountCents: number;
  billReference?: string;
  payerPhone?: string;
  payerName?: string;
  /** Present when the statement masked the number ("2547****123"), kept as evidence. */
  payerPhoneRaw?: string;
  raw: Record<string, string>;
}

export interface RowIssue {
  line: number;
  message: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  issues: RowIssue[];
  /** Valid rows that aren't incoming money: withdrawals, failed or reversed transactions. */
  skipped: number;
  /** Which header each field was read from, so the UI can show what we understood. */
  columns: Record<string, string>;
}

export interface ParsedOrderRow {
  line: number;
  reference: string;
  amountCents: number;
  description?: string;
  customerName?: string;
  customerPhone?: string;
  createdAt?: Date;
  raw: Record<string, string>;
}

export interface OrderParseResult {
  rows: ParsedOrderRow[];
  issues: RowIssue[];
  columns: Record<string, string>;
}

const ALIASES = {
  id: ['receiptno', 'receiptnumber', 'receipt', 'transactionid', 'transid', 'transactioncode', 'mpesareceiptno', 'mpesareceipt', 'txnid', 'reference number'],
  time: ['completiontime', 'transactiontime', 'transtime', 'datetime', 'date', 'time', 'paidat', 'initiationtime'],
  amount: ['paidin', 'amount', 'transamount', 'amountpaid', 'credit', 'received'],
  withdrawn: ['withdrawn', 'debit', 'paidout'],
  status: ['transactionstatus', 'status'],
  details: ['details', 'description', 'narrative', 'narration'],
  account: ['accountno', 'acno', 'accountnumber', 'account', 'billrefnumber', 'billref', 'accountreference', 'referenceno', 'reference'],
  party: ['otherpartyinfo', 'msisdn', 'phone', 'phonenumber', 'sender', 'payer', 'customer', 'from', 'name'],
} as const;

type Field = keyof typeof ALIASES;

const ORDER_ALIASES = {
  reference: ['reference', 'orderreference', 'orderno', 'ordernumber', 'orderid', 'invoice', 'invoiceno', 'invoicenumber', 'saleid'],
  amount: ['amount', 'total', 'ordertotal', 'invoiceamount', 'amountdue', 'balance', 'price', 'subtotal'],
  description: ['description', 'details', 'notes', 'item', 'items', 'service'],
  customerName: ['customer', 'customername', 'client', 'clientname', 'name'],
  customerPhone: ['phone', 'phonenumber', 'customerphone', 'mobile', 'msisdn', 'tel', 'telephone'],
  createdAt: ['date', 'createdat', 'orderdate', 'invoicedate', 'sale date'],
} as const;

type OrderField = keyof typeof ORDER_ALIASES;

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export function parseAmountCents(text: string): number | null {
  const cleaned = text.replace(/ksh|kes|,|\s/gi, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  const cents = Math.round(value * 100);
  if (Math.abs(value * 100 - cents) > 1e-6) return null;
  return cents;
}

/** Statement times have no timezone; they are Nairobi time (UTC+3). Day-first for dd/mm/yyyy. */
export function parseStatementDate(text: string): Date | null {
  const value = text.trim();

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
  if (iso) {
    const [, y, mo, d, h = '00', mi = '00', s = '00', tz] = iso;
    const offset = tz ? (tz === 'Z' ? 'Z' : tz.length === 5 ? `${tz.slice(0, 3)}:${tz.slice(3)}` : tz) : '+03:00';
    const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const dayFirst = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dayFirst) {
    const [, d, mo, y, h = '0', mi = '00', s = '00'] = dayFirst;
    const pad = (n: string) => n.padStart(2, '0');
    const date = new Date(`${y}-${pad(mo!)}-${pad(d!)}T${pad(h)}:${mi}:${pad(s)}+03:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** "254712345678 - JOHN DOE", "0712***456 - Jane", "JOHN DOE". */
export function parseParty(text: string): { phone?: string; phoneRaw?: string; name?: string } {
  const token = text.match(/\+?\d[\d*xX ]{7,14}[\d*xX]/);
  let phone: string | undefined;
  let phoneRaw: string | undefined;
  if (token) {
    const compact = token[0].replace(/\s/g, '');
    if (/[*xX]/.test(compact)) phoneRaw = compact;
    else phone = normalizeKenyanPhone(compact) ?? undefined;
    if (!phone && !phoneRaw) phoneRaw = compact;
  }
  const name = text.replace(token?.[0] ?? '', '').replace(/^[\s\-–:]+|[\s\-–:]+$/g, '').trim();
  return { phone, phoneRaw, name: /[a-z]/i.test(name) ? name : undefined };
}

function findHeader(records: string[][]): { index: number; map: Partial<Record<Field, number>> } | null {
  for (let i = 0; i < Math.min(records.length, 30); i++) {
    const cells = records[i]!.map(squash);
    const map: Partial<Record<Field, number>> = {};
    for (const field of Object.keys(ALIASES) as Field[]) {
      // Earlier aliases win, so "Completion Time" beats a plain "Time".
      for (const alias of ALIASES[field]) {
        const at = cells.indexOf(squash(alias));
        if (at !== -1) {
          map[field] = at;
          break;
        }
      }
    }
    if (map.id !== undefined && map.amount !== undefined && map.time !== undefined) return { index: i, map };
  }
  return null;
}

function findOrderHeader(records: string[][]): { index: number; map: Partial<Record<OrderField, number>> } | null {
  for (let i = 0; i < Math.min(records.length, 30); i++) {
    const cells = records[i]!.map(squash);
    const map: Partial<Record<OrderField, number>> = {};
    for (const field of Object.keys(ORDER_ALIASES) as OrderField[]) {
      for (const alias of ORDER_ALIASES[field]) {
        const at = cells.indexOf(squash(alias));
        if (at !== -1) {
          map[field] = at;
          break;
        }
      }
    }
    if (map.reference !== undefined && map.amount !== undefined) return { index: i, map };
  }
  return null;
}

function parseCsvRecords(csvText: string): string[][] {
  try {
    return parse(csvText, { bom: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true, trim: true });
  } catch (error) {
    throw new ValidationError(`That file could not be read as CSV (${error instanceof Error ? error.message : 'unknown error'})`);
  }
}

export function parseStatement(csvText: string): ParseResult {
  const records = parseCsvRecords(csvText);

  const header = findHeader(records);
  if (!header) {
    const first = records[0]?.filter(Boolean).slice(0, 8).join(', ') ?? '(empty file)';
    throw new ValidationError(
      `Could not find the columns we need. The file must have a receipt/transaction id, a date/time and an amount column (for example "Receipt No.", "Completion Time", "Paid In"). The first line reads: ${first}`,
    );
  }

  const { index: headerIndex, map } = header;
  const headerCells = records[headerIndex]!;
  const columns: Record<string, string> = {};
  for (const [field, at] of Object.entries(map)) columns[field] = headerCells[at as number] ?? '';

  const rows: ParsedRow[] = [];
  const issues: RowIssue[] = [];
  let skipped = 0;

  for (let i = headerIndex + 1; i < records.length; i++) {
    const cells = records[i]!;
    const line = i + 1;
    const get = (field: Field) => (map[field] !== undefined ? (cells[map[field]!] ?? '').trim() : '');

    if (cells.every((cell) => !cell)) continue;
    if (/^(total|summary|closing|opening)/i.test(cells[0] ?? '')) continue; // footer lines

    const raw: Record<string, string> = {};
    headerCells.forEach((name, at) => {
      if (name) raw[name] = cells[at] ?? '';
    });

    // Only successful, incoming money becomes a payment.
    const status = get('status');
    if (status && !/complet|success|paid/i.test(status)) {
      skipped++;
      continue;
    }
    const amountText = get('amount');
    const amountCents = amountText ? parseAmountCents(amountText) : null;
    if (amountCents === null && amountText) {
      issues.push({ line, message: `Could not read the amount "${amountText}"` });
      continue;
    }
    if (!amountCents || amountCents <= 0) {
      skipped++; // blank "Paid In" (a withdrawal row) or a negative/zero amount
      continue;
    }
    if (amountCents > MAX_AMOUNT_CENTS) {
      issues.push({ line, message: 'Amount is larger than the supported maximum' });
      continue;
    }

    const externalReference = get('id');
    if (!externalReference) {
      issues.push({ line, message: 'Missing receipt / transaction id' });
      continue;
    }

    const timeText = get('time');
    const paidAt = parseStatementDate(timeText);
    if (!paidAt) {
      issues.push({ line, message: `Could not read the date "${timeText}" (use yyyy-mm-dd hh:mm or dd/mm/yyyy hh:mm)` });
      continue;
    }

    let billReference = get('account');
    if (!billReference) {
      // Some exports only mention the account inside the free-text details.
      const inDetails = get('details').match(/\bacc(?:ount)?(?:\.|\s+(?:no|number)\.?)?[\s:.-]*([A-Za-z0-9][A-Za-z0-9\-_/.]{1,39})/i);
      billReference = inDetails?.[1] ?? '';
    }

    const party = parseParty(get('party'));

    rows.push({
      line,
      externalReference,
      paidAt,
      amountCents,
      billReference: billReference ? normalizeReference(billReference) : undefined,
      payerPhone: party.phone,
      payerPhoneRaw: party.phoneRaw,
      payerName: party.name,
      raw,
    });
  }

  return { rows, issues, skipped, columns };
}

export function parseOrders(csvText: string): OrderParseResult {
  const records = parseCsvRecords(csvText);
  const header = findOrderHeader(records);
  if (!header) {
    const first = records[0]?.filter(Boolean).slice(0, 8).join(', ') ?? '(empty file)';
    throw new ValidationError(
      `Could not find the columns we need. The file must have an order reference and amount column (for example "Reference", "Amount"). The first line reads: ${first}`,
    );
  }

  const { index: headerIndex, map } = header;
  const headerCells = records[headerIndex]!;
  const columns: Record<string, string> = {};
  for (const [field, at] of Object.entries(map)) columns[field] = headerCells[at as number] ?? '';

  const rows: ParsedOrderRow[] = [];
  const issues: RowIssue[] = [];

  for (let i = headerIndex + 1; i < records.length; i++) {
    const cells = records[i]!;
    const line = i + 1;
    const get = (field: OrderField) => (map[field] !== undefined ? (cells[map[field]!] ?? '').trim() : '');

    if (cells.every((cell) => !cell)) continue;
    if (/^(total|summary|closing|opening)/i.test(cells[0] ?? '')) continue;

    const raw: Record<string, string> = {};
    headerCells.forEach((name, at) => {
      if (name) raw[name] = cells[at] ?? '';
    });

    const referenceText = get('reference');
    const reference = referenceText ? normalizeReference(referenceText) : '';
    if (!reference) {
      issues.push({ line, message: 'Missing order reference' });
      continue;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9\-_/.]*$/.test(reference) || reference.length > 40) {
      issues.push({ line, message: `Order reference "${referenceText}" must use letters, numbers and - _ / . only` });
      continue;
    }

    const amountText = get('amount');
    const amountCents = amountText ? parseAmountCents(amountText) : null;
    if (!amountCents || amountCents <= 0) {
      issues.push({ line, message: amountText ? `Could not read the amount "${amountText}"` : 'Missing amount' });
      continue;
    }
    if (amountCents > MAX_AMOUNT_CENTS) {
      issues.push({ line, message: 'Amount is larger than the supported maximum' });
      continue;
    }

    const dateText = get('createdAt');
    const createdAt = dateText ? (parseStatementDate(dateText) ?? undefined) : undefined;
    if (dateText && !createdAt) {
      issues.push({ line, message: `Could not read the date "${dateText}" (use yyyy-mm-dd hh:mm or dd/mm/yyyy hh:mm)` });
      continue;
    }

    const phoneText = get('customerPhone');
    const customerPhone = phoneText ? (normalizeKenyanPhone(phoneText) ?? undefined) : undefined;
    if (phoneText && !customerPhone) {
      issues.push({ line, message: `Could not read the customer phone "${phoneText}"` });
      continue;
    }

    const description = get('description');
    const customerName = get('customerName');

    rows.push({
      line,
      reference,
      amountCents,
      description: description || undefined,
      customerName: customerName || undefined,
      customerPhone,
      createdAt,
      raw,
    });
  }

  return { rows, issues, columns };
}
