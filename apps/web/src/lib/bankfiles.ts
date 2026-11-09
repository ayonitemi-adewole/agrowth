import { parseNaira } from './money';
import { csvNaira, toCsv } from './programmes';

/*
 * The trustee's bank files. Payment files go to the bank's bulk-payment upload; statement
 * files come back from the bank's statement export. Every bank lays these out a little
 * differently: the payment file uses common column names a bank template can be mapped
 * from, and the statement reader recognises the usual column names.
 */

export type PaymentKind = 'disbursement' | 'vendor_payment' | 'settlement_payout';

/** A row of public.trustee_payments(). */
export interface TrusteePayment {
  kind: PaymentKind;
  item_id: string;
  cycle_id: string;
  cycle_code: string;
  reference: string;
  payee_name: string;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  amount_kobo: string;
  narration: string;
  paid: boolean;
  trustee_reference: string | null;
  problem: string | null;
  created_at: string;
  batch_id: string | null;
  batch_created_at: string | null;
}

/** A row of public.payment_batch_items: a payment as it went into a file. */
export interface BatchItem {
  batch_id: string;
  kind: PaymentKind;
  item_id: string;
  reference: string;
  payee_name: string;
  bank_name: string | null;
  account_number: string;
  account_name: string;
  amount_kobo: string;
  narration: string;
  withdrawn_at: string | null;
  withdraw_reason: string | null;
}

export const PAYMENT_KIND: Record<PaymentKind, string> = {
  disbursement: 'Release',
  vendor_payment: 'Vendor (vouchers)',
  settlement_payout: 'Settlement',
};

export type StatementLineStatus =
  'confirmed' | 'already_recorded' | 'needs_review' | 'unmatched' | 'dismissed';

export const LINE_STATUS: Record<
  StatementLineStatus,
  { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' | 'blue' }
> = {
  confirmed: { label: 'Confirmed', tone: 'green' },
  already_recorded: { label: 'Already recorded', tone: 'blue' },
  needs_review: { label: 'Needs review', tone: 'red' },
  unmatched: { label: 'Unmatched', tone: 'amber' },
  dismissed: { label: 'Dismissed', tone: 'neutral' },
};

/**
 * CBN/NIBSS codes of common Nigerian banks, for the bank-code column of a payment file.
 * Names are matched loosely ("GTBank", "Guaranty Trust Bank"). Check them against your
 * bank's list before uploading; a name not found leaves the code blank.
 */
const BANKS: [code: string, pattern: RegExp][] = [
  ['044', /\baccess\b/],
  ['023', /\bciti/],
  ['050', /\becobank\b/],
  ['070', /\bfidelity\b/],
  ['011', /\bfirst ?bank\b|\bfirst bank of nigeria\b|^fbn\b/],
  ['214', /\bfcmb\b|first city monument/],
  ['058', /\bgt ?bank\b|\bguaranty trust\b|\bgtco\b/],
  ['030', /\bheritage\b/],
  ['301', /\bjaiz\b/],
  ['082', /\bkeystone\b/],
  ['076', /\bpolaris\b/],
  ['101', /\bprovidus\b/],
  ['221', /\bstanbic\b/],
  ['068', /\bstandard chartered\b/],
  ['232', /\bsterling\b/],
  ['100', /\bsuntrust\b/],
  ['102', /\btitan\b/],
  ['032', /\bunion bank\b/],
  ['033', /\buba\b|\bunited bank for africa\b/],
  ['215', /\bunity\b/],
  ['035', /\bwema\b|\balat\b/],
  ['057', /\bzenith\b/],
  // Mobile money and digital banks, where many farmers keep their money.
  ['999992', /\bopay\b|\bpaycom\b/],
  ['999991', /\bpalm ?pay\b/],
  ['50515', /\bmoniepoint\b/],
  ['50211', /\bkuda\b/],
];

/** Banks and mobile-money providers to choose from when entering a payout account. */
export const BANK_CHOICES = [
  'Access Bank',
  'Citibank',
  'Ecobank',
  'FCMB',
  'Fidelity Bank',
  'First Bank',
  'GTBank',
  'Heritage Bank',
  'Jaiz Bank',
  'Keystone Bank',
  'Kuda',
  'Moniepoint',
  'OPay',
  'PalmPay',
  'Polaris Bank',
  'Providus Bank',
  'Stanbic IBTC',
  'Standard Chartered',
  'Sterling Bank',
  'SunTrust Bank',
  'Titan Trust Bank',
  'UBA',
  'Union Bank',
  'Unity Bank',
  'Wema Bank',
  'Zenith Bank',
];

export function bankCode(bankName: string | null | undefined): string {
  const name = (bankName ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  return BANKS.find(([, pattern]) => pattern.test(name))?.[0] ?? '';
}

/**
 * The payment file for a bank's bulk-payment upload: one row per payment, with its
 * Agrowth reference at the start of the narration so the statement can be matched.
 */
export function paymentFileCsv(items: BatchItem[]): string {
  return toCsv(items, [
    ['Beneficiary name', (i) => i.account_name],
    ['Account number', (i) => i.account_number],
    ['Bank', (i) => i.bank_name ?? ''],
    ['Bank code', (i) => bankCode(i.bank_name)],
    ['Amount (NGN)', (i) => csvNaira(i.amount_kobo)],
    ['Narration', (i) => i.narration],
    ['Reference', (i) => i.reference],
  ]);
}

// ---------- Reading statements ----------

/** Splits CSV text into rows of cells (quoted cells, embedded commas and newlines, a BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.startsWith('\uFEFF') ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A statement date as YYYY-MM-DD. Nigerian banks write days first: 21/04/2026,
 * 21-04-2026, 21-Apr-2026, 21 Apr 26; ISO dates work too. A time after the date is ignored.
 */
export function statementDate(value: string): string | null {
  const s = value
    .trim()
    .split(/[ T](?=\d{1,2}:)/)[0]
    .trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) [y, m, d] = [+match[1], +match[2], +match[3]];
  else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s)))
    [d, m, y] = [+match[1], +match[2], +match[3]];
  else if ((match = /^(\d{1,2})[\s/-]([A-Za-z]{3})[A-Za-z]*[\s/-](\d{2}|\d{4})$/.exec(s))) {
    m = MONTHS.indexOf(match[2].toLowerCase()) + 1;
    [d, y] = [+match[1], +match[3]];
    if (!m) return null;
  } else return null;
  if (y < 100) y += 2000;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** A statement amount in kobo: "1,250,000.50", "(4,000.00)" or "-40.00"; blank or "-" is 0. */
export function statementAmount(value: string): bigint | null {
  let s = value.trim().replace(/[₦\s]|NGN/gi, '');
  if (s === '' || s === '-' || s === '0' || s === '0.00') return 0n;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  const kobo = parseNaira(s);
  if (kobo === null) return null;
  return negative ? -kobo : kobo;
}

export interface StatementLine {
  value_date: string;
  narration: string;
  reference: string | null;
  /** Whole kobo as text: money in positive, out negative. */
  amount_kobo: string;
  balance_kobo: string | null;
}

const HEADERS = {
  date: /^(value ?date|trans(action|\.)? ?date|date|posting date|txn\.? date)$/,
  narration: /narration|description|details|remarks|particulars|memo/,
  reference: /reference|^ref\b|ref\.? ?no|transaction id|session id|cheque/,
  debit: /^(debit|debits|withdrawals?|dr|money out|paid out)(\s*\(.*\))?$/,
  credit: /^(credit|credits|deposits?|lodgements?|cr|money in|paid in)(\s*\(.*\))?$/,
  amount: /^amount(\s*\(.*\))?$/,
  direction: /^(type|dr\/cr|cr\/dr|d\/c|c\/d|debit\/credit)$/,
  balance: /balance/,
};

/**
 * Reads a bank statement CSV: finds the header row, then each transaction's date,
 * narration, reference, amount (from Debit and Credit columns, or a signed Amount with an
 * optional Dr/Cr column) and balance. Rows with no amount, like an opening balance, are
 * skipped; rows that can't be read are reported, not guessed at.
 */
export function parseStatement(text: string): { lines: StatementLine[]; problems: string[] } {
  const rows = parseCsv(text);
  const problems: string[] = [];
  const headerAt = rows.findIndex((r) => {
    const h = r.map((c) => c.trim().toLowerCase());
    return (
      h.some((c) => HEADERS.date.test(c)) &&
      h.some((c) => HEADERS.narration.test(c)) &&
      (h.some((c) => HEADERS.amount.test(c)) ||
        (h.some((c) => HEADERS.debit.test(c)) && h.some((c) => HEADERS.credit.test(c))))
    );
  });
  if (headerAt < 0) {
    return {
      lines: [],
      problems: [
        'No header row found. The statement needs columns for the date, the narration (or description), and either Debit and Credit or Amount.',
      ],
    };
  }
  const header = rows[headerAt].map((c) => c.trim().toLowerCase());
  const col = (re: RegExp) => header.findIndex((c) => re.test(c));
  const at = {
    date: col(HEADERS.date),
    narration: col(HEADERS.narration),
    reference: col(HEADERS.reference),
    debit: col(HEADERS.debit),
    credit: col(HEADERS.credit),
    amount: col(HEADERS.amount),
    direction: col(HEADERS.direction),
    balance: col(HEADERS.balance),
  };

  const lines: StatementLine[] = [];
  rows.slice(headerAt + 1).forEach((r, i) => {
    const rowNo = headerAt + i + 2;
    const get = (index: number) => (index >= 0 ? (r[index] ?? '').trim() : '');
    let amount: bigint | null;
    if (at.debit >= 0 && at.credit >= 0) {
      const debit = statementAmount(get(at.debit));
      const credit = statementAmount(get(at.credit));
      amount = debit === null || credit === null ? null : credit - (debit < 0n ? -debit : debit);
    } else {
      amount = statementAmount(get(at.amount));
      const dir = get(at.direction).toLowerCase();
      if (amount !== null && /^(d|dr|debit)$/.test(dir) && amount > 0n) amount = -amount;
    }
    if (amount === null) {
      problems.push(`Row ${rowNo}: the amount can't be read`);
      return;
    }
    if (amount === 0n) return;
    const date = statementDate(get(at.date));
    if (!date) {
      problems.push(`Row ${rowNo}: "${get(at.date)}" isn't a date`);
      return;
    }
    const balance = at.balance >= 0 ? statementAmount(get(at.balance)) : null;
    lines.push({
      value_date: date,
      narration: get(at.narration),
      reference: get(at.reference) || null,
      amount_kobo: amount.toString(),
      balance_kobo: balance === null ? null : balance.toString(),
    });
  });
  return { lines, problems };
}

// ---------- Simulated bank (demo and development only) ----------

/**
 * A statement as the bank would send it once it has paid these payments and received
 * these pledge payments, for trying the flow without a bank. Same layout as a common
 * Nigerian bank export.
 */
export function simulatedStatementCsv(
  paid: { reference: string; account_name: string; amount_kobo: string }[],
  received: { reference: string; investor: string; amount_kobo: string }[],
  date = new Date(),
): string {
  const day = date.toISOString().slice(0, 10);
  const shown = `${day.slice(8, 10)}-${MONTHS[+day.slice(5, 7) - 1].replace(/^./, (c) => c.toUpperCase())}-${day.slice(0, 4)}`;
  let balance = 250_000_000_00n;
  let n = 0;
  const ref = () => `SIM${day.replace(/-/g, '')}${String(++n).padStart(4, '0')}`;
  const rows: string[][] = [];
  for (const r of received) {
    balance += BigInt(r.amount_kobo);
    rows.push([
      shown,
      `NIP TRF FROM ${r.investor.toUpperCase()} ${r.reference}`,
      ref(),
      '',
      csvNaira(r.amount_kobo),
      csvNaira(balance.toString()),
    ]);
  }
  for (const p of paid) {
    balance -= BigInt(p.amount_kobo);
    rows.push([
      shown,
      `${p.reference} TRF TO ${p.account_name.toUpperCase()}`,
      ref(),
      csvNaira(p.amount_kobo),
      '',
      csvNaira(balance.toString()),
    ]);
  }
  return toCsv(rows, [
    ['Trans. Date', (r) => r[0]],
    ['Narration', (r) => r[1]],
    ['Reference', (r) => r[2]],
    ['Debit', (r) => r[3]],
    ['Credit', (r) => r[4]],
    ['Balance', (r) => r[5]],
  ]);
}
