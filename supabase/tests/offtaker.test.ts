import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedDemo } from '../seed/seed';
import { asUser, createDb, createUser, pgError, type Tx } from './db';
import { pgliteApi } from './pglite-api';

interface Load {
  id: string;
  farm: string;
  grade: string;
  weight_kg: number;
  voided: boolean;
  confirmed_at: string | null;
  dispute: string | null;
}
interface Contract {
  id: string;
  cycle_code: string;
  cycle_status: string;
  accepted_kg: number;
  paid_kobo: string;
  value_kobo: string | null;
  deliveries: Load[];
}

/** The offtaker portal on the demo portfolio: Northern Mills and Kura Rice Mills. */
describe('offtaker portal', () => {
  let db: PGlite;
  let maizeBuyer: string;
  let riceBuyer: string;
  let admin: string;
  let manager: string;

  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows[0];
  const as = async <T>(user: string, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (tx: Tx) => (await tx.query<T>(sql, params)).rows);
  const portal = async (user: string) =>
    (
      await as<{ p: { offtaker: { name: string } | null; contracts: Contract[] } }>(
        user,
        `select public.offtaker_portal() as p`,
      )
    )[0].p;

  beforeAll(async () => {
    db = await createDb();
    const pdf = readFileSync(
      join(import.meta.dirname, '..', '..', 'docs', 'demo', 'sample-offtake-agreement.pdf'),
    );
    await seedDemo(pgliteApi(db), { password: 'unused', offtakePdf: pdf, insurancePdf: pdf });
    const id = async (email: string) =>
      (await one<{ id: string }>(`select id from public.profiles where email = $1`, [email])).id;
    maizeBuyer = await id('buyer@agrowth.test');
    riceBuyer = await id('buyer.rice@agrowth.test');
    admin = await id('admin@agrowth.test');
    manager = await id('manager@agrowth.test');
  }, 300_000);

  it('makes one buyer record per buyer named on agreements', async () => {
    const { n } = await one<{ n: number }>(`select count(*)::int as n from public.offtakers`);
    expect(n).toBe(5);
    const unlinked = await one<{ n: number }>(
      `select count(*)::int as n from public.offtake_contracts where offtaker_id is null`,
    );
    expect(unlinked.n).toBe(0);
  });

  it('shows a buyer only its own agreements, with loads, payments and what it owes', async () => {
    const p = await portal(maizeBuyer);
    expect(p.offtaker!.name).toBe('Northern Mills Ltd');
    expect(p.contracts.map((c) => c.cycle_status).sort()).toEqual(['in_progress', 'settled']);
    const settled = p.contracts.find((c) => c.cycle_status === 'settled')!;
    expect(settled.accepted_kg).toBeGreaterThan(0);
    expect(BigInt(settled.paid_kobo)).toBeGreaterThan(0n);
    expect(settled.value_kobo).not.toBeNull();
    expect(settled.deliveries.every((d) => d.voided || d.confirmed_at)).toBe(true);
    // Farms are named; farmers aren't.
    expect(JSON.stringify(p)).not.toMatch(/farmer|phone/);

    const rice = await portal(riceBuyer);
    expect(rice.contracts.map((c) => c.cycle_code)).not.toContain(settled.cycle_code);
  });

  it('lets the buyer confirm a load, or dispute it with a reason', async () => {
    const harvested = (await portal(riceBuyer)).contracts.find(
      (c) => c.cycle_status === 'harvested',
    )!;
    const live = harvested.deliveries.filter((d) => !d.voided);
    expect(live.filter((d) => d.dispute)).toHaveLength(1);
    const [first, second] = live.filter((d) => !d.dispute && !d.confirmed_at);

    await as(riceBuyer, `select public.confirm_harvest_delivery($1)`, [first.id]);
    expect(
      (await pgError(as(riceBuyer, `select public.confirm_harvest_delivery($1)`, [first.id])))
        .message,
    ).toMatch(/already confirmed/);
    expect(
      (
        await pgError(
          as(riceBuyer, `select public.dispute_harvest_delivery($1, 'no')`, [second.id]),
        )
      ).message,
    ).toMatch(/Say what's wrong/);
    await as(riceBuyer, `select public.dispute_harvest_delivery($1, 'Two bags were wet')`, [
      second.id,
    ]);
    // A disputed load can still be confirmed once it's sorted out.
    await as(riceBuyer, `select public.confirm_harvest_delivery($1)`, [second.id]);
    expect(
      await one(
        `select buyer_dispute, buyer_confirmed_by from public.harvest_deliveries where id = $1`,
        [second.id],
      ),
    ).toEqual({ buyer_dispute: 'Two bags were wet', buyer_confirmed_by: riceBuyer });
  });

  it('keeps buyers to their own loads, and the portal to buyers', async () => {
    const harvested = (await portal(riceBuyer)).contracts.find(
      (c) => c.cycle_status === 'harvested',
    )!;
    const load = harvested.deliveries.find((d) => !d.voided && !d.confirmed_at)!;
    expect(
      (await pgError(as(maizeBuyer, `select public.confirm_harvest_delivery($1)`, [load.id]))).code,
    ).toBe('PT404');
    expect(
      (await pgError(as(manager, `select public.confirm_harvest_delivery($1)`, [load.id]))).code,
    ).toBe('PT404');
    expect((await pgError(portal(manager))).code).toBe('PT403');
    // Buyers don't read the underlying tables.
    expect(await as(maizeBuyer, `select 1 from public.harvest_deliveries`)).toHaveLength(0);
    expect(await as(maizeBuyer, `select 1 from public.farmers`)).toHaveLength(0);
  });

  it('lets only an admin link Offtaker accounts to buyers', async () => {
    const newBuyer = await createUser(db, 'new.buyer@example.com', 'offtaker');
    const { id: savanna } = await one<{ id: string }>(
      `select id from public.offtakers where name like 'Savanna%'`,
    );
    const link = (user: string, who: string) =>
      as(user, `select public.link_offtaker_account($1, $2)`, [who, savanna]);
    expect((await pgError(link(manager, newBuyer))).code).toBe('PT403');
    expect((await pgError(link(admin, manager))).message).toMatch(/Offtaker role first/);
    expect(await portal(newBuyer)).toEqual({ offtaker: null, contracts: [] });
    await link(admin, newBuyer);
    expect((await portal(newBuyer)).offtaker!.name).toMatch(/Savanna/);
  });
});
