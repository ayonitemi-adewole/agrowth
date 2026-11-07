import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createDb, createUser, pgError } from './db';

/**
 * These tests write to the ledger as the database owner, the way internal posting
 * functions do, to prove the rules hold however the data arrives.
 */
describe('ledger', () => {
  let db: PGlite;
  let manager: string;
  let cycleA: string;
  let cycleB: string;
  let trusteeA: string;
  let investorsA: string;
  let trusteeB: string;
  let platformFees: string;

  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows[0];

  const makeCycle = async (code: string) =>
    (
      await one<{ id: string }>(
        `insert into public.cycles (code, crop, season, funding_source, target_amount_kobo,
           budget_per_hectare_kobo, yield_low_t_per_ha, yield_expected_t_per_ha, yield_high_t_per_ha, manager_id)
         values ($1, 'maize', '2027 wet', 'investor', 100000000, 50000000, 2, 3, 4, $2) returning id`,
        [code, manager],
      )
    ).id;

  const account = async (code: string, type: string, cycleId: string | null) =>
    (
      await one<{ id: string }>(
        `insert into public.ledger_accounts (code, name, type, cycle_id) values ($1, $1, $2, $3) returning id`,
        [code, type, cycleId],
      )
    ).id;

  const post = (cycleId: string | null, lines: [string, bigint][], description = 'test') =>
    one<{ id: string }>(`select private.post_journal_entry($1, $2, $3, $4) as id`, [
      cycleId,
      description,
      manager,
      JSON.stringify(
        lines.map(([account_id, amount]) => ({ account_id, amount_kobo: amount.toString() })),
      ),
    ]).then((r) => r.id);

  const balance = async (accountId: string) =>
    BigInt(
      (
        await one<{ b: string }>(
          `select balance_kobo as b from public.ledger_balances where account_id = $1`,
          [accountId],
        )
      ).b,
    );

  beforeAll(async () => {
    db = await createDb();
    manager = await createUser(db, 'manager@agrowth.test', 'cycle_manager');
    cycleA = await makeCycle('KD-MAIZE-A');
    cycleB = await makeCycle('KD-MAIZE-B');
    trusteeA = await account('TRUSTEE_CASH', 'asset', cycleA);
    investorsA = await account('INVESTOR_CAPITAL', 'liability', cycleA);
    trusteeB = await account('TRUSTEE_CASH', 'asset', cycleB);
    platformFees = await account('PLATFORM_FEES', 'income', null);
  });

  it('posts a balanced entry and keeps exact kobo, beyond JavaScript number precision', async () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1
    await post(cycleA, [
      [trusteeA, huge],
      [investorsA, -huge],
    ]);
    expect(await balance(trusteeA)).toBe(huge);
    expect(await balance(investorsA)).toBe(-huge);
  });

  it('allows a cycle to pay a platform-level account (fees)', async () => {
    await expect(
      post(cycleA, [
        [investorsA, 10_000_00n],
        [platformFees, -10_000_00n],
      ]),
    ).resolves.toBeTruthy();
  });

  it('blocks moving money from one cycle to another (no recycling)', async () => {
    const err = await pgError(
      post(cycleA, [
        [trusteeB, 1_000_00n],
        [trusteeA, -1_000_00n],
      ]),
    );
    expect(err.message).toMatch(/money cannot move between cycles/);
  });

  it('rejects an unbalanced entry', async () => {
    const err = await pgError(
      post(cycleA, [
        [trusteeA, 100n],
        [investorsA, -99n],
      ]),
    );
    expect(err.message).toMatch(/does not balance/);
  });

  it('rejects an unbalanced entry written directly in SQL, at commit', async () => {
    const err = await pgError(
      db.transaction(async (tx) => {
        const {
          rows: [entry],
        } = await tx.query<{ id: string }>(
          `insert into public.journal_entries (cycle_id, description, posted_by) values ($1, 'raw', $2) returning id`,
          [cycleA, manager],
        );
        await tx.query(
          `insert into public.journal_lines (journal_entry_id, account_id, amount_kobo) values ($1, $2, 100), ($1, $3, -99)`,
          [entry.id, trusteeA, investorsA],
        );
      }),
    );
    expect(err.message).toMatch(/does not balance/);
  });

  it('rejects an entry with no lines, at commit', async () => {
    const err = await pgError(
      db.transaction(async (tx) => {
        await tx.query(
          `insert into public.journal_entries (cycle_id, description, posted_by) values ($1, 'empty', $2)`,
          [cycleA, manager],
        );
      }),
    );
    expect(err.message).toMatch(/at least two lines/);
  });

  it('rejects fractional kobo', async () => {
    const err = await pgError(
      db.query(`select private.post_journal_entry($1, 'frac', $2, $3)`, [
        cycleA,
        manager,
        JSON.stringify([
          { account_id: trusteeA, amount_kobo: 1.5 },
          { account_id: investorsA, amount_kobo: -1.5 },
        ]),
      ]),
    );
    expect(err.message).toMatch(/whole kobo/);
  });

  it('refuses to edit, delete or truncate posted entries, even for the database owner', async () => {
    expect(
      (await pgError(db.query(`update public.journal_lines set amount_kobo = amount_kobo * 2`)))
        .message,
    ).toMatch(/append-only/);
    expect((await pgError(db.query(`delete from public.journal_entries`))).message).toMatch(
      /append-only/,
    );
    expect((await pgError(db.query(`truncate public.journal_lines cascade`))).message).toMatch(
      /append-only/,
    );
  });

  it('refuses to move an account to another cycle', async () => {
    const err = await pgError(
      db.query(`update public.ledger_accounts set cycle_id = $1 where id = $2`, [cycleB, trusteeA]),
    );
    expect(err.message).toMatch(/cannot be moved/);
  });

  it('corrects mistakes with a reversal, exactly once', async () => {
    const mistake = await post(cycleA, [
      [trusteeA, 5_000_00n],
      [investorsA, -5_000_00n],
    ]);
    const before = await balance(trusteeA);
    const reversal = await one<{ id: string }>(
      `select private.reverse_journal_entry($1, $2, 'posted twice') as id`,
      [mistake, manager],
    );
    const { reversal_of } = await one<{ reversal_of: string }>(
      `select reversal_of from public.journal_entries where id = $1`,
      [reversal.id],
    );
    expect(reversal_of).toBe(mistake);
    expect(await balance(trusteeA)).toBe(before - 5_000_00n);
    const again = await pgError(
      db.query(`select private.reverse_journal_entry($1, $2, 'again')`, [mistake, manager]),
    );
    expect(again.message).toMatch(/already been reversed/);
  });

  describe('API access', () => {
    it('lets auditors read the ledger but not write to it', async () => {
      const auditor = await createUser(db, 'auditor@agrowth.test', 'auditor');
      const rows = await asUser(db, auditor, async (tx) => {
        return (await tx.query(`select * from public.ledger_balances`)).rows;
      });
      expect(rows.length).toBe(4);
      const write = await pgError(
        asUser(db, auditor, (tx) =>
          tx.query(`insert into public.journal_entries (description, posted_by) values ('x', $1)`, [
            auditor,
          ]),
        ),
      );
      expect(write.code).toBe('42501');
    });

    it('does not expose the posting functions to API users, even admins', async () => {
      const admin = await createUser(db, 'admin@agrowth.test', 'admin');
      const err = await pgError(
        asUser(db, admin, (tx) =>
          tx.query(`select private.post_journal_entry(null, 'x', $1, '[]')`, [admin]),
        ),
      );
      expect(err.code).toBe('42501');
    });

    it('hides the ledger from cycle managers and investors', async () => {
      const investor = await createUser(db, 'investor@example.com', 'investor');
      for (const user of [manager, investor]) {
        const rows = await asUser(db, user, async (tx) => {
          return (await tx.query(`select * from public.journal_entries`)).rows;
        });
        expect(rows).toHaveLength(0);
      }
    });
  });

  // Deferred triggers fire at commit, after the posting RPC has returned. Before PostgreSQL 18
  // (Supabase runs 17) they run as the signed-in user, who can't use the private schema, so
  // they and the private functions they call must run as their owner. PGlite is PostgreSQL 18,
  // which hides the failure, so check the property directly.
  it('runs deferred ledger checks as their owner', async () => {
    const { rows } = await db.query<{ fn: string; definer: boolean }>(
      `with trigger_fns as (
         select p.oid, p.prosecdef, p.prosrc
           from pg_trigger t join pg_proc p on p.oid = t.tgfoid
          where t.tgdeferrable and not t.tgisinternal
       )
       select oid::regprocedure::text as fn, prosecdef as definer from trigger_fns
       union
       select q.oid::regprocedure::text, q.prosecdef
         from trigger_fns f
         join pg_proc q on q.pronamespace = 'private'::regnamespace
                       and f.prosrc like '%private.' || q.proname || '(%'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.filter((r) => !r.definer).map((r) => r.fn)).toEqual([]);
  });
});
