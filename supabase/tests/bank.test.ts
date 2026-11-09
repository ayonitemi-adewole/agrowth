import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedDemo } from '../seed/seed';
import { asUser, createDb, pgError, type Tx } from './db';
import { pgliteApi } from './pglite-api';

interface Payment {
  kind: string;
  item_id: string;
  reference: string;
  payee_name: string;
  account_number: string | null;
  amount_kobo: string;
  paid: boolean;
  problem: string | null;
  batch_id: string | null;
}

const today = new Date().toISOString().slice(0, 10);

/**
 * The trustee's bank files: payments go out in a payment file and are confirmed from the
 * bank statement; pledge payments in the statement are matched to their pledges. Run on
 * the demo portfolio, which leaves a vendor payment unpaid, a pledge in its cooling-off
 * and a harvested cycle to settle.
 */
describe('trustee bank files', () => {
  let db: PGlite;
  let trustee: string;
  let auditor: string;
  let manager: string;
  let vendorPayment: Payment;
  let disbursement: Payment;
  let noAccount: Payment;
  let batch: string;

  const as = async <T>(user: string, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (tx: Tx) => (await tx.query<T>(sql, params)).rows);
  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows[0];
  const payments = (user = trustee) => as<Payment>(user, `select * from public.trustee_payments()`);
  const importStatement = async (lines: object[], file = 'statement.csv') =>
    (
      await as<{ r: Record<string, number> }>(
        trustee,
        `select public.import_bank_statement($1, $2) as r`,
        [file, JSON.stringify(lines)],
      )
    )[0].r;
  const line = (bankReference: string) =>
    one<{ id: string; status: string; note: string; matched_kind: string }>(
      `select id, status, note, matched_kind from public.bank_statement_lines
        where bank_reference = $1`,
      [bankReference],
    );

  beforeAll(async () => {
    db = await createDb();
    const pdf = readFileSync(
      join(import.meta.dirname, '..', '..', 'docs', 'demo', 'sample-offtake-agreement.pdf'),
    );
    await seedDemo(pgliteApi(db), { password: 'unused', offtakePdf: pdf, insurancePdf: pdf });
    const id = async (email: string) =>
      (await one<{ id: string }>(`select id from public.profiles where email = $1`, [email])).id;
    trustee = await id('trustee@agrowth.test');
    auditor = await id('auditor@agrowth.test');
    manager = await id('manager@agrowth.test');

    // Two release instructions on the cycle under way: one naming a bank account, one not.
    // (Inserted directly; the release rules themselves are tested in cycles.test.ts.)
    const m = await one<{ id: string; cycle_id: string; profile: string }>(
      `select m.id, m.cycle_id, c.manager_id as profile from public.milestones m
         join public.cycles c on c.id = m.cycle_id
        where c.status = 'in_progress' and m.sequence = 1 limit 1`,
    );
    await db.query(
      `insert into public.disbursements
         (cycle_id, milestone_id, payee_kind, payee_name, payee_account, purpose, amount_kobo, instructed_by)
       values ($1, $2, 'service_provider', 'Zaria Tractor Hire', 'Access Bank 0123456789',
               'Second ploughing', 2500000, $3),
              ($1, $2, 'farmer_cash', 'Amina Ibrahim', 'Paid at the cooperative office',
               'Labour', 500000, $3)`,
      [m.cycle_id, m.id, manager],
    );
  }, 300_000);

  it('lists the payments to make, and why some can only be paid by hand', async () => {
    const list = await payments();
    vendorPayment = list.find((p) => p.kind === 'vendor_payment')!;
    disbursement = list.find((p) => p.payee_name === 'Zaria Tractor Hire')!;
    noAccount = list.find((p) => p.payee_name === 'Amina Ibrahim')!;

    expect(vendorPayment).toMatchObject({ paid: false, problem: null, batch_id: null });
    expect(vendorPayment.reference).toMatch(/^AGP-[0-9A-F]{10}$/);
    expect(vendorPayment.account_number).toMatch(/^[0-9]{10}$/);
    expect(disbursement).toMatchObject({ account_number: '0123456789', problem: null });
    expect(noAccount.problem).toMatch(/no 10-digit account number/);
    // Payments already confirmed during the seed are not waiting.
    expect(list.every((p) => !p.paid)).toBe(true);

    expect(await payments(auditor)).toHaveLength(list.length);
    expect((await pgError(payments(manager))).code).toBe('PT403');
  });

  it('marks settlement payouts with no bank account on file for paying by hand', async () => {
    const { id } = await one<{ id: string }>(
      `select id from public.cycles where status = 'harvested'`,
    );
    await as(trustee, `select public.settle_cycle($1)`, [id]);
    const fee = (await payments()).find(
      (p) => p.kind === 'settlement_payout' && p.payee_name.startsWith('Platform operator'),
    )!;
    expect(fee.problem).toMatch(/No bank account on file/);
  });

  it('puts payments in a payment file once, and refuses ones it cannot pay', async () => {
    const items = [vendorPayment, disbursement].map((p) => ({ kind: p.kind, item_id: p.item_id }));
    batch = (
      await as<{ id: string }>(trustee, `select public.create_payment_batch($1) as id`, [
        JSON.stringify(items),
      ])
    )[0].id;
    const file = await one<{ item_count: number; total_kobo: string }>(
      `select item_count, total_kobo from public.payment_batches where id = $1`,
      [batch],
    );
    expect(file.item_count).toBe(2);
    expect(BigInt(file.total_kobo)).toBe(
      BigInt(vendorPayment.amount_kobo) + BigInt(disbursement.amount_kobo),
    );
    expect((await payments()).find((p) => p.item_id === vendorPayment.item_id)!.batch_id).toBe(
      batch,
    );

    const again = await pgError(
      as(trustee, `select public.create_payment_batch($1)`, [JSON.stringify(items.slice(0, 1))]),
    );
    expect(again.message).toMatch(/already in a payment file/);
    const manual = await pgError(
      as(trustee, `select public.create_payment_batch($1)`, [
        JSON.stringify([{ kind: noAccount.kind, item_id: noAccount.item_id }]),
      ]),
    );
    expect(manual.message).toMatch(/no 10-digit account number/);
    expect(
      (
        await pgError(
          as(manager, `select public.create_payment_batch($1)`, [JSON.stringify(items)]),
        )
      ).code,
    ).toBe('PT403');
  });

  it('confirms payments and pledges from the bank statement, and flags the rest', async () => {
    const pledge = await one<{ id: string; reference: string; amount_kobo: string }>(
      `select id, reference, amount_kobo from public.investment_pledges where status = 'pending' and cooling_off_ends_at > now() limit 1`,
    );
    const summary = await importStatement([
      {
        value_date: today,
        // Banks reformat narrations: the reference is still found without its hyphen.
        narration: `TRF/${vendorPayment.reference.replace('-', '').toLowerCase()} ZARIA AGRO`,
        reference: 'NIP-0001',
        amount_kobo: `-${vendorPayment.amount_kobo}`,
      },
      {
        value_date: today,
        narration: `${disbursement.reference} Second ploughing`,
        reference: 'NIP-0002',
        amount_kobo: `-${BigInt(disbursement.amount_kobo) + 100n}`,
      },
      {
        value_date: today,
        narration: `Investment ${pledge.reference}`,
        reference: 'NIP-0003',
        amount_kobo: pledge.amount_kobo,
      },
      {
        value_date: today,
        narration: 'Transfer from Kano ADP',
        reference: 'NIP-0004',
        amount_kobo: '10000000',
      },
      {
        value_date: today,
        narration: 'SMS ALERT CHARGES',
        amount_kobo: '-4000',
        balance_kobo: '1',
      },
    ]);
    expect(summary).toEqual({
      lines: 5,
      duplicates: 0,
      confirmed: 1,
      already_recorded: 0,
      needs_review: 2,
      unmatched: 2,
    });

    // The vendor is paid, under the bank's reference, and the ledger has it.
    const paid = await one<{
      paid_at: string;
      trustee_reference: string;
      journal_entry_id: string;
    }>(
      `select paid_at, trustee_reference, journal_entry_id from public.voucher_redemptions where id = $1`,
      [vendorPayment.item_id],
    );
    expect(paid).toMatchObject({ trustee_reference: 'NIP-0001' });
    expect(paid.journal_entry_id).toBeTruthy();
    expect(await line('NIP-0001')).toMatchObject({
      status: 'confirmed',
      matched_kind: 'vendor_payment',
    });

    expect((await line('NIP-0002')).note).toMatch(/but ₦25,001\.00 left the account/);
    // The investor is still in their cooling-off period, so it can't be added yet.
    expect((await line('NIP-0003')).note).toMatch(/cooling-off/);
    expect((await line('NIP-0004')).note).toMatch(/record it on the cycle with reference NIP-0004/);
  });

  it('skips lines already imported', async () => {
    const summary = await importStatement(
      [
        { value_date: today, narration: 'anything', reference: 'nip-0001', amount_kobo: '-1' },
        {
          value_date: today,
          narration: 'SMS ALERT CHARGES',
          amount_kobo: '-4000',
          balance_kobo: '1',
        },
      ],
      'overlapping.csv',
    );
    expect(summary).toMatchObject({ lines: 0, duplicates: 2 });
  });

  it('confirms a pledge once its cooling-off is over', async () => {
    await db.query(
      `update public.investment_pledges set cooling_off_ends_at = now() - interval '1 hour'
        where status = 'pending'`,
    );
    const { id } = await line('NIP-0003');
    expect(
      (await as<{ s: string }>(trustee, `select public.retry_statement_line($1) as s`, [id]))[0].s,
    ).toBe('confirmed');
    const pledge = await one<{ status: string }>(
      `select p.status from public.investment_pledges p
         join public.funding_contributions fc on fc.id = p.contribution_id
        where fc.trustee_reference = 'NIP-0003'`,
    );
    expect(pledge.status).toBe('paid');
  });

  it('recognises a deposit the trustee then records by hand', async () => {
    const c = await one<{ id: string; funding_source: string }>(
      `select id, funding_source from public.cycles where status = 'open_for_funding' limit 1`,
    );
    await as(trustee, `select public.record_funding($1, 'Kano ADP', $2, 10000000, 'NIP-0004')`, [
      c.id,
      c.funding_source === 'programme' ? 'programme' : 'investor',
    ]);
    const { id } = await line('NIP-0004');
    expect(
      (await as<{ s: string }>(trustee, `select public.retry_statement_line($1) as s`, [id]))[0].s,
    ).toBe('already_recorded');
  });

  it('flags a second payment of something already paid', async () => {
    await importStatement([
      {
        value_date: today,
        narration: `${vendorPayment.reference} repeat`,
        reference: 'NIP-0005',
        amount_kobo: `-${vendorPayment.amount_kobo}`,
      },
    ]);
    expect(await line('NIP-0005')).toMatchObject({
      status: 'needs_review',
      note: expect.stringMatching(/already confirmed \(reference NIP-0001\)/),
    });
  });

  it('withdraws a rejected payment from its file, but never a paid one', async () => {
    const withdraw = (p: Payment, reason: string) =>
      as(trustee, `select public.withdraw_batch_payment($1, $2, $3, $4)`, [
        batch,
        p.kind,
        p.item_id,
        reason,
      ]);
    expect((await pgError(withdraw(disbursement, ' '))).message).toMatch(/Say why/);
    expect((await pgError(withdraw(vendorPayment, 'oops'))).code).toBe('PT409');
    await withdraw(disbursement, 'Bank rejected: account name mismatch');
    expect((await payments()).find((p) => p.item_id === disbursement.item_id)!.batch_id).toBeNull();
    // It can go in a new file.
    await as(trustee, `select public.create_payment_batch($1)`, [
      JSON.stringify([{ kind: disbursement.kind, item_id: disbursement.item_id }]),
    ]);
  });

  it('lets the trustee dismiss a line with a note; others only read', async () => {
    const charges = await one<{ id: string }>(
      `select id from public.bank_statement_lines where narration = 'SMS ALERT CHARGES'`,
    );
    const dismiss = (user: string, note: string) =>
      as(user, `select public.dismiss_statement_line($1, $2)`, [charges.id, note]);
    expect((await pgError(dismiss(trustee, ''))).message).toMatch(/Say what this line is/);
    expect((await pgError(dismiss(auditor, 'Bank charges'))).code).toBe('PT403');
    await dismiss(trustee, 'Bank charges');
    expect((await pgError(dismiss(trustee, 'again'))).code).toBe('PT409');

    expect(await as(auditor, `select 1 from public.bank_statement_lines`)).toHaveLength(6);
    expect(await as(manager, `select 1 from public.bank_statement_lines`)).toHaveLength(0);
    expect(
      (await pgError(as(manager, `select public.import_bank_statement('x', '[]')`))).code,
    ).toBe('PT403');
  });
});
