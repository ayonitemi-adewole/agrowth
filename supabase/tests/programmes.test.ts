import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createDb, createUser, pgError, square, type Tx } from './db';

const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

interface Figures {
  farmers: number;
  women: number;
  farms: number;
  hectares: number;
  committed_kobo: string;
  inputs_kobo: string;
  cash_kobo: string;
  delivered_kg: number;
  harvested_hectares: number;
  due_kobo: string;
  recovered_kobo: string;
  under_delivered: number;
}

interface Dashboard {
  programme: { code: string; status: string };
  totals: Figures;
  budget_committed_kobo: string;
  by_state: (Figures & { key: string })[];
  by_lga: (Figures & { key: string })[];
  by_commodity: (Figures & { key: string })[];
  by_cooperative: (Figures & { key: string })[];
  cycles: { code: string; status: string; programme_kobo: string }[];
  under_delivered: { farmer_name: string; delivered_kg: number; low_kg: number }[];
  agents: { name: string; visits: number; passed: number; gps_failed: number }[];
  visits_outstanding: number;
}

/**
 * The Government Edition: programmes with eligibility rules and a budget, cycles that must
 * fit them, and dashboards that add up delivery and repayment.
 */
describe('government programmes', () => {
  let db: PGlite;
  let pm: string; // programme manager
  let manager: string; // cycle manager
  let compliance: string;
  let trustee: string;
  let agent: string;
  let auditor: string;
  let investor: string;
  let coop: string;

  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows[0];
  const as = <T>(user: string, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (tx: Tx) => (await tx.query<T>(sql, params)).rows);
  const rpc = async <T>(user: string, sql: string, params: unknown[] = []) =>
    (await as<{ r: T }>(user, `select ${sql} as r`, params))[0].r;
  const readiness = async (cycleId: string) =>
    Object.fromEntries(
      (
        await rpc<{ key: string; ok: boolean }[]>(manager, `public.cycle_readiness($1)`, [cycleId])
      ).map((c) => [c.key, c.ok]),
    );

  let nextNin = 80_000_000_000;
  /** A verified farmer in a cooperative, with a ~1 ha farm (or `size`° square). */
  const farm = async (
    last: string,
    gender: 'female' | 'male',
    lon: number,
    where: [string, string] = ['Kano', 'Kura'],
    size = 0.0009,
    cooperative: string | null = coop,
  ) => {
    const [{ id: farmer }] = await as<{ id: string }>(
      agent,
      `select public.register_farmer(p_first_name => 'Farmer', p_last_name => $1,
         p_phone => '+2348033330000', p_state => $2, p_lga => $3, p_nin => $4,
         p_gender => $5, p_cooperative_id => $6) as id`,
      [last, where[0], where[1], String(nextNin++), gender, cooperative],
    );
    await as(compliance, `select public.set_farmer_kyc($1, 'verified', 'NIN slip seen')`, [farmer]);
    const [{ id }] = await as<{ id: string }>(agent, `select public.map_farm($1, $2) as id`, [
      farmer,
      JSON.stringify(square(lon, 11.7, size)),
    ]);
    return id;
  };

  const newProgramme = async (code: string, over: Record<string, unknown> = {}, user = pm) => {
    const values = {
      code,
      name: 'Kano Wheat Input Credit',
      sponsor: 'Kano State Ministry of Agriculture',
      kind: 'input_loan',
      budget_kobo: 150_000_000,
      commodities: ['Wheat ', 'wheat', 'Rice'],
      target_states: ['Kano'],
      target_lgas: ['Kura', 'Garun Mallam'],
      max_hectares_per_farmer: 1.5,
      require_cooperative: true,
      max_budget_per_ha_kobo: 50_000_000,
      repayment_bps: 10_000,
      starts_on: day(-30),
      ends_on: day(365),
      ...over,
    };
    const keys = Object.keys(values);
    const [{ id }] = await as<{ id: string }>(
      user,
      `insert into public.programmes (${keys.join(', ')})
       values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
      Object.values(values),
    );
    return id;
  };

  /** A draft wheat cycle on these farms: ₦900k target, ₦500k/ha, low yield 2 t/ha. */
  const draftCycle = async (code: string, farms: string[], programmeId: string | null) => {
    const [{ id }] = await as<{ id: string }>(
      manager,
      `insert into public.cycles (code, crop, season, funding_source, target_amount_kobo,
         budget_per_hectare_kobo, yield_low_t_per_ha, yield_expected_t_per_ha, yield_high_t_per_ha,
         price_low_per_tonne_kobo, price_expected_per_tonne_kobo, price_high_per_tonne_kobo,
         funding_deadline, start_date, expected_harvest_date, management_fee_bps,
         funder_profit_share_bps, cooperative_id, programme_id)
       values ($1, 'wheat', '2027 dry', 'blended', 90000000, 50000000, 2, 3, 4,
               50000000, 60000000, 70000000, $2, $3, $4, 0, 0, $5, $6)
       returning id`,
      [code, day(10), day(20), day(140), coop, programmeId],
    );
    for (const f of farms) {
      await as(manager, `insert into public.cycle_farms (cycle_id, farm_id) values ($1, $2)`, [
        id,
        f,
      ]);
    }
    await as(
      manager,
      `insert into public.milestones (cycle_id, sequence, name, planned_date, amount_kobo)
       values ($1, 1, 'Sowing', $2, 60000000), ($1, 2, 'Harvest', $3, 30000000)`,
      [id, day(25), day(130)],
    );
    await as(
      manager,
      `insert into public.offtake_contracts (cycle_id, buyer_name, commodity, volume_tonnes,
         price_terms, price_floor_per_tonne_kobo, document_path, signed_on)
       values ($1, 'Arewa Flour Mills Ltd', 'wheat', 10, 'floor', 50000000, $2, $3)`,
      [id, `${id}/offtake.pdf`, day(0)],
    );
    await as(
      manager,
      `insert into public.insurance_policies (cycle_id, insurer_name, policy_number, cover_type,
         sum_insured_kobo, premium_kobo, loss_payee, cover_start, cover_end, document_path)
       values ($1, 'Pula Assurance', $2, 'area_yield', 90000000, 2700000,
               'Trustee on behalf of the programme', $3, $4, $5)`,
      [id, `POL-${code}`, day(20), day(150), `${id}/policy.pdf`],
    );
    return id;
  };

  beforeAll(async () => {
    db = await createDb();
    pm = await createUser(db, 'pm@kano.gov.ng', 'programme_manager');
    manager = await createUser(db, 'manager@test.ng', 'cycle_manager');
    compliance = await createUser(db, 'compliance@test.ng', 'compliance_officer');
    trustee = await createUser(db, 'trustee@test.ng', 'trustee');
    agent = await createUser(db, 'agent@test.ng', 'field_agent', { full_name: 'Musa Agent' });
    auditor = await createUser(db, 'auditor@test.ng', 'auditor');
    investor = await createUser(db, 'investor@test.ng', 'investor');
    [{ id: coop }] = await as<{ id: string }>(
      agent,
      `insert into public.cooperatives (name, state, lga) values ('Kura Wheat Union', 'Kano', 'Kura')
       returning id`,
    );
  });

  describe('designing a programme', () => {
    it('is drafted by programme managers only, with its lists tidied', async () => {
      expect((await pgError(newProgramme('KN-NOT-MINE', {}, manager))).code).toBe('42501');
      const id = await newProgramme('KN-WHEAT-ICP-01');
      const p = await one<{ commodities: string[]; status: string }>(
        `select commodities, status from public.programmes where id = $1`,
        [id],
      );
      expect(p).toEqual({ commodities: ['rice', 'wheat'], status: 'draft' });
    });

    it('refuses a grant with repayment terms, and a loan without them on activation', async () => {
      expect(
        (await pgError(newProgramme('KN-GRANT-BAD', { kind: 'grant', repayment_bps: 5000 }))).code,
      ).toBe('23514');
      const loan = await newProgramme('KN-LOAN-ZERO', { repayment_bps: 0 });
      expect(
        (await pgError(as(pm, `select public.activate_programme($1)`, [loan]))).message,
      ).toMatch(/needs a repayment share/);
    });

    it('fixes the terms once active', async () => {
      const [{ id }] = await as<{ id: string }>(
        pm,
        `select id from public.programmes where code = 'KN-WHEAT-ICP-01'`,
      );
      await as(pm, `select public.activate_programme($1)`, [id]);
      const changed = await as(
        pm,
        `update public.programmes set budget_kobo = 1 where id = $1 returning id`,
        [id],
      );
      expect(changed).toHaveLength(0);
    });
  });

  describe('a programme cycle, from eligibility to repayment', () => {
    let programme: string;
    let cycle: string;
    let farms: string[];
    let milestones: string[];

    beforeAll(async () => {
      programme = (
        await one<{ id: string }>(`select id from public.programmes where code = 'KN-WHEAT-ICP-01'`)
      ).id;
      farms = [await farm('Amina', 'female', 8.4), await farm('Bello', 'male', 8.41)];
    });

    it('keeps investor-only cycles out of programmes', async () => {
      const err = await pgError(
        as(
          manager,
          `insert into public.cycles (code, crop, season, funding_source, target_amount_kobo,
             budget_per_hectare_kobo, yield_low_t_per_ha, yield_expected_t_per_ha,
             yield_high_t_per_ha, programme_id)
           values ('INV-WHEAT-1', 'wheat', '2027', 'investor', 1, 1, 1, 1, 1, $1)`,
          [programme],
        ),
      );
      expect(err.message).toMatch(/investor-only cycle/);
    });

    it("adds the programme's rules to the readiness checklist", async () => {
      const outside = await farm('Chidi', 'male', 8.42, ['Kaduna', 'Zaria']);
      const big = await farm('Danjuma', 'male', 8.43, ['Kano', 'Kura'], 0.0013); // ~2 ha
      const loose = await farm('Esther', 'female', 8.44, ['Kano', 'Kura'], 0.0009, null);
      const bad = await draftCycle('KN-WHEAT-BAD', [outside, big, loose], programme);
      const checks = await readiness(bad);
      expect(checks).toMatchObject({
        programme_active: true,
        programme_commodity: true,
        programme_area: false,
        programme_hectares: false,
        programme_cooperative: false,
        programme_package: true,
        programme_dates: true,
      });
      expect((await pgError(as(manager, `select public.submit_cycle($1)`, [bad]))).message).toMatch(
        /not ready/,
      );
      await as(manager, `update public.cycles set crop = 'maize' where id = $1`, [bad]);
      expect((await readiness(bad)).programme_commodity).toBe(false);
    });

    it('submits a cycle that fits, and counts programme deposits against the budget', async () => {
      cycle = await draftCycle('KN-WHEAT-27-01', farms, programme);
      const checks = await readiness(cycle);
      expect(Object.values(checks).every(Boolean)).toBe(true);
      await as(manager, `select public.submit_cycle($1)`, [cycle]);
      await as(compliance, `select public.review_cycle($1, true, null)`, [cycle]);

      // ₦1.5m budget. An investor tranche in a blended cycle doesn't count against it.
      await as(
        trustee,
        `select public.record_funding($1, 'Kestrel Fund', 'investor', 10000000, 'D-1')`,
        [cycle],
      );
      await as(
        trustee,
        `select public.record_funding($1, 'Kano Wheat ICP', 'programme', 80000000, 'D-2')`,
        [cycle],
      );
      const linked = await db.query<{ funder_kind: string; programme_id: string | null }>(
        `select funder_kind, programme_id from public.funding_contributions where cycle_id = $1
          order by trustee_reference`,
        [cycle],
      );
      expect(linked.rows).toEqual([
        { funder_kind: 'investor', programme_id: null },
        { funder_kind: 'programme', programme_id: programme },
      ]);
    });

    it('refuses a deposit that would overspend the budget', async () => {
      const others = [await farm('Fatima', 'female', 8.45), await farm('Garba', 'male', 8.46)];
      const second = await draftCycle('KN-WHEAT-27-02', others, programme);
      await as(manager, `select public.submit_cycle($1)`, [second]);
      await as(compliance, `select public.review_cycle($1, true, null)`, [second]);
      // ₦800k of ₦1.5m used: ₦700k left.
      const err = await pgError(
        as(
          trustee,
          `select public.record_funding($1, 'Kano Wheat ICP', 'programme', 90000000, 'D-3')`,
          [second],
        ),
      );
      expect(err.message).toMatch(/over its budget: ₦700,000\.00 of ₦1,500,000\.00 is left/);
    });

    it('runs the season: releases, an under-delivering farm, settlement and repayment', async () => {
      milestones = (
        await db.query<{ id: string }>(
          `select id from public.milestones where cycle_id = $1 order by sequence`,
          [cycle],
        )
      ).rows.map((m) => m.id);
      const lons = [8.4, 8.41];
      for (const m of milestones) {
        await as(manager, `select public.request_milestone_verification($1)`, [m]);
        for (const [i, f] of farms.entries()) {
          await as(
            agent,
            `select public.record_field_visit($1, $2, $3, 11.70045, 5, 'good', true, $4)`,
            [f, m, lons[i] + 0.00045, ['visit/photo.jpg']],
          );
        }
        const { amount_kobo } = await one<{ amount_kobo: string }>(
          `select amount_kobo from public.milestones where id = $1`,
          [m],
        );
        await as(manager, `select public.instruct_milestone_release($1, $2)`, [
          m,
          JSON.stringify([
            {
              payee_kind: 'input_vendor',
              payee_name: 'Kano Seed and Fertiliser Ltd',
              payee_account: 'Access Bank 0678901234',
              purpose: 'Seed and fertiliser',
              amount_kobo,
            },
          ]),
        ]);
        const [{ id }] = await as<{ id: string }>(
          trustee,
          `select id from public.disbursements where milestone_id = $1`,
          [m],
        );
        await as(trustee, `select public.confirm_disbursement($1, $2)`, [id, `PAY-${m}`]);
      }

      const [{ id: offtake }] = await as<{ id: string }>(
        manager,
        `select id from public.offtake_contracts where cycle_id = $1`,
        [cycle],
      );
      // Amina delivers 4 t; Bello only 1 t, short of his ~2 t low-yield estimate.
      for (const [f, kg, ref] of [
        [farms[0], 4000, 'WB-1'],
        [farms[1], 1000, 'WB-2'],
      ] as const) {
        await as(
          agent,
          `select public.record_harvest_delivery($1, $2, $3, $4, $5, 'grade_a', $6)`,
          [cycle, f, offtake, day(0), kg, ref],
        );
      }
      await as(manager, `select public.complete_harvest($1)`, [cycle]);
      await as(
        trustee,
        `select public.record_cycle_receipt($1, 'offtake_payment', $2, 300000000, 'RCV-1')`,
        [cycle, offtake],
      );
      await as(trustee, `select public.settle_cycle($1)`, [cycle]);
      const payouts = await as<{ id: string }>(
        trustee,
        `select id from public.settlement_payouts where cycle_id = $1`,
        [cycle],
      );
      for (const [i, p] of payouts.entries()) {
        await as(trustee, `select public.confirm_settlement_payout($1, $2)`, [p.id, `SET-${i}`]);
      }
      expect(
        (await one<{ status: string }>(`select status from public.cycles where id = $1`, [cycle]))
          .status,
      ).toBe('settled');
    });

    it('adds it up on the dashboard', async () => {
      const d = await rpc<Dashboard>(pm, `public.programme_dashboard($1)`, [programme]);
      // Four farmers: two in the settled cycle, two in the approved one still raising money.
      expect(d.totals).toMatchObject({
        farmers: 4,
        women: 2,
        farms: 4,
        // ₦800k of programme money, ₦900k of inputs to vendors (the whole cycle).
        committed_kobo: '80000000',
        inputs_kobo: '90000000',
        cash_kobo: '0',
        delivered_kg: 5000,
        // A full loan: all ₦800k due, and settlement paid it back.
        due_kobo: '80000000',
        recovered_kobo: '80000000',
        under_delivered: 1,
      });
      expect(d.budget_committed_kobo).toBe('80000000');
      expect(d.by_lga.map((g) => g.key)).toEqual(['Kano · Kura']);
      expect(d.by_commodity.map((g) => g.key)).toEqual(['wheat']);
      expect(d.by_cooperative.map((g) => g.key)).toEqual(['Kura Wheat Union']);
      expect(d.under_delivered).toEqual([
        expect.objectContaining({ farmer_name: 'Farmer Bello', delivered_kg: 1000 }),
      ]);
      expect(d.agents).toEqual([
        expect.objectContaining({ name: 'Musa Agent', visits: 4, passed: 4, gps_failed: 0 }),
      ]);
      expect(d.visits_outstanding).toBe(0);
      // The second cycle is approved but unfunded; the bad one is still a draft.
      expect(d.cycles.map((c) => c.status).sort()).toEqual([
        'draft',
        'open_for_funding',
        'settled',
      ]);
    });

    it('exports beneficiaries for audit, and lists programmes with headline figures', async () => {
      const rows = await rpc<{ farmer_name: string; delivered_kg: number }[]>(
        auditor,
        `public.programme_beneficiaries($1)`,
        [programme],
      );
      expect(rows.map((r) => r.farmer_name).sort()).toEqual([
        'Farmer Amina',
        'Farmer Bello',
        'Farmer Fatima',
        'Farmer Garba',
      ]);
      const list = await rpc<{ code: string; farmers: number; recovered_kobo: string }[]>(
        auditor,
        `public.programme_summaries()`,
      );
      expect(list.find((p) => p.code === 'KN-WHEAT-ICP-01')).toMatchObject({
        farmers: 4,
        recovered_kobo: '80000000',
      });
    });

    it('is closed to investors, field agents and the trustee', async () => {
      for (const user of [investor, agent, trustee]) {
        expect(
          (await pgError(as(user, `select public.programme_dashboard($1)`, [programme]))).code,
        ).toBe('PT403');
      }
      expect(await as(investor, `select id from public.programmes`)).toHaveLength(0);
    });

    it('takes no new deposits once closed', async () => {
      await as(pm, `select public.close_programme($1)`, [programme]);
      const second = (
        await one<{ id: string }>(`select id from public.cycles where code = 'KN-WHEAT-27-02'`)
      ).id;
      const err = await pgError(
        as(
          trustee,
          `select public.record_funding($1, 'Kano Wheat ICP', 'programme', 1000000, 'D-4')`,
          [second],
        ),
      );
      expect(err.message).toMatch(/is closed/);
    });
  });
});
