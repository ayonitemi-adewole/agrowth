import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedDemo } from '../seed/seed';
import { asService, asUser, createDb, pgError, type Tx } from './db';
import { pgliteApi } from './pglite-api';

const offset = (n: number) =>
  new Date(Date.now() + 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Insurance claims on the demo portfolio: the drought claim it pays in full, and the
 * pest claim it leaves waiting for its assessor on the live maize cycle.
 */
describe('insurance claims', () => {
  let db: PGlite;
  let manager: string;
  let agent: string;
  let trustee: string;
  let investor: string;
  let maize: { id: string; farms: string[] };
  let openClaim: string;

  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows[0];
  const as = async <T>(user: string, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (tx: Tx) => (await tx.query<T>(sql, params)).rows);
  const report = (user: string, overrides: Record<string, unknown> = {}) => {
    const a = {
      cycle: maize.id,
      cause: 'flood',
      from: offset(-2),
      to: null,
      description: 'River burst its banks overnight; two farms under water for two days.',
      farms: [{ farm_id: maize.farms[2], loss_pct: 40 }],
      ...overrides,
    };
    return as<{ id: string }>(
      user,
      `select public.report_insurance_claim($1, $2, $3, $4, $5, $6) as id`,
      [a.cycle, a.cause, a.from, a.description, JSON.stringify(a.farms), a.to],
    ).then((r) => r[0].id);
  };

  beforeAll(async () => {
    db = await createDb();
    const pdf = readFileSync(
      join(import.meta.dirname, '..', '..', 'docs', 'demo', 'sample-offtake-agreement.pdf'),
    );
    await seedDemo(pgliteApi(db), { password: 'unused', offtakePdf: pdf, insurancePdf: pdf });
    const id = async (email: string) =>
      (await one<{ id: string }>(`select id from public.profiles where email = $1`, [email])).id;
    manager = await id('manager@agrowth.test');
    agent = await id('agent@agrowth.test');
    trustee = await id('trustee@agrowth.test');
    investor = await id('investor@agrowth.test');
    const c = await one<{ id: string }>(
      `select id from public.cycles where status = 'in_progress'`,
    );
    const farms = await db.query<{ farm_id: string }>(
      `select farm_id from public.cycle_farms where cycle_id = $1 order by farm_id`,
      [c.id],
    );
    maize = { id: c.id, farms: farms.rows.map((f) => f.farm_id) };
    openClaim = (
      await one<{ id: string }>(`select id from public.insurance_claims where cycle_id = $1`, [
        c.id,
      ])
    ).id;
  }, 300_000);

  it('took the drought claim from report to payment, linked to its receipt', async () => {
    const claim = await one<{
      status: string;
      paid_kobo: string;
      approved_kobo: string;
      receipt: string;
      visits: number;
    }>(
      `select cl.status, cl.paid_kobo, cl.approved_kobo, r.id as receipt,
              jsonb_array_length(cl.visit_evidence) as visits
         from public.insurance_claims cl
         join public.cycle_receipts r on r.insurance_claim_id = cl.id
        where cl.cause = 'drought'`,
    );
    expect(claim.status).toBe('paid');
    expect(String(claim.paid_kobo)).toBe(String(claim.approved_kobo));
    expect(claim.visits).toBeGreaterThan(0);
    expect(
      await one(
        `select status, insurer_claim_number is not null as notified from public.insurance_claims where id = $1`,
        [openClaim],
      ),
    ).toEqual({ status: 'notified', notified: true });
  });

  it('records insurance payouts only through their claim', async () => {
    const policy = await one<{ id: string }>(
      `select id from public.insurance_policies where cycle_id = $1`,
      [maize.id],
    );
    const direct = await pgError(
      as(trustee, `select public.record_cycle_receipt($1, 'insurance_payout', $2, 100000, 'X-1')`, [
        maize.id,
        policy.id,
      ]),
    );
    expect(direct.message).toMatch(/recorded against their claim/);
  });

  it('lets field agents and managers report losses within the policy’s cover', async () => {
    expect((await pgError(report(investor))).code).toBe('PT403');
    expect((await pgError(report(trustee))).code).toBe('PT403');
    expect((await pgError(report(agent, { from: offset(3) }))).message).toMatch(
      /can't be in the future/,
    );
    expect((await pgError(report(agent, { from: offset(-400) }))).message).toMatch(
      /No insurance policy/,
    );
    const otherFarm = await one<{ id: string }>(
      `select f.id from public.farms f where not exists (select 1 from public.cycle_farms cf
         where cf.farm_id = f.id and cf.cycle_id = $1) limit 1`,
      [maize.id],
    );
    expect(
      (await pgError(report(agent, { farms: [{ farm_id: otherFarm.id, loss_pct: 10 }] }))).message,
    ).toMatch(/not in this cycle/);
    expect(
      (await pgError(report(agent, { farms: [{ farm_id: maize.farms[2], loss_pct: 0 }] }))).message,
    ).toMatch(/1 to 100/);
    expect((await pgError(report(agent, { description: 'Flood.' }))).message).toMatch(/Describe/);

    const draft = await one<{ id: string }>(
      `select id from public.cycles where status = 'draft' limit 1`,
    );
    expect((await pgError(report(agent, { cycle: draft.id }))).code).toBe('PT409');
  });

  it('copies the weather over the loss into the claim, as it stood', async () => {
    // A week of weather at the farm's cell: dry for five days, then 30 mm.
    const cell = await asService(db, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.weather_cells (lat, lon, synced_at, normals_years)
         select round(extensions.st_y(centroid)::numeric, 1), round(extensions.st_x(centroid)::numeric, 1), now(), 10
           from public.farms where id = $1
         on conflict (lat, lon) do update set normals_years = 10 returning id`,
        [maize.farms[2]],
      );
      return rows[0].id;
    });
    for (let i = -8; i <= -1; i++) {
      await db.query(
        `insert into public.weather_daily (cell_id, day, rain_mm, tmax_c, tmin_c, is_forecast)
         values ($1, $2, $3, $4, 22, false) on conflict (cell_id, day) do update set rain_mm = excluded.rain_mm, tmax_c = excluded.tmax_c, is_forecast = false`,
        [cell, offset(i), i >= -2 ? 15 : 0.2, 30 - i],
      );
    }
    await db.query(
      `insert into public.weather_normals (cell_id, month_day, rain_mm)
       select $1, to_char(d, 'MM-DD'), 4 from generate_series(current_date - 40, current_date, interval '1 day') d
       on conflict do nothing`,
      [cell],
    );
    const id = await report(agent, { from: offset(-8), to: offset(-1), cause: 'drought' });
    const { weather_evidence: w } = await one<{ weather_evidence: Record<string, unknown>[] }>(
      `select weather_evidence from public.insurance_claims where id = $1`,
      [id],
    );
    expect(w[0]).toMatchObject({
      days_with_data: 8,
      rain_mm: 31.2,
      longest_dry_run_days: 6,
      max_tmax_c: 38,
    });
    expect(Number(w[0].normal_mm)).toBe(32);
    // Later weather doesn't change it.
    await db.query(`update public.weather_daily set rain_mm = 99 where cell_id = $1`, [cell]);
    const again = await one<{ rain: number }>(
      `select (weather_evidence -> 0 ->> 'rain_mm')::numeric as rain from public.insurance_claims where id = $1`,
      [id],
    );
    expect(Number(again.rain)).toBe(31.2);
    await as(manager, `select public.close_insurance_claim($1, 'withdrawn', 'Reported twice')`, [
      id,
    ]);
  });

  it('flags late notice to the insurer', async () => {
    // The harvested rice cycle: its cover runs back to the start of its season.
    const rice = await one<{ id: string; farm: string }>(
      `select c.id, min(cf.farm_id::text) as farm from public.cycles c
         join public.cycle_farms cf on cf.cycle_id = c.id where c.status = 'harvested' group by c.id`,
    );
    const id = await report(agent, {
      cycle: rice.id,
      from: offset(-30),
      to: offset(-20),
      farms: [{ farm_id: rice.farm, loss_pct: 25 }],
    });
    const [{ warning }] = await as<{ warning: string | null }>(
      manager,
      `select public.notify_insurance_claim($1, $2, 'INS-9') as warning`,
      [id, offset(-1)],
    );
    expect(warning).toMatch(/29 days after the loss began/);
    expect(
      (await pgError(as(manager, `select public.notify_insurance_claim($1, $2)`, [id, offset(-1)])))
        .code,
    ).toBe('PT409');
    await as(
      manager,
      `select public.close_insurance_claim($1, 'rejected', 'Notice too late under clause 7')`,
      [id],
    );
    expect(
      await one(`select status, approved_kobo from public.insurance_claims where id = $1`, [id]),
    ).toEqual({
      status: 'rejected',
      approved_kobo: null,
    });
  });

  it('approves no more than the cover left, and pays no more than approved', async () => {
    const policy = await one<{ sum_insured_kobo: string }>(
      `select p.sum_insured_kobo from public.insurance_policies p
         join public.insurance_claims c on c.policy_id = p.id where c.id = $1`,
      [openClaim],
    );
    const assess = (user: string, approved: string | number, on = offset(0)) =>
      as(user, `select public.record_claim_assessment($1, $2, 'Field assessor', $3)`, [
        openClaim,
        on,
        approved,
      ]);
    expect((await pgError(assess(trustee, 100))).code).toBe('PT403');
    expect(
      (await pgError(assess(manager, (BigInt(policy.sum_insured_kobo) + 1n).toString()))).message,
    ).toMatch(/more than the cover left/);
    expect((await pgError(assess(manager, 0))).message).toMatch(/record the claim as rejected/);
    await assess(manager, 30_000_000);

    const pay = (amount: number, ref: string) =>
      as(trustee, `select public.record_claim_payout($1, $2, $3)`, [openClaim, amount, ref]);
    expect((await pgError(pay(30_000_001, 'INS-PAY-1'))).message).toMatch(
      /no more than the ₦300,000.00 approved/,
    );
    expect(
      (await pgError(as(manager, `select public.record_claim_payout($1, 100, 'X')`, [openClaim])))
        .code,
    ).toBe('PT403');
    await pay(30_000_000, 'INS-PAY-1');

    const claim = await one<{ status: string; account: string }>(
      `select c.status, a.code as account
         from public.insurance_claims c
         join public.cycle_receipts r on r.insurance_claim_id = c.id
         join public.journal_lines l on l.journal_entry_id = r.journal_entry_id
         join public.ledger_accounts a on a.id = l.account_id and a.code <> 'TRUSTEE_CASH'
        where c.id = $1`,
      [openClaim],
    );
    expect(claim).toEqual({ status: 'paid', account: 'INSURANCE_RECOVERIES' });
    expect(
      (
        await pgError(
          as(manager, `select public.close_insurance_claim($1, 'withdrawn', 'x')`, [openClaim]),
        )
      ).code,
    ).toBe('PT409');
  });

  it('keeps claim documents to open claims, and claims to staff', async () => {
    const id = await report(agent);
    const upload = (user: string, path: string) =>
      as(user, `insert into storage.objects (bucket_id, name) values ('claim-documents', $1)`, [
        path,
      ]);
    await upload(agent, `${id}/flooded-field.jpg`);
    expect((await pgError(upload(investor, `${id}/x.jpg`))).code).toBe('42501');
    expect((await pgError(upload(agent, `${openClaim}/late.jpg`))).code).toBe('42501'); // paid: closed
    await as(agent, `select public.add_claim_document($1, $2)`, [id, `${id}/flooded-field.jpg`]);
    expect(
      (
        await pgError(
          as(agent, `select public.add_claim_document($1, $2)`, [id, `${id}/missing.jpg`]),
        )
      ).message,
    ).toMatch(/Upload the file first/);
    expect(
      await one(`select document_paths from public.insurance_claims where id = $1`, [id]),
    ).toEqual({
      document_paths: [`${id}/flooded-field.jpg`],
    });

    expect(await as(investor, `select 1 from public.insurance_claims`)).toHaveLength(0);
    expect((await as(trustee, `select 1 from public.insurance_claims`)).length).toBeGreaterThan(0);
  });
});
