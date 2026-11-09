import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedDemo } from '../seed/seed';
import { asUser, createDb, pgError, type Tx } from './db';
import { pgliteApi } from './pglite-api';

/**
 * Scanning a voucher slip's QR code at the counter, on the demo portfolio: the live maize
 * cycle's vouchers, at the agro-dealer the demo vendor account works for.
 */
describe('scanning vouchers', () => {
  let db: PGlite;
  let manager: string;
  let vendor: string;
  let admin: string;
  let voucher: { id: string; code: string; remaining: string; phone: string };
  let token: string;
  const link = (t: string) => `https://app.example/redeem?v=${t}`;

  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows[0];
  const as = async <T>(user: string, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (tx: Tx) => (await tx.query<T>(sql, params)).rows);
  const check = async (scanned: string, phone: string | null = null) =>
    (
      await as<{ r: Record<string, unknown> }>(
        vendor,
        `select public.check_scanned_voucher($1, $2) as r`,
        [scanned, phone],
      )
    )[0].r;

  beforeAll(async () => {
    db = await createDb();
    const pdf = readFileSync(
      join(import.meta.dirname, '..', '..', 'docs', 'demo', 'sample-offtake-agreement.pdf'),
    );
    await seedDemo(pgliteApi(db), { password: 'unused', offtakePdf: pdf, insurancePdf: pdf });
    const id = async (email: string) =>
      (await one<{ id: string }>(`select id from public.profiles where email = $1`, [email])).id;
    manager = await id('manager@agrowth.test');
    vendor = await id('vendor@agrowth.test');
    admin = await id('admin@agrowth.test');
    voucher = await one(
      `select v.id, v.code, (v.value_kobo - v.redeemed_kobo)::text as remaining, f.phone
         from public.vouchers v join public.farmers f on f.id = v.farmer_id
        where v.status = 'active' and v.redeemed_kobo = 0 limit 1`,
    );
  }, 300_000);

  it('gives every voucher a secret scan token, for staff printing slips only', async () => {
    const { cycle_id } = await one<{ cycle_id: string }>(
      `select cycle_id from public.vouchers where id = $1`,
      [voucher.id],
    );
    const tokens = await as<{ voucher_id: string; token: string }>(
      manager,
      `select * from public.voucher_slip_tokens($1)`,
      [cycle_id],
    );
    const vouchers = await one<{ n: number }>(
      `select count(*)::int as n from public.vouchers where cycle_id = $1`,
      [cycle_id],
    );
    expect(tokens).toHaveLength(vouchers.n);
    token = tokens.find((t) => t.voucher_id === voucher.id)!.token;
    expect(token).toMatch(/^[A-HJ-NP-Z2-9]{24}$/);
    expect(token).not.toContain(voucher.code);
    expect(new Set(tokens.map((t) => t.token)).size).toBe(tokens.length);

    expect(
      (await pgError(as(vendor, `select * from public.voucher_slip_tokens($1)`, [cycle_id]))).code,
    ).toBe('PT403');
    expect((await pgError(as(manager, `select * from private.voucher_scan_tokens`))).code).toBe(
      '42501',
    );
  });

  it('finds the voucher from the slip’s link or the bare token, with no phone needed', async () => {
    const found = await check(link(token));
    expect(found).toMatchObject({
      ok: true,
      scanned: true,
      voucher_id: voucher.id,
      code: voucher.code,
    });
    expect(found).not.toHaveProperty('phone');
    expect(await check(` ${token.toLowerCase()} `)).toMatchObject({
      ok: true,
      voucher_id: voucher.id,
    });
    expect(await check(link('A'.repeat(24)))).toMatchObject({
      ok: false,
      message: expect.stringMatching(/isn't a voucher/),
    });
    expect(await check('https://example.com/something-else')).toMatchObject({ ok: false });
  });

  it('redeems by scan, within what is left on the voucher', async () => {
    const redeem = (amount: string) =>
      as<{ r: Record<string, unknown> }>(
        vendor,
        `select public.redeem_scanned_voucher($1, $2, '2 bags NPK 15-15-15') as r`,
        [link(token), amount],
      );
    expect((await pgError(redeem((BigInt(voucher.remaining) + 1n).toString()))).message).toMatch(
      /only has/,
    );
    const [{ r }] = await redeem('4500000');
    expect(r).toMatchObject({ ok: true, voucher_id: voucher.id });
    expect(String(r.remaining_kobo)).toBe((BigInt(voucher.remaining) - 4_500_000n).toString());
    const row = await one<{ vendor: string }>(
      `select v.name as vendor from public.voucher_redemptions r join public.vendors v on v.id = r.vendor_id
        where r.id = $1`,
      [r.redemption_id],
    );
    expect(row.vendor).toMatch(/Zaria/);
  });

  it('asks for the farmer’s phone digits after a scan when an admin says so', async () => {
    expect(await as(vendor, `select public.voucher_scan_rules() as r`)).toEqual([
      { r: { needs_phone: false } },
    ]);
    // Only an admin can change it: anyone else's update touches nothing.
    await as(manager, `update public.voucher_settings set scan_needs_phone = true`);
    expect(await one(`select scan_needs_phone from public.voucher_settings`)).toEqual({
      scan_needs_phone: false,
    });
    await as(admin, `update public.voucher_settings set scan_needs_phone = true`);
    expect(await one(`select scan_needs_phone, updated_by from public.voucher_settings`)).toEqual({
      scan_needs_phone: true,
      updated_by: admin,
    });

    expect(await check(link(token))).toMatchObject({
      ok: false,
      message: expect.stringMatching(/phone number/),
    });
    expect(await check(link(token), '0000')).toMatchObject({ ok: false });
    expect(await check(link(token), voucher.phone.slice(-4))).toMatchObject({
      ok: true,
      voucher_id: voucher.id,
    });
    await as(admin, `update public.voucher_settings set scan_needs_phone = false`);
  });

  it('counts wrong scans towards the same lock-out as wrong codes', async () => {
    await db.query(`delete from private.voucher_attempts`);
    for (let i = 0; i < 5; i++) await check(link('B'.repeat(24)));
    expect((await pgError(check(link(token)))).code).toBe('PT429');
    // Typing a code is locked out too.
    expect(
      (
        await pgError(
          as(vendor, `select public.check_voucher($1, $2)`, [
            voucher.code,
            voucher.phone.slice(-4),
          ]),
        )
      ).code,
    ).toBe('PT429');
  });
});
