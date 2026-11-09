import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SeedApi } from '../seed/api';
import { CYCLES } from '../seed/portfolio';
import { isSeeded, seedDemo, type SeedResult } from '../seed/seed';
import { asUser, createDb, createUser } from './db';
import { pgliteApi } from './pglite-api';

/**
 * The demo seed, run through the real migrations: every cycle must reach its intended stage
 * through the database's own rules, and the books must close.
 */
describe('demo seed', () => {
  let db: PGlite;
  let api: SeedApi;
  let result: SeedResult;
  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows[0];
  const pdf = readFileSync(
    join(import.meta.dirname, '..', '..', 'docs', 'demo', 'sample-offtake-agreement.pdf'),
  );

  beforeAll(async () => {
    db = await createDb();
    api = pgliteApi(db);
    expect(await isSeeded(api)).toBe(false);
    result = await seedDemo(api, { password: 'unused', offtakePdf: pdf, insurancePdf: pdf });
  }, 300_000);

  it('builds one cycle at every stage', async () => {
    const { rows } = await db.query<{ code: string; status: string }>(
      `select code, status from public.cycles`,
    );
    const byCode = new Map(rows.map((r) => [r.code, r.status]));
    expect(result.cycles).toHaveLength(CYCLES.length);
    for (const c of result.cycles) expect(byCode.get(c.code)).toBe(c.stage);
    expect(await isSeeded(api)).toBe(true);
  });

  it('enrols the registry with KYC in every state', async () => {
    const { rows } = await db.query<{ kyc_status: string; n: number }>(
      `select kyc_status, count(*)::int as n from public.farmers group by kyc_status`,
    );
    const counts = Object.fromEntries(rows.map((r) => [r.kyc_status, r.n]));
    expect(counts.verified).toBeGreaterThan(35);
    expect(counts.pending).toBe(3);
    expect(counts.rejected).toBe(1);
    expect(result.farmers).toBe(43);
  });

  it('checks every identity number, and verifies only people whose numbers matched', async () => {
    const { rows } = await db.query<{ subject: string; kyc: string; status: string; n: number }>(
      `select c.subject, coalesce(f.kyc_status, i.kyc_status)::text as kyc, c.status::text,
              count(*)::int as n
         from public.identity_checks c
         left join public.farmers f on f.id = c.farmer_id
         left join public.investor_profiles i on i.user_id = c.investor_id
        group by 1, 2, 3 order by 1, 2, 3`,
    );
    const statuses = (subject: string, kyc: string) =>
      rows.filter((r) => r.subject === subject && r.kyc === kyc).map((r) => r.status);
    expect(statuses('farmer', 'verified')).toEqual(['match']);
    expect(statuses('farmer', 'rejected')).toEqual(['no_match']);
    expect(statuses('farmer', 'pending')).toContain('partial');
    expect(statuses('investor', 'verified')).toEqual(['match']);
    const unchecked = await db.query(
      `select 1 from public.farmers f
        where not exists (select 1 from public.identity_checks c where c.farmer_id = f.id)`,
    );
    expect(unchecked.rows).toHaveLength(0);
  });

  it('closes the books on settled cycles and keeps the ledger balanced', async () => {
    const settled = await db.query<{ id: string }>(
      `select id from public.cycles where status = 'settled'`,
    );
    expect(settled.rows).toHaveLength(3);
    for (const { id } of settled.rows) {
      const cash = await one<{ b: string }>(
        `select coalesce(sum(balance_kobo::bigint), 0)::text as b from public.ledger_balances
          where cycle_id = $1 and code = 'TRUSTEE_CASH'`,
        [id],
      );
      expect(cash.b).toBe('0');
    }
    const total = await one<{ t: string }>(
      `select coalesce(sum(amount_kobo), 0)::text as t from public.journal_lines`,
    );
    expect(total.t).toBe('0');
  });

  it('returns the drought-year funders their capital through the insurance claim', async () => {
    const { rows } = await db.query<{ kind: string; amount: string }>(
      `select p.kind::text, sum(p.amount_kobo)::text as amount
         from public.settlement_payouts p join public.cycles c on c.id = p.cycle_id
        where c.code like 'BN-SOY-%' and c.status = 'settled' group by p.kind`,
    );
    const target = await one<{ t: string }>(
      `select target_amount_kobo::text as t from public.cycles where code like 'BN-SOY-%' and status = 'settled'`,
    );
    const funders = BigInt(rows.find((r) => r.kind === 'funder')!.amount);
    expect(funders).toBeGreaterThanOrEqual(BigInt(target.t));
    const claim = await one<{ n: number }>(
      `select count(*)::int as n from public.cycle_receipts where kind = 'insurance_payout'`,
    );
    expect(claim.n).toBe(1);
  });

  it('leaves work waiting for each role', async () => {
    const statuses = await db.query<{ status: string }>(
      `select status::text from public.milestones`,
    );
    const list = statuses.rows.map((r) => r.status);
    expect(list).toContain('blocked');
    expect(list).toContain('awaiting_verification');
    const open = await one<{ raised: string; target: string }>(
      `select f.raised_kobo::text as raised, c.target_amount_kobo::text as target
         from public.cycles c join public.cycle_funding f on f.cycle_id = c.id
        where c.status = 'open_for_funding'`,
    );
    expect(BigInt(open.raised)).toBeGreaterThan(0n);
    expect(BigInt(open.raised)).toBeLessThan(BigInt(open.target));
  });

  it('runs portal investors through KYC, pledges and payouts, with cooling-off back on', async () => {
    const { rows } = await db.query<{
      email: string;
      kyc: string;
      status: string;
      payouts: number;
      paid_before_pledge: boolean;
    }>(
      `select pr.email, ip.kyc_status::text as kyc, p.status::text as status,
              (select count(*)::int from public.settlement_payouts sp
                where sp.contribution_id = p.contribution_id and sp.status = 'executed') as payouts,
              fc.received_on < p.pledged_at::date as paid_before_pledge
         from public.investor_profiles ip
         join public.profiles pr on pr.id = ip.user_id
         left join public.investment_pledges p on p.investor_id = ip.user_id
         left join public.funding_contributions fc on fc.id = p.contribution_id
        order by pr.email, p.pledged_at`,
    );
    const by = (email: string) => rows.filter((r) => r.email === email);
    // Adaeze: the settled maize cycle (paid out), the harvested rice cycle (to settle live),
    // the maize cycle in progress, and a pledge to the open soybean cycle that's past its
    // cooling-off, ready to pay online.
    expect(by('investor@agrowth.test').map((r) => [r.status, r.payouts])).toEqual([
      ['paid', 1],
      ['paid', 0],
      ['paid', 0],
      ['pending', 0],
    ]);
    expect(by('investor.retail@agrowth.test').map((r) => r.status)).toEqual(['pending']);
    expect(by('investor.new@agrowth.test')).toMatchObject([{ kyc: 'pending', status: null }]);
    expect(rows.some((r) => r.paid_before_pledge)).toBe(false);

    const settings = await one<{ h: number }>(
      `select cooling_off_hours as h from public.investor_settings`,
    );
    expect(settings.h).toBe(48);
    const ready = await one<{ n: number }>(
      `select count(*)::int as n from public.investment_pledges
        where status = 'pending' and cooling_off_ends_at <= now()`,
    );
    expect(ready.n).toBe(1);
    expect(result.accounts.filter((a) => a.role === 'investor')).toHaveLength(3);
  });

  it('runs the wheat programme over two seasons, with repayment and a farm to follow up', async () => {
    const [{ id: pm }] = (
      await db.query<{ id: string }>(
        `select id from public.profiles where email = 'programme@agrowth.test'`,
      )
    ).rows;
    const [{ id: programme }] = (
      await db.query<{ id: string }>(`select id from public.programmes where code = 'KN-WHEAT-ICP'`)
    ).rows;
    const d = await asUser(db, pm, async (tx) => {
      const { rows } = await tx.query<{
        d: {
          programme: { status: string };
          totals: {
            farmers: number;
            due_kobo: string;
            recovered_kobo: string;
            under_delivered: number;
          };
          cycles: { status: string }[];
          under_delivered: { farmer_name: string }[];
        };
      }>(`select public.programme_dashboard($1) as d`, [programme]);
      return rows[0].d;
    });
    expect(d.programme.status).toBe('active');
    expect(d.cycles.map((c) => c.status).sort()).toEqual(['funded', 'settled']);
    expect(d.totals.farmers).toBe(4);
    expect(BigInt(d.totals.due_kobo)).toBeGreaterThan(0n);
    expect(d.totals.recovered_kobo).toBe(d.totals.due_kobo);
    expect(d.totals.under_delivered).toBe(1);
    expect(d.under_delivered).toHaveLength(1);
  });

  it('gives finished cycles their real, past planned dates', async () => {
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.cycles
        where status in ('settled', 'harvested') and expected_harvest_date >= current_date`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('shows staff where each visit checked in, and investors nothing', async () => {
    const { rows: staff } = await db.query<{ id: string }>(
      `select id from public.profiles where email = 'compliance@agrowth.test'`,
    );
    const evidence = await asUser(
      db,
      staff[0].id,
      async (tx) =>
        (
          await tx.query<{
            lon: number;
            lat: number;
            distance_from_boundary_m: string;
            passed: boolean;
          }>(`select lon, lat, distance_from_boundary_m, passed from public.field_visit_evidence`)
        ).rows,
    );
    expect(evidence.length).toBeGreaterThan(50);
    const failed = evidence.filter((v) => !v.passed);
    expect(failed).toHaveLength(1);
    expect(Number(failed[0].distance_from_boundary_m)).toBeGreaterThan(100);
    expect(evidence.every((v) => v.lat > 7 && v.lat < 12 && v.lon > 7 && v.lon < 9)).toBe(true);

    const investor = await createUser(db, 'someone@example.com', 'investor');
    const hidden = await asUser(
      db,
      investor,
      async (tx) => (await tx.query(`select id from public.field_visit_evidence`)).rows,
    );
    expect(hidden).toHaveLength(0);
  });

  it('pays one release as input vouchers redeemed at an approved agro-dealer', async () => {
    const vouchers = await db.query<{ status: string; redeemed: string; value: string }>(
      `select status::text, redeemed_kobo::text as redeemed, value_kobo::text as value
         from public.vouchers`,
    );
    expect(vouchers.rows).toHaveLength(5);
    const statuses = vouchers.rows.map((v) => v.status).sort();
    expect(statuses).toEqual(['active', 'active', 'redeemed', 'redeemed', 'redeemed']);
    expect(vouchers.rows.filter((v) => v.redeemed === '0')).toHaveLength(1);

    const unpaid = await one<{ n: number }>(
      `select count(*)::int as n from public.voucher_redemptions where paid_at is null`,
    );
    expect(unpaid.n).toBe(1);
    const vendors = await db.query<{ status: string; linked: boolean }>(
      `select status::text, user_id is not null as linked from public.vendors`,
    );
    expect(vendors.rows.filter((v) => v.status === 'pending')).toHaveLength(1);
    expect(vendors.rows.filter((v) => v.linked)).toHaveLength(1);
  });
});
