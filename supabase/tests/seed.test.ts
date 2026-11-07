import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Row, SeedApi, Session } from '../seed/api';
import { CYCLES } from '../seed/portfolio';
import { isSeeded, seedDemo, type SeedResult } from '../seed/seed';
import { asUser, createDb, createUser } from './db';

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Bad identifier ${name}`);
  return name;
};

/** jsonb arguments travel as JSON text; text[] arrays and scalars as they are. */
const param = (v: unknown) =>
  v !== null &&
  typeof v === 'object' &&
  !(Array.isArray(v) && v.every((x) => typeof x === 'string'))
    ? JSON.stringify(v)
    : v;

const where = (match: Row, offset = 0) => {
  const keys = Object.keys(match);
  return {
    sql: keys.length
      ? ` where ${keys.map((k, i) => `${ident(k)} = $${i + 1 + offset}`).join(' and ')}`
      : '',
    values: keys.map((k) => match[k]),
  };
};

/** The seed's database interface, implemented on PGlite with the same RLS as Supabase's API. */
function pgliteApi(db: PGlite): SeedApi {
  const session = (userId: string): Session => ({
    rpc: (fn, args) =>
      asUser(db, userId, async (tx) => {
        const keys = Object.keys(args);
        const { rows } = await tx.query<{ r: unknown }>(
          `select public.${ident(fn)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')}) as r`,
          keys.map((k) => param(args[k])),
        );
        return rows[0].r as never;
      }),
    insert: (table, input) =>
      asUser(db, userId, async (tx) => {
        const rows = Array.isArray(input) ? input : [input];
        const cols = Object.keys(rows[0]);
        const values: unknown[] = [];
        const tuples = rows.map(
          (r) => `(${cols.map((c) => `$${values.push(param(r[c]))}`).join(', ')})`,
        );
        const { rows: out } = await tx.query<Row>(
          `insert into public.${ident(table)} (${cols.map(ident).join(', ')}) values ${tuples.join(', ')} returning *`,
          values,
        );
        return out;
      }),
    select: (table, columns, match) =>
      asUser(db, userId, async (tx) => {
        const w = where(match);
        return (
          await tx.query<Row>(`select ${columns} from public.${ident(table)}${w.sql}`, w.values)
        ).rows;
      }),
    upload: (bucket, path) =>
      asUser(db, userId, async (tx) => {
        await tx.query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [
          bucket,
          path,
        ]);
      }),
  });

  return {
    ensureUser: ({ email, fullName, role }) => createUser(db, email, role, { full_name: fullName }),
    as: session,
    adminSelect: async (table, columns, match) => {
      const w = where(match);
      return (
        await db.query<Row>(`select ${columns} from public.${ident(table)}${w.sql}`, w.values)
      ).rows;
    },
    adminUpdate: async (table, match, values) => {
      const keys = Object.keys(values);
      const w = where(match, keys.length);
      await db.query(
        `update public.${ident(table)} set ${keys.map((k, i) => `${ident(k)} = $${i + 1}`).join(', ')}${w.sql}`,
        [...keys.map((k) => values[k]), ...w.values],
      );
    },
  };
}

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

  it('closes the books on settled cycles and keeps the ledger balanced', async () => {
    const settled = await db.query<{ id: string }>(
      `select id from public.cycles where status = 'settled'`,
    );
    expect(settled.rows).toHaveLength(2);
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
});
