import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedDemo } from '../seed/seed';
import { asUser, createDb, pgError, type Tx } from './db';
import { pgliteApi } from './pglite-api';

/** Payout accounts for farmers, outside funders and the operator, on the demo portfolio. */
describe('payout accounts', () => {
  let db: PGlite;
  let agent: string;
  let trustee: string;
  let manager: string;
  let admin: string;
  let farmer: { id: string; first_name: string; last_name: string };

  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows[0];
  const as = async <T>(user: string, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (tx: Tx) => (await tx.query<T>(sql, params)).rows);
  const setFarmer = (user: string, name: string, number = '8123456789', bank = 'OPay') =>
    as(user, `select public.set_farmer_bank_account($1, $2, $3, $4)`, [
      farmer.id,
      bank,
      number,
      name,
    ]);

  beforeAll(async () => {
    db = await createDb();
    const pdf = readFileSync(
      join(import.meta.dirname, '..', '..', 'docs', 'demo', 'sample-offtake-agreement.pdf'),
    );
    await seedDemo(pgliteApi(db), { password: 'unused', offtakePdf: pdf, insurancePdf: pdf });
    const id = async (email: string) =>
      (await one<{ id: string }>(`select id from public.profiles where email = $1`, [email])).id;
    agent = await id('agent@agrowth.test');
    trustee = await id('trustee@agrowth.test');
    manager = await id('manager@agrowth.test');
    admin = await id('admin@agrowth.test');
    farmer = await one(`select id, first_name, last_name from public.farmers limit 1`);
  }, 300_000);

  it('gave most seeded farmers an account, some of them mobile money', async () => {
    const counts = await one<{ with_account: number; mobile: number; total: number }>(
      `select count(account_number)::int as with_account,
              count(*) filter (where bank_name in ('OPay', 'PalmPay'))::int as mobile,
              count(*)::int as total
         from public.farmers`,
    );
    expect(counts.with_account).toBeGreaterThan(counts.total / 2);
    expect(counts.with_account).toBeLessThan(counts.total);
    expect(counts.mobile).toBeGreaterThan(0);
  });

  it('only takes a farmer account in the farmer’s own name', async () => {
    const name = `${farmer.last_name.toUpperCase()} ${farmer.first_name.toUpperCase()} B.`;
    await setFarmer(agent, name);
    expect(
      await one(
        `select bank_name, account_number, account_name, bank_updated_by from public.farmers where id = $1`,
        [farmer.id],
      ),
    ).toEqual({
      bank_name: 'OPay',
      account_number: '8123456789',
      account_name: name,
      bank_updated_by: agent,
    });

    expect((await pgError(setFarmer(agent, `${farmer.first_name} Musa`))).message).toMatch(
      /farmer's own name/,
    );
    expect((await pgError(setFarmer(agent, 'Field Agent Account'))).message).toMatch(
      /farmer's own name/,
    );
    expect((await pgError(setFarmer(agent, name, '123'))).message).toMatch(/10 digits/);
    expect((await pgError(setFarmer(trustee, name))).code).toBe('PT403');
    // Not through a plain update either.
    expect(
      (
        await pgError(
          as(agent, `update public.farmers set account_number = '9999999999' where id = $1`, [
            farmer.id,
          ]),
        )
      ).code,
    ).toBe('42501');
  });

  it('lets the trustee set where outside funders are paid, but not portal investors', async () => {
    const outside = await one<{ id: string }>(
      `select id from public.funding_contributions where investor_id is null limit 1`,
    );
    const portal = await one<{ id: string }>(
      `select id from public.funding_contributions where investor_id is not null limit 1`,
    );
    const set = (user: string, id: string) =>
      as(
        user,
        `select public.set_contribution_payout_account($1, 'Access Bank', '0123456789', 'Fund Ltd')`,
        [id],
      );
    await set(trustee, outside.id);
    expect(
      await one(`select payout_account_name from public.funding_contributions where id = $1`, [
        outside.id,
      ]),
    ).toEqual({ payout_account_name: 'Fund Ltd' });
    expect((await pgError(set(trustee, portal.id))).message).toMatch(/their own profile/);
    expect((await pgError(set(manager, outside.id))).code).toBe('PT403');
  });

  it('lets only an admin set the operator’s fee account, read by those who read the ledger', async () => {
    const set = (user: string) =>
      as(
        user,
        `select public.set_operator_fee_account('Zenith Bank', '1012345678', 'Agrowth Ops')`,
      );
    expect((await pgError(set(trustee))).code).toBe('PT403');
    await set(admin);
    expect(await as(trustee, `select fee_account_name from public.operator_settings`)).toEqual([
      { fee_account_name: 'Agrowth Ops' },
    ]);
    expect(await as(agent, `select 1 from public.operator_settings`)).toHaveLength(0);
  });
});
