import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { hmacSha512 } from '../functions/_shared/payments/paystack';
import { bankCode, sameAccountHolder } from '../functions/_shared/payouts/banks';
import { mockPayouts } from '../functions/_shared/payouts/mock';
import { paystackPayouts } from '../functions/_shared/payouts/paystack';
import { payoutsFromEnv } from '../functions/_shared/payouts/providers';
import {
  recordTransferResult,
  sendPayouts,
  type Payable,
  type PayoutStore,
} from '../functions/_shared/payouts/run';
import type { PayoutGateway } from '../functions/_shared/payouts/types';
import { seedDemo } from '../seed/seed';
import { asService, asUser, createDb, pgError, type Tx } from './db';
import { pgliteApi } from './pglite-api';

describe('payout helpers', () => {
  it('knows the codes of common banks', () => {
    expect(bankCode('GTBank')).toBe('058');
    expect(bankCode('Access Bank')).toBe('044');
    expect(bankCode('Moon Bank')).toBeNull();
  });

  it('matches account holders however the bank writes the name', () => {
    expect(sameAccountHolder('Adaeze Okoro', 'OKORO ADAEZE CHIOMA')).toBe(true);
    expect(sameAccountHolder('Zaria Agro Inputs Ltd', 'ZARIA AGRO INPUTS LIMITED')).toBe(true);
    expect(sameAccountHolder('Adaeze Okoro', 'OKORO EMEKA')).toBe(false);
    expect(sameAccountHolder('Adaeze Okoro', 'CHIDINMA OKONKWO-BELLO')).toBe(false);
  });

  it('keeps payouts off until switched on', () => {
    expect(payoutsFromEnv(() => undefined)).toBeNull();
    const env = { PAYOUTS_ENABLED: 'true', PAYMENTS_PROVIDER: 'mock' };
    expect(payoutsFromEnv((k) => env[k as keyof typeof env])!.name).toBe('mock');
    expect(() => payoutsFromEnv((k) => (k === 'PAYOUTS_ENABLED' ? 'true' : undefined))).toThrow(
      /PAYMENTS_PROVIDER/,
    );
  });
});

describe('Paystack transfers adapter', () => {
  const calls: { url: string; body: unknown }[] = [];
  const paystack = (responses: Record<string, [number, unknown]>) =>
    paystackPayouts({
      secretKey: 'sk_test_x',
      fetch: (async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname;
        calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
        const [status, body] = responses[path] ?? [404, {}];
        return new Response(JSON.stringify(body), { status });
      }) as unknown as typeof fetch,
    });

  it('looks the account up, then adds the payee and sends from the balance', async () => {
    const gw = paystack({
      '/bank/resolve': [200, { status: true, data: { account_name: 'OKORO ADAEZE' } }],
      '/transferrecipient': [200, { status: true, data: { recipient_code: 'RCP_1' } }],
      '/transfer': [200, { status: true, data: { status: 'pending', transfer_code: 'TRF_1' } }],
    });
    expect(await gw.resolveAccount('0691234570', '044', 'x')).toBe('OKORO ADAEZE');
    expect(calls.at(-1)!.url).toBe(
      'https://api.paystack.co/bank/resolve?account_number=0691234570&bank_code=044',
    );
    const r = await gw.sendTransfer({
      reference: 'ref-0000000000000001',
      amountKobo: 12_345_00n,
      accountNumber: '0691234570',
      bankCode: '044',
      accountName: 'Adaeze Okoro',
      reason: 'AGP-0123456789 Settlement payout',
    });
    expect(calls.at(-2)!.body).toMatchObject({
      type: 'nuban',
      account_number: '0691234570',
      bank_code: '044',
    });
    expect(calls.at(-1)!.body).toMatchObject({
      source: 'balance',
      amount: '1234500',
      recipient: 'RCP_1',
      reference: 'ref-0000000000000001',
    });
    expect(r).toEqual({
      reference: 'ref-0000000000000001',
      outcome: 'sent',
      providerReference: 'TRF_1',
      message: null,
    });
  });

  it('says when the account asks for an OTP, or the account does not exist', async () => {
    const gw = paystack({
      '/bank/resolve': [422, { status: false, message: 'Could not resolve account name' }],
      '/transferrecipient': [200, { status: true, data: { recipient_code: 'RCP_1' } }],
      '/transfer': [200, { status: true, data: { status: 'otp', transfer_code: 'TRF_2' } }],
    });
    expect(await gw.resolveAccount('0000000000', '044', 'x')).toBeNull();
    const r = await gw.sendTransfer({
      reference: 'r',
      amountKobo: 1n,
      accountNumber: '1',
      bankCode: '044',
      accountName: 'A',
      reason: 'x',
    });
    expect(r).toMatchObject({ outcome: 'needs_otp', message: expect.stringMatching(/OTP/) });
  });

  it('reads signed transfer webhooks, and only those', async () => {
    const gw = paystack({});
    const body = JSON.stringify({
      event: 'transfer.success',
      data: { reference: 'ref-1', transfer_code: 'TRF_9' },
    });
    const signed = new Headers({ 'x-paystack-signature': await hmacSha512('sk_test_x', body) });
    expect(await gw.parseTransferWebhook(body, signed)).toEqual({
      reference: 'ref-1',
      outcome: 'paid',
      providerReference: 'TRF_9',
      message: null,
    });
    expect(
      await gw.parseTransferWebhook(body, new Headers({ 'x-paystack-signature': 'nope' })),
    ).toBeNull();
    const charge = JSON.stringify({ event: 'charge.success', data: { reference: 'AGC-1' } });
    expect(
      await gw.parseTransferWebhook(
        charge,
        new Headers({ 'x-paystack-signature': await hmacSha512('sk_test_x', charge) }),
      ),
    ).toBe('ignored');
  });
});

/**
 * Paying out through the gateway on the demo portfolio: the agro-dealer's unpaid voucher
 * payment, and release payments on the live maize cycle.
 */
describe('gateway payouts', () => {
  let db: PGlite;
  let trustee: string;
  let manager: string;
  let payables: (Payable & { payee_name: string; amount_kobo: string; problem: string | null })[];

  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows[0];
  const as = async <T>(user: string, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (tx: Tx) => (await tx.query<T>(sql, params)).rows);
  const store: PayoutStore = {
    start: async (items, provider) =>
      as(trustee, `select * from public.start_gateway_payouts($1, $2)`, [
        JSON.stringify(items),
        provider,
      ]),
    record: (id, status, ref, name, message) =>
      asService(db, async (tx) => {
        await tx.query(`select public.record_gateway_transfer($1, $2, $3, $4, $5)`, [
          id,
          status,
          ref,
          name,
          message,
        ]);
      }),
    complete: (id, ok, ref, message, reversed = false) =>
      asService(db, async (tx) => {
        const { rows } = await tx.query<{ s: string }>(
          `select public.complete_gateway_transfer($1, $2, $3, $4, $5) as s`,
          [id, ok, ref, message, reversed],
        );
        return rows[0].s as never;
      }),
  };
  const refresh = async () => {
    payables = await as(trustee, `select * from public.trustee_payments()`);
  };
  const pick = (kind: string) => payables.find((p) => p.kind === kind && !p.problem)!;
  let releases = 0;
  /** A fresh release instruction on the live maize cycle, paying a named account. */
  const newRelease = async () => {
    const m = await one<{ id: string; cycle_id: string }>(
      `select m.id, m.cycle_id from public.milestones m join public.cycles c on c.id = m.cycle_id
        where c.status = 'in_progress' and m.sequence = 1 limit 1`,
    );
    const name = `Tractor Hire ${++releases}`;
    await db.query(
      `insert into public.disbursements
         (cycle_id, milestone_id, payee_kind, payee_name, payee_account, purpose, amount_kobo, instructed_by)
       values ($1, $2, 'service_provider', $3, 'Access Bank 0123456789', 'Ploughing', 100000, $4)`,
      [m.cycle_id, m.id, name, manager],
    );
    await refresh();
    return payables.find((p) => p.payee_name === name)!;
  };
  /** A gateway that sends, then reports later. */
  const later: PayoutGateway = {
    ...mockPayouts,
    name: 'mock',
    sendTransfer: async (t) => ({
      reference: t.reference,
      outcome: 'sent',
      providerReference: 'TRF_LATER',
      message: null,
    }),
  };

  beforeAll(async () => {
    db = await createDb();
    const pdf = readFileSync(
      join(import.meta.dirname, '..', '..', 'docs', 'demo', 'sample-offtake-agreement.pdf'),
    );
    await seedDemo(pgliteApi(db), { password: 'unused', offtakePdf: pdf, insurancePdf: pdf });
    const id = async (email: string) =>
      (await one<{ id: string }>(`select id from public.profiles where email = $1`, [email])).id;
    trustee = await id('trustee@agrowth.test');
    manager = await id('manager@agrowth.test');
    await refresh();
  }, 300_000);

  it('pays a vendor through the gateway and confirms it in the books', async () => {
    const vendor = pick('vendor_payment');
    const [result] = await sendPayouts(mockPayouts, store, [vendor], {
      [vendor.item_id]: vendor.reference,
    });
    expect(result.status).toBe('paid');
    const paid = await one<{
      trustee_reference: string;
      paid_by: string;
      journal_entry_id: string;
    }>(
      `select trustee_reference, paid_by, journal_entry_id from public.voucher_redemptions where id = $1`,
      [vendor.item_id],
    );
    expect(paid.trustee_reference).toMatch(/^MOCK-SIMTRF/);
    expect(paid.paid_by).toBe(trustee);
    expect(paid.journal_entry_id).toBeTruthy();
    expect(await one(`select current_setting('request.jwt.claims', true) as c`)).toEqual({ c: '' });
  });

  it('holds a transfer when the bank holds the account for someone else, and sends nothing', async () => {
    await refresh();
    const payout = await newRelease();
    const wrongName: PayoutGateway = {
      ...mockPayouts,
      resolveAccount: async () => 'CHIDINMA OKONKWO-BELLO',
    };
    const [result] = await sendPayouts(wrongName, store, [payout], {});
    expect(result).toMatchObject({
      status: 'needs_review',
      message: expect.stringMatching(/CHIDINMA/),
    });
    expect(
      await one(`select status from public.disbursements where id = $1`, [payout.item_id]),
    ).toEqual({
      status: 'instructed',
    });

    // Held: it can't go in a bank file or a second transfer until the trustee lets it go.
    expect(
      (
        await pgError(
          as(trustee, `select public.create_payment_batch($1)`, [
            JSON.stringify([{ kind: payout.kind, item_id: payout.item_id }]),
          ]),
        )
      ).message,
    ).toMatch(/being paid through the payment gateway/);
    expect((await pgError(sendPayouts(mockPayouts, store, [payout], {}))).message).toMatch(
      /already being paid/,
    );
    expect(
      (await pgError(as(trustee, `select public.cancel_gateway_transfer($1, ' ')`, [result.id])))
        .code,
    ).toBe('PT400');
    await as(
      trustee,
      `select public.cancel_gateway_transfer($1, 'Nothing sent: wrong account holder')`,
      [result.id],
    );
    expect((await sendPayouts(mockPayouts, store, [payout], {}))[0].status).toBe('paid');
  });

  it('confirms a transfer when the gateway reports it later, once', async () => {
    await refresh();
    const payout = await newRelease();
    const [sent] = await sendPayouts(later, store, [payout], {});
    expect(sent.status).toBe('sent');
    const report = { reference: sent.id, providerReference: 'TRF_LATER', message: null };
    expect(await recordTransferResult(store, { ...report, outcome: 'paid' })).toBe('paid');
    expect(await recordTransferResult(store, { ...report, outcome: 'paid' })).toBe('paid');
    expect(
      await one(`select status, trustee_reference from public.disbursements where id = $1`, [
        payout.item_id,
      ]),
    ).toEqual({
      status: 'executed',
      trustee_reference: 'MOCK-TRF_LATER',
    });
    // Reversed after it was confirmed: held for the trustee to put right.
    expect(await recordTransferResult(store, { ...report, outcome: 'reversed' })).toBe(
      'needs_review',
    );
  });

  it('puts a failed transfer back with the payments waiting', async () => {
    await refresh();
    const payout = await newRelease();
    const [sent] = await sendPayouts(later, store, [payout], {});
    expect(
      await recordTransferResult(store, {
        reference: sent.id,
        outcome: 'failed',
        providerReference: null,
        message: 'Paystack: account closed',
      }),
    ).toBe('failed');
    await refresh();
    expect(payables.find((p) => p.item_id === payout.item_id)).toBeTruthy();
  });

  it('is the trustee’s alone, and only the payments service records outcomes', async () => {
    await refresh();
    const payout = await newRelease();
    expect(
      (
        await pgError(
          as(manager, `select * from public.start_gateway_payouts($1, 'mock')`, [
            JSON.stringify([{ kind: payout.kind, item_id: payout.item_id, bank_code: '044' }]),
          ]),
        )
      ).code,
    ).toBe('PT403');
    const { id } = await one<{ id: string }>(`select id from public.gateway_transfers limit 1`);
    expect(
      (await pgError(as(trustee, `select public.complete_gateway_transfer($1, true)`, [id]))).code,
    ).toBe('42501');

    await db.query(`update public.investor_settings set allow_simulated_payments = false`);
    expect((await pgError(sendPayouts(mockPayouts, store, [payout], {}))).message).toMatch(
      /Simulated payments are switched off/,
    );
    await db.query(`update public.investor_settings set allow_simulated_payments = true`);
  });

  it('refuses payees whose bank the gateway can’t address, and payments in a bank file', async () => {
    await refresh();
    const payout = await newRelease();
    expect(
      (await pgError(sendPayouts(mockPayouts, store, [{ ...payout, bank_name: 'Moon Bank' }], {})))
        .message,
    ).toMatch(/isn't one the gateway can pay/);
    await as(trustee, `select public.create_payment_batch($1)`, [
      JSON.stringify([{ kind: payout.kind, item_id: payout.item_id }]),
    ]);
    expect((await pgError(sendPayouts(mockPayouts, store, [payout], {}))).message).toMatch(
      /in a bank payment file/,
    );
  });
});
