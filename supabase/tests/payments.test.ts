import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { mockGateway, simulatedResult } from '../functions/_shared/payments/mock';
import {
  hmacSha512,
  paystackEmail,
  paystackFee,
  paystackFeeFor,
  paystackGateway,
} from '../functions/_shared/payments/paystack';
import { gatewayFromEnv } from '../functions/_shared/payments/providers';
import {
  recordPaymentResult,
  startPledgePayment,
  type PaymentStore,
} from '../functions/_shared/payments/run';
import { seedDemo } from '../seed/seed';
import { asService, asUser, createDb, pgError, type Tx } from './db';
import { pgliteApi } from './pglite-api';

describe('Paystack adapter', () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const paystack = (status: number, body: unknown) =>
    paystackGateway({
      secretKey: 'sk_test_x',
      fetch: (async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(body), { status });
      }) as unknown as typeof fetch,
    });

  it('adds a fee so the trustee receives the pledge in full', () => {
    for (const amount of [
      1_000_00n,
      2_400_00n,
      50_000_00n,
      120_000_00n,
      500_000_00n,
      10_000_000_00n,
    ]) {
      const fee = paystackFeeFor(amount);
      expect(amount + fee - paystackFee(amount + fee)).toBe(amount);
      // …and no more than needed.
      expect(amount + fee - 1n - paystackFee(amount + fee - 1n)).toBeLessThan(amount);
    }
    expect(paystackFeeFor(10_000_000_00n)).toBe(2_000_00n); // capped
  });

  it('gives Paystack an address it accepts for demo accounts, and real ones as they are', () => {
    expect(paystackEmail('investor@agrowth.test')).toBe('investor.agrowth.test@example.com');
    expect(paystackEmail('Ada.Obi@Agrowth.TEST')).toBe('ada.obi.agrowth.test@example.com');
    expect(paystackEmail('someone@localhost')).toBe('someone.localhost@example.com');
    expect(paystackEmail(' ada@gmail.com ')).toBe('ada@gmail.com');
    expect(paystackEmail('finance@agrowth.ng')).toBe('finance@agrowth.ng');
  });

  it('opens a checkout with the charge, reference and return page', async () => {
    const { checkoutUrl } = await paystack(200, {
      status: true,
      data: { authorization_url: 'https://checkout.paystack.com/abc', reference: 'AGC-1' },
    }).startCheckout({
      reference: 'AGC-1',
      chargeKobo: 50_761_00n,
      email: 'ada@example.com',
      returnUrl: 'https://app.example/portfolio',
      metadata: { pledge_reference: 'AGR-7KQ2MX4P' },
    });
    expect(checkoutUrl).toBe('https://checkout.paystack.com/abc');
    const call = calls.at(-1)!;
    expect(call.url).toBe('https://api.paystack.co/transaction/initialize');
    expect((call.init!.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_x');
    expect(JSON.parse(call.init!.body as string)).toMatchObject({
      amount: '5076100',
      reference: 'AGC-1',
      currency: 'NGN',
      callback_url: 'https://app.example/portfolio',
    });
  });

  it('reads a verified payment, and treats abandoned ones as still open', async () => {
    const paid = await paystack(200, {
      status: true,
      data: {
        status: 'success',
        amount: 5076100,
        id: 4099,
        channel: 'card',
        paid_at: '2026-11-09T10:00:00Z',
      },
    }).verify('AGC-1');
    expect(paid).toMatchObject({
      succeeded: true,
      paidKobo: 5076100n,
      providerReference: '4099',
      channel: 'card',
    });
    expect(calls.at(-1)!.url).toBe('https://api.paystack.co/transaction/verify/AGC-1');

    const open = await paystack(200, { status: true, data: { status: 'abandoned' } }).verify(
      'AGC-1',
    );
    expect(open).toMatchObject({ succeeded: false, pending: true });
    const failed = await paystack(200, {
      status: true,
      data: { status: 'failed', gateway_response: 'Declined' },
    }).verify('AGC-1');
    expect(failed).toMatchObject({ succeeded: false, pending: false, message: 'Declined' });
  });

  it('accepts only webhooks signed with the secret key', async () => {
    const body = JSON.stringify({
      event: 'charge.success',
      data: { reference: 'AGC-1', status: 'success', amount: 100, id: 7 },
    });
    const gw = paystack(200, {});
    const signed = new Headers({ 'x-paystack-signature': await hmacSha512('sk_test_x', body) });
    expect(await gw.parseWebhook(body, signed)).toMatchObject({
      reference: 'AGC-1',
      succeeded: true,
    });
    const forged = new Headers({ 'x-paystack-signature': await hmacSha512('wrong', body) });
    expect(await gw.parseWebhook(body, forged)).toBeNull();
    const other = JSON.stringify({ event: 'transfer.success', data: {} });
    expect(
      await gw.parseWebhook(
        other,
        new Headers({ 'x-paystack-signature': await hmacSha512('sk_test_x', other) }),
      ),
    ).toBe('ignored');
  });

  it('is off until a provider is chosen', () => {
    expect(gatewayFromEnv(() => undefined)).toBeNull();
    expect(gatewayFromEnv((k) => (k === 'PAYMENTS_PROVIDER' ? 'mock' : undefined))!.name).toBe(
      'mock',
    );
    expect(() =>
      gatewayFromEnv((k) => (k === 'PAYMENTS_PROVIDER' ? 'paystack' : undefined)),
    ).toThrow(/PAYSTACK_SECRET_KEY/);
  });
});

/**
 * Paying a pledge online, on the demo portfolio, with the simulated gateway, through the
 * same code the payments Edge Functions run.
 */
describe('online pledge payments', () => {
  let db: PGlite;
  let funmilayo: string;
  let adaeze: string;
  let trustee: string;
  let pledge: { id: string; amount_kobo: string; cycle_id: string };
  const gateway = mockGateway(() => 'https://app.example');

  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows[0];
  const as = async <T>(user: string, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (tx: Tx) => (await tx.query<T>(sql, params)).rows);

  const store = (investor: string): PaymentStore => ({
    pledgeAmount: async (id) => {
      const rows = await as<{ amount_kobo: string }>(
        investor,
        `select amount_kobo from public.investment_pledges where id = $1`,
        [id],
      );
      if (!rows[0]) throw new Error('Pledge not found');
      return BigInt(rows[0].amount_kobo);
    },
    start: async (id, provider, fee) =>
      (
        await as<{ r: never }>(investor, `select public.start_online_payment($1, $2, $3) as r`, [
          id,
          provider,
          fee.toString(),
        ])
      )[0].r,
    complete: (r, _provider) =>
      asService(db, async (tx) => {
        const { rows } = await tx.query<{ s: string }>(
          `select public.complete_online_payment($1, $2, $3, $4, $5, $6, $7) as s`,
          [
            r.reference,
            r.succeeded,
            r.paidKobo?.toString() ?? null,
            r.providerReference,
            r.channel,
            r.paidAt,
            r.message,
          ],
        );
        return rows[0].s as never;
      }),
  });
  const start = (investor = funmilayo) =>
    startPledgePayment(gateway, store(investor), pledge.id, 'https://app.example/portfolio');
  const pay = (reference: string, charge: string, ok = true) =>
    recordPaymentResult(store(funmilayo), 'mock', simulatedResult(reference, BigInt(charge), ok));
  const pledgeStatus = async () =>
    (
      await one<{ status: string }>(`select status from public.investment_pledges where id = $1`, [
        pledge.id,
      ])
    ).status;

  beforeAll(async () => {
    db = await createDb();
    const pdf = readFileSync(
      join(import.meta.dirname, '..', '..', 'docs', 'demo', 'sample-offtake-agreement.pdf'),
    );
    await seedDemo(pgliteApi(db), { password: 'unused', offtakePdf: pdf, insurancePdf: pdf });
    const id = async (email: string) =>
      (await one<{ id: string }>(`select id from public.profiles where email = $1`, [email])).id;
    funmilayo = await id('investor.retail@agrowth.test');
    adaeze = await id('investor@agrowth.test');
    trustee = await id('trustee@agrowth.test');
    pledge = await one(
      `select id, amount_kobo, cycle_id from public.investment_pledges
        where investor_id = $1 and status = 'pending'`,
      [funmilayo],
    );
  }, 300_000);

  it('waits for the cooling-off, and only the pledge’s investor can pay it', async () => {
    expect((await pgError(start())).message).toMatch(/once your cooling-off period ends/);
    await db.query(
      `update public.investment_pledges set cooling_off_ends_at = now() - interval '1 minute' where id = $1`,
      [pledge.id],
    );
    expect((await pgError(start(adaeze))).message).toMatch(/Pledge not found/);
  });

  it('refuses simulated payments unless an admin allows them', async () => {
    await db.query(`update public.investor_settings set allow_simulated_payments = false`);
    expect((await pgError(start())).message).toMatch(/Simulated payments are switched off/);
    await db.query(`update public.investor_settings set allow_simulated_payments = true`);
  });

  it('records a declined payment and lets the investor try again', async () => {
    const attempt = await start();
    expect(attempt.checkoutUrl).toMatch(/^https:\/\/app\.example\/pay\/simulated\?reference=AGC-/);
    expect(await pay(attempt.reference, attempt.chargeKobo, false)).toBe('failed');
    expect(await pledgeStatus()).toBe('pending');
  });

  it('confirms the pledge from a successful payment, once', async () => {
    const attempt = await start();
    expect(attempt.chargeKobo).toBe(String(pledge.amount_kobo)); // the simulated gateway charges no fee
    expect(await pay(attempt.reference, attempt.chargeKobo)).toBe('succeeded');
    // The webhook and the investor's return can both report it: only the first counts.
    expect(await pay(attempt.reference, attempt.chargeKobo)).toBe('succeeded');

    expect(await pledgeStatus()).toBe('paid');
    const deposit = await one<{
      trustee_reference: string;
      amount_kobo: string;
      recorded_by: string;
    }>(
      `select fc.trustee_reference, fc.amount_kobo, fc.recorded_by
         from public.funding_contributions fc join public.investment_pledges p on p.contribution_id = fc.id
        where p.id = $1`,
      [pledge.id],
    );
    expect(deposit).toMatchObject({ recorded_by: funmilayo });
    expect(String(deposit.amount_kobo)).toBe(String(pledge.amount_kobo));
    expect(deposit.trustee_reference).toMatch(/^MOCK-SIM/);
    const entries = await one<{ n: number }>(
      `select count(*)::int as n from public.journal_entries where reference = $1`,
      [deposit.trustee_reference],
    );
    expect(entries.n).toBe(1);
    // The signed-in user isn't changed for the rest of the transaction.
    expect(await one(`select current_setting('request.jwt.claims', true) as c`)).toEqual({ c: '' });
  });

  it('marks a payment for a pledge that can no longer take it for refund', async () => {
    // A second checkout opened before the first payment landed, then paid too.
    await db.query(
      `insert into public.online_payments (reference, pledge_id, investor_id, cycle_id, provider,
         amount_kobo, fee_kobo, charge_kobo)
       values ('AGC-DOUBLE', $1, $2, $3, 'mock', $4, 0, $4)`,
      [pledge.id, funmilayo, pledge.cycle_id, pledge.amount_kobo],
    );
    expect(await pay('AGC-DOUBLE', pledge.amount_kobo)).toBe('needs_refund');
    expect(
      (
        await one<{ note: string }>(
          `select note from public.online_payments where reference = 'AGC-DOUBLE'`,
        )
      ).note,
    ).toMatch(/was already paid/);
  });

  it('flags a payment of the wrong amount for review', async () => {
    await db.query(
      `insert into public.online_payments (reference, pledge_id, investor_id, cycle_id, provider,
         amount_kobo, fee_kobo, charge_kobo)
       values ('AGC-SHORT', $1, $2, $3, 'mock', $4, 0, $4)`,
      [pledge.id, funmilayo, pledge.cycle_id, pledge.amount_kobo],
    );
    expect(await pay('AGC-SHORT', '100')).toBe('needs_review');
  });

  it('lets only the payments service record results, and the trustee resolve problems', async () => {
    const forged = await pgError(
      as(funmilayo, `select public.complete_online_payment('AGC-SHORT', true, 100)`),
    );
    expect(forged.code).toBe('42501');
    const { id } = await one<{ id: string }>(
      `select id from public.online_payments where reference = 'AGC-DOUBLE'`,
    );
    expect(
      (await pgError(as(funmilayo, `select public.resolve_online_payment($1, 'x')`, [id]))).code,
    ).toBe('PT403');
    await as(trustee, `select public.resolve_online_payment($1, 'Refunded, NIP-77')`, [id]);
    expect(await one(`select status from public.online_payments where id = $1`, [id])).toEqual({
      status: 'resolved',
    });
  });

  it('shows investors only their own payments', async () => {
    expect((await as(funmilayo, `select 1 from public.online_payments`)).length).toBeGreaterThan(0);
    expect(await as(adaeze, `select 1 from public.online_payments`)).toHaveLength(0);
    expect((await as(trustee, `select 1 from public.online_payments`)).length).toBe(4);
  });
});
