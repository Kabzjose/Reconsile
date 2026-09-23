import { describe, expect, it } from 'vitest';
import { parseAmountCents, parseOrders, parseParty, parseStatement, parseStatementDate } from '../src/modules/imports/import.parser';

describe('parseAmountCents', () => {
  it.each([
    ['2500', 250000],
    ['2,500.00', 250000],
    ['2500.5', 250050],
    ['KSh 2,500', 250000],
    ['0.01', 1],
  ])('%s -> %i', (input, cents) => expect(parseAmountCents(input)).toBe(cents));

  it.each(['', 'abc', '2,5o0', '2500.555'])('rejects %j', (input) => expect(parseAmountCents(input)).toBeNull());
});

describe('parseStatementDate (Nairobi time, no explicit timezone in real statements)', () => {
  it('reads M-Pesa\'s own format', () => {
    const d = parseStatementDate('2026-09-21 10:32:00');
    expect(d?.toISOString()).toBe('2026-09-21T07:32:00.000Z'); // 10:32 EAT = 07:32 UTC
  });
  it('reads day-first dd/mm/yyyy', () => {
    const d = parseStatementDate('21/09/2026 10:32');
    expect(d?.toISOString()).toBe('2026-09-21T07:32:00.000Z');
  });
  it('reads a bare date as midnight Nairobi time', () => {
    expect(parseStatementDate('2026-09-21')?.toISOString()).toBe('2026-09-20T21:00:00.000Z');
  });
  it('rejects garbage', () => expect(parseStatementDate('not a date')).toBeNull());
});

describe('parseParty', () => {
  it('splits a masked phone from a name', () => {
    expect(parseParty('254712***456 - JOHN MWANGI')).toEqual({ phoneRaw: '254712***456', name: 'JOHN MWANGI' });
  });
  it('normalises a full phone number', () => {
    expect(parseParty('0712345678 - Jane Doe').phone).toBe('254712345678');
  });
  it('handles a name with no phone at all', () => {
    expect(parseParty('JOHN MWANGI')).toEqual({ name: 'JOHN MWANGI' });
  });
});

const mpesaCsv = [
  'Receipt No.,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance,Account No.,Other Party Info',
  'SIM001,2026-09-21 10:32:00,Pay Bill Online,Completed,2500.00,,2500.00,ORD-1042,254712345678 - JOHN MWANGI',
  'SIM002,2026-09-21 10:40:00,Customer Payment to Till,Completed,2500.00,,5000.00,,254700000001 - JANE DOE',
  'SIM003,2026-09-21 10:45:00,Business Payment,Completed,,1500.00,3500.00,,',
  'SIM004,2026-09-21 10:50:00,Pay Bill Online,Failed,90.00,,3500.00,ORD-9999,',
].join('\n');

describe('parseStatement: a realistic M-Pesa export', () => {
  const result = parseStatement(mpesaCsv);

  it('finds the header and maps every column', () => {
    expect(result.columns.id).toBe('Receipt No.');
    expect(result.columns.amount).toBe('Paid In');
  });

  it('imports the two successful incoming payments', () => {
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ externalReference: 'SIM001', amountCents: 250000, billReference: 'ORD-1042', payerPhone: '254712345678' });
    expect(result.rows[1]).toMatchObject({ externalReference: 'SIM002', amountCents: 250000, billReference: undefined });
  });

  it('skips a withdrawal row and a failed transaction without reporting either as an error', () => {
    expect(result.skipped).toBe(2); // SIM003 (withdrawal) + SIM004 (failed)
    expect(result.issues).toHaveLength(0);
  });

  it('skips a failed transaction (never becomes a payment)', () => {
    expect(result.rows.some((row) => row.externalReference === 'SIM004')).toBe(false);
  });
});

describe('parseStatement: header aliasing and messy files', () => {
  it('understands a differently-worded header', () => {
    const csv = [
      'Transaction ID,Transaction Time,Amount,Account Reference,MSISDN',
      'TXN1,2026-09-21 09:00:00,1000,ORD-1,254712345678',
    ].join('\n');
    const result = parseStatement(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.billReference).toBe('ORD-1');
  });

  it('finds the header even below a few lines of account info', () => {
    const csv = [
      'MPESA Statement',
      'Customer Name: Mama Njeri Shop',
      'Account: 123456',
      '',
      'Receipt No.,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance,Account No.,Other Party Info',
      'SIM001,2026-09-21 10:32:00,Pay Bill Online,Completed,2500.00,,2500.00,ORD-1,254712345678',
    ].join('\n');
    expect(parseStatement(csv).rows).toHaveLength(1);
  });

  it('reports a bad amount as an issue on its line, and keeps parsing the rest', () => {
    const csv = [
      'Receipt No.,Completion Time,Paid In',
      'SIM001,2026-09-21 10:32:00,not-a-number',
      'SIM002,2026-09-21 10:33:00,500',
    ].join('\n');
    const result = parseStatement(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.issues).toEqual([{ line: 2, message: expect.stringContaining('amount') }]);
  });

  it('throws a clear, actionable error when no usable header exists', () => {
    expect(() => parseStatement('Name,Notes\nJohn,hello')).toThrow(/Receipt No\.|column/i);
  });

  it('is quantity-accurate: rows read = imported + skipped + invalid, always', () => {
    const result = parseStatement(mpesaCsv);
    expect(result.rows.length + result.skipped + result.issues.length).toBe(4);
  });
});

describe('parseOrders', () => {
  it('imports order rows with optional customer details', () => {
    const csv = [
      'Reference,Amount,Description,Customer Name,Customer Phone,Date',
      ' ord-1042 ,2500.00,Catering,John Mwangi,0712345678,2026-09-21 10:32:00',
    ].join('\n');
    const result = parseOrders(csv);

    expect(result.columns.reference).toBe('Reference');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      reference: 'ORD-1042',
      amountCents: 250000,
      description: 'Catering',
      customerName: 'John Mwangi',
      customerPhone: '254712345678',
    });
    expect(result.rows[0]!.createdAt?.toISOString()).toBe('2026-09-21T07:32:00.000Z');
  });

  it('understands invoice-style headers', () => {
    const csv = ['Invoice No,Total,Client,Mobile', 'INV-1,1000,Jane,254700000001'].join('\n');
    expect(parseOrders(csv).rows[0]).toMatchObject({ reference: 'INV-1', amountCents: 100000, customerName: 'Jane' });
  });

  it('reports invalid rows and keeps parsing the rest', () => {
    const csv = ['Reference,Amount,Phone', 'bad ref,100,0712345678', 'ORD-2,nope,0712345678', 'ORD-3,300,not-a-phone', 'ORD-4,400,0712345678'].join('\n');
    const result = parseOrders(csv);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.reference).toBe('ORD-4');
    expect(result.issues).toHaveLength(3);
  });

  it('throws a clear error when no usable header exists', () => {
    expect(() => parseOrders('Name,Notes\nJohn,hello')).toThrow(/reference and amount/i);
  });
});
