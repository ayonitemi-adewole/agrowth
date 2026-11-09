import { describe, expect, it } from 'vitest';
import {
  bankCode,
  parseCsv,
  parseStatement,
  paymentFileCsv,
  simulatedStatementCsv,
  statementAmount,
  statementDate,
  type BatchItem,
} from './bankfiles';

describe('payment files', () => {
  it('knows the codes of common banks by their usual names', () => {
    expect(bankCode('GTBank')).toBe('058');
    expect(bankCode('Guaranty Trust Bank')).toBe('058');
    expect(bankCode('Access Bank')).toBe('044');
    expect(bankCode('First Bank')).toBe('011');
    expect(bankCode('United Bank for Africa')).toBe('033');
    expect(bankCode('Moon Bank')).toBe('');
  });

  it('writes one row per payment, with the reference in the narration', () => {
    const item: BatchItem = {
      batch_id: 'b',
      kind: 'vendor_payment',
      item_id: 'i',
      reference: 'AGP-0123456789',
      payee_name: 'Zaria Agro Inputs',
      bank_name: 'Zenith Bank',
      account_number: '1023456789',
      account_name: 'Zaria Agro Inputs Ltd',
      amount_kobo: '125000050',
      narration: 'AGP-0123456789 Voucher inputs 2 bags NPK',
      withdrawn_at: null,
      withdraw_reason: null,
    };
    expect(paymentFileCsv([item])).toBe(
      'Beneficiary name,Account number,Bank,Bank code,Amount (NGN),Narration,Reference\r\n' +
        'Zaria Agro Inputs Ltd,1023456789,Zenith Bank,057,1250000.50,AGP-0123456789 Voucher inputs 2 bags NPK,AGP-0123456789',
    );
  });
});

describe('reading statements', () => {
  it('splits CSV, with quoted commas and newlines', () => {
    expect(parseCsv('\uFEFFa,"b, c","d ""e"""\r\n\r\n1,"x\ny",3\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', 'x\ny', '3'],
    ]);
  });

  it('reads the date and amount formats banks use', () => {
    expect(statementDate('21/04/2026')).toBe('2026-04-21');
    expect(statementDate('21-Apr-2026')).toBe('2026-04-21');
    expect(statementDate('21 April 26')).toBe('2026-04-21');
    expect(statementDate('2026-04-21 14:03:11')).toBe('2026-04-21');
    expect(statementDate('31/02/2026')).toBeNull();
    expect(statementAmount('1,250,000.50')).toBe(125000050n);
    expect(statementAmount('(4,000.00)')).toBe(-400000n);
    expect(statementAmount('₦ 40')).toBe(4000n);
    expect(statementAmount('-')).toBe(0n);
    expect(statementAmount('abc')).toBeNull();
  });

  it('finds the header under the bank’s preamble and reads Debit and Credit columns', () => {
    const csv = [
      'Zenith Bank Plc,,,,,',
      'Account,1012345678,,,,',
      'Trans. Date,Value Date,Narration,Reference,Debit,Credit,Balance',
      '01/11/2026,01/11/2026,Opening balance,,,,"1,000.00"',
      '02/11/2026,02/11/2026,"NIP TRF AGR-7KQ2MX4P, ADA",S123,,"500,000.00","501,000.00"',
      '03/11/2026,03/11/2026,AGP-0123456789 TRF,S124,"25,000.00",,"476,000.00"',
      '03/11/2026,03/11/2026,Bad row,S125,lots,,',
    ].join('\r\n');
    const { lines, problems } = parseStatement(csv);
    expect(lines).toEqual([
      {
        value_date: '2026-11-02',
        narration: 'NIP TRF AGR-7KQ2MX4P, ADA',
        reference: 'S123',
        amount_kobo: '50000000',
        balance_kobo: '50100000',
      },
      {
        value_date: '2026-11-03',
        narration: 'AGP-0123456789 TRF',
        reference: 'S124',
        amount_kobo: '-2500000',
        balance_kobo: '47600000',
      },
    ]);
    expect(problems).toEqual(["Row 7: the amount can't be read"]);
  });

  it('reads a signed Amount column, with an optional Dr/Cr column', () => {
    const csv =
      'Date,Description,Amount,Type\n2026-11-02,Charges,40.00,DR\n2026-11-02,In,-0,\n2026-11-03,Out,-15.50,';
    expect(parseStatement(csv).lines.map((l) => l.amount_kobo)).toEqual(['-4000', '-1550']);
  });

  it('says what is missing when there is no header row', () => {
    expect(parseStatement('a,b\n1,2').problems[0]).toMatch(/No header row/);
  });

  it('reads back the simulated bank’s statement', () => {
    const csv = simulatedStatementCsv(
      [{ reference: 'AGP-0123456789', account_name: 'Zaria Agro', amount_kobo: '2500000' }],
      [{ reference: 'AGR-7KQ2MX4P', investor: 'Ada Obi', amount_kobo: '50000000' }],
      new Date('2026-11-09T10:00:00Z'),
    );
    const { lines, problems } = parseStatement(csv);
    expect(problems).toEqual([]);
    expect(lines.map((l) => [l.value_date, l.amount_kobo, l.reference])).toEqual([
      ['2026-11-09', '50000000', 'SIM202611090001'],
      ['2026-11-09', '-2500000', 'SIM202611090002'],
    ]);
    expect(lines[0].narration).toContain('AGR-7KQ2MX4P');
  });
});
