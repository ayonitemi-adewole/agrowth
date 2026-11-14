import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createDb, createUser, pgError, square, type Tx } from './db';

const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

interface Settlement {
  cash: string;
  capital: string;
  fee: string;
  capital_returned: string;
  capital_loss: string;
  profit: string;
  funder_return: string;
  farmer_surplus: string;
  accepted_kg: number;
  funders: {
    name: string;
    contributed: string;
    capital: string;
    return: string;
    loss: string;
    total: string;
  }[];
  farmers: { name: string; kg: number; amount: string }[];
}

/**
 * Harvest and settlement: deliveries, receipts from the offtaker and insurer, and the
 * waterfall that pays the fee, returns capital, and splits any profit.
 */
describe('harvest and settlement', () => {
  let db: PGlite;
  let manager: string;
  let compliance: string;
  let trustee: string;
  let agent: string;
  let investor: string;

  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows[0];
  const as = <T>(user: string, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (tx: Tx) => (await tx.query<T>(sql, params)).rows);
  const balance = async (cycleId: string, code: string) =>
    BigInt(
      (
        await one<{ b: string }>(
          `select balance_kobo as b from public.ledger_balances where cycle_id = $1 and code = $2`,
          [cycleId, code],
        )
      )?.b ?? '0',
    );
  const status = async (cycleId: string) =>
    (await one<{ status: string }>(`select status from public.cycles where id = $1`, [cycleId]))
      .status;

  let nextNin = 30_000_000_000;
  /** Enrols a KYC-verified farmer and maps a ~1 ha farm at this longitude. */
  const verifiedFarm = async (lastName: string, lon: number) => {
    const [{ id: farmer }] = await as<{ id: string }>(
      agent,
      `select public.register_farmer('Farmer', $1, '+2348012345678', 'Kaduna', 'Zaria', $2, p_portrait_path => auth.uid()::text || '/portrait.jpg') as id`,
      [lastName, String(nextNin++)],
    );
    await as(compliance, `select public.set_farmer_kyc($1, 'verified', 'NIN slip seen')`, [farmer]);
    const [{ id }] = await as<{ id: string }>(
      agent,
      `select public.map_farm($1, $2, p_photo_paths => array[auth.uid()::text || '/farm.jpg']) as id`,
      [farmer, JSON.stringify(square(lon, 11.1))],
    );
    return id;
  };

  interface Built {
    cycleId: string;
    farms: string[];
    milestones: string[];
    offtakeId: string;
    policyId: string;
  }

  /**
   * Builds, approves and funds a cycle through the real functions, with two farms
   * (one per farmer) at the given longitudes and two milestones of ₦540k and ₦360k.
   */
  const buildFundedCycle = async (
    code: string,
    lons: [number, number],
    funders: [string, number][],
  ): Promise<Built> => {
    const farms = [await verifiedFarm('Audu', lons[0]), await verifiedFarm('Bello', lons[1])];

    const [{ id: cycleId }] = await as<{ id: string }>(
      manager,
      `insert into public.cycles (code, crop, season, funding_source, target_amount_kobo,
         budget_per_hectare_kobo, yield_low_t_per_ha, yield_expected_t_per_ha, yield_high_t_per_ha,
         price_low_per_tonne_kobo, price_expected_per_tonne_kobo, price_high_per_tonne_kobo,
         funding_deadline, start_date, expected_harvest_date, management_fee_bps, funder_profit_share_bps)
       values ($1, 'maize', '2027 wet', 'investor', 90000000, 50000000, 2, 3, 4,
               30000000, 38000000, 45000000, $2, $3, $4, 200, 7000)
       returning id`,
      [code, day(10), day(20), day(140)],
    );
    await as(
      manager,
      `insert into public.cycle_farms (cycle_id, farm_id) values ($1, $2), ($1, $3)`,
      [cycleId, ...farms],
    );
    const milestones = (
      await as<{ id: string }>(
        manager,
        `insert into public.milestones (cycle_id, sequence, name, planned_date, amount_kobo)
         values ($1, 1, 'Planting', $2, 54000000), ($1, 2, 'Harvest', $3, 36000000)
         returning id`,
        [cycleId, day(25), day(130)],
      )
    ).map((m) => m.id);
    const [{ id: offtakeId }] = await as<{ id: string }>(
      manager,
      `insert into public.offtake_contracts (cycle_id, buyer_name, commodity, volume_tonnes,
         price_terms, price_floor_per_tonne_kobo, document_path, signed_on)
       values ($1, 'Northern Mills Ltd', 'maize', 4, 'floor', 30000000, $2, $3) returning id`,
      [cycleId, `${cycleId}/offtake.pdf`, day(0)],
    );
    const [{ id: policyId }] = await as<{ id: string }>(
      manager,
      `insert into public.insurance_policies (cycle_id, insurer_name, policy_number, cover_type,
         sum_insured_kobo, premium_kobo, loss_payee, cover_start, cover_end, document_path)
       values ($1, 'Pula Assurance', $2, 'area_yield', 90000000, 2700000,
               'Trustee on behalf of funders', $3, $4, $5) returning id`,
      [cycleId, `POL-${code}`, day(-10), day(150), `${cycleId}/policy.pdf`],
    );

    await as(manager, `select public.submit_cycle($1)`, [cycleId]);
    await as(compliance, `select public.review_cycle($1, true, null)`, [cycleId]);
    for (const [i, [name, amount]] of funders.entries()) {
      await as(trustee, `select public.record_funding($1, $2, 'investor', $3, $4)`, [
        cycleId,
        name,
        amount,
        `${code}-DEP-${i}`,
      ]);
    }
    return { cycleId, farms, milestones, offtakeId, policyId };
  };

  /** Verifies a milestone with a passing visit to every farm, then releases and pays it. */
  const releaseMilestone = async (built: Built, index: number, lons: number[]) => {
    const milestone = built.milestones[index];
    await as(manager, `select public.request_milestone_verification($1)`, [milestone]);
    for (const [i, farm] of built.farms.entries()) {
      await as(
        agent,
        `select public.record_field_visit($1, $2, $3, 11.10045, 5, 'good', true, $4, p_portrait_path => 'visit/portrait.jpg')`,
        [farm, milestone, lons[i] + 0.00045, ['visit/photo.jpg']],
      );
    }
    const { amount_kobo } = await one<{ amount_kobo: string }>(
      `select amount_kobo from public.milestones where id = $1`,
      [milestone],
    );
    await as(manager, `select public.instruct_milestone_release($1, $2)`, [
      milestone,
      JSON.stringify([
        {
          payee_kind: 'input_vendor',
          payee_name: 'Zaria Agro Inputs',
          payee_account: 'Access Bank 0123456789',
          purpose: 'Inputs',
          amount_kobo: amount_kobo,
        },
      ]),
    ]);
    const [{ id }] = await as<{ id: string }>(
      trustee,
      `select id from public.disbursements where milestone_id = $1`,
      [milestone],
    );
    await as(trustee, `select public.confirm_disbursement($1, $2)`, [id, `PAY-${milestone}`]);
  };

  const deliver = (
    user: string,
    built: Built,
    farm: string,
    kg: number,
    waybill: string,
    grade = 'grade_a',
    date = day(0),
  ) =>
    as<{ id: string }>(
      user,
      `select public.record_harvest_delivery($1, $2, $3, $4, $5, $6, $7, 13.5) as id`,
      [built.cycleId, farm, built.offtakeId, date, kg, grade, waybill],
    ).then((rows) => rows[0].id);

  const receipt = (user: string, built: Built, kind: string, amount: number, ref: string) =>
    as(user, `select public.record_cycle_receipt($1, $2, $3, $4, $5)`, [
      built.cycleId,
      kind,
      kind === 'offtake_payment' ? built.offtakeId : built.policyId,
      amount,
      ref,
    ]);

  const preview = async (built: Built) =>
    (
      await as<{ s: Settlement }>(manager, `select public.settlement_preview($1) as s`, [
        built.cycleId,
      ])
    )[0].s;

  beforeAll(async () => {
    db = await createDb();
    manager = await createUser(db, 'manager@agrowth.test', 'cycle_manager');
    compliance = await createUser(db, 'compliance@agrowth.test', 'compliance_officer');
    trustee = await createUser(db, 'trustee@agrowth.test', 'trustee');
    agent = await createUser(db, 'agent@agrowth.test', 'field_agent');
    investor = await createUser(db, 'investor@example.com', 'investor');
  });

  it('splits amounts exactly, giving leftover kobo to the largest remainders', async () => {
    const rows = (
      await db.query<{ key: string; amount: string }>(
        `select key, amount::text from private.allocate(100, $1)`,
        [
          JSON.stringify([
            { key: 'a', weight: 1 },
            { key: 'b', weight: 1 },
            { key: 'c', weight: 1 },
          ]),
        ],
      )
    ).rows;
    expect(rows).toEqual([
      { key: 'a', amount: '34' },
      { key: 'b', amount: '33' },
      { key: 'c', amount: '33' },
    ]);
    const big = await one<{ total: string }>(
      `select sum(amount)::text as total from private.allocate(999999999999, $1)`,
      [
        JSON.stringify([
          { key: 'x', weight: 333333333333 },
          { key: 'y', weight: 7 },
          { key: 'z', weight: 1 },
        ]),
      ],
    );
    expect(big.total).toBe('999999999999');
  });

  describe('a profitable cycle', () => {
    const lons: [number, number] = [8.1, 8.11];
    let built: Built;
    let goodDelivery: string;

    beforeAll(async () => {
      built = await buildFundedCycle('KD-PROFIT-01', lons, [
        ['Adaeze Okoro', 60_000_000],
        ['Chidi Nwosu', 30_000_000],
      ]);
      await releaseMilestone(built, 0, lons);
    });

    it('records weighed deliveries from field staff only', async () => {
      for (const user of [investor, trustee, compliance]) {
        const err = await pgError(deliver(user, built, built.farms[0], 1000, 'WB-NOPE'));
        expect(err.code).toBe('PT403');
      }
      goodDelivery = await deliver(agent, built, built.farms[0], 3000, 'WB-001');
      await deliver(manager, built, built.farms[1], 1000, 'WB-002');
      await deliver(agent, built, built.farms[1], 500, 'WB-003', 'rejected');
      expect(goodDelivery).toBeTruthy();
    });

    it('refuses a repeated waybill, a future date and a farm outside the cycle', async () => {
      expect((await pgError(deliver(agent, built, built.farms[0], 10, 'WB-001'))).code).toBe(
        'PT409',
      );
      expect(
        (await pgError(deliver(agent, built, built.farms[0], 10, 'WB-X', 'grade_a', day(2))))
          .message,
      ).toMatch(/future/);
      const stray = await verifiedFarm('Stray', 8.3);
      expect((await pgError(deliver(agent, built, stray, 10, 'WB-Y'))).message).toMatch(
        /not part of this cycle/,
      );
    });

    it('voids a mistaken delivery with a reason, and leaves it out of the totals', async () => {
      const wrong = await deliver(agent, built, built.farms[1], 800, 'WB-004');
      expect(
        (await pgError(as(agent, `select public.void_harvest_delivery($1, ' ')`, [wrong]))).code,
      ).toBe('PT400');
      await as(agent, `select public.void_harvest_delivery($1, 'Weighed twice')`, [wrong]);
      expect(
        (await pgError(as(agent, `select public.void_harvest_delivery($1, 'again')`, [wrong])))
          .code,
      ).toBe('PT409');
      expect((await preview(built)).accepted_kg).toBe(4000);
    });

    it('does not complete the harvest until every milestone is released', async () => {
      const err = await pgError(as(manager, `select public.complete_harvest($1)`, [built.cycleId]));
      expect(err.message).toMatch(/Milestone 2/);
      await releaseMilestone(built, 1, lons);
    });

    it('takes receipts from the trustee only and posts them to the ledger', async () => {
      expect(
        (await pgError(receipt(manager, built, 'offtake_payment', 100_000_000, 'RCV-1'))).code,
      ).toBe('PT403');
      await receipt(trustee, built, 'offtake_payment', 100_000_000, 'RCV-1');
      // Insurance pays out through a claim: reported, notified, assessed, then paid.
      expect((await pgError(receipt(trustee, built, 'insurance_payout', 1, 'RCV-9'))).code).toBe(
        'PT400',
      );
      const [{ id: claim }] = await as<{ id: string }>(
        manager,
        `select public.report_insurance_claim($1, 'pests', $2,
           'Stem borer damage across the farms at tasselling.', $3) as id`,
        [built.cycleId, day(-1), JSON.stringify([{ farm_id: built.farms[0], loss_pct: 10 }])],
      );
      await as(manager, `select public.notify_insurance_claim($1, $2)`, [claim, day(0)]);
      await as(manager, `select public.record_claim_assessment($1, $2, 'Assessor', 10000001)`, [
        claim,
        day(0),
      ]);
      await as(trustee, `select public.record_claim_payout($1, 10000001, 'RCV-2', $2)`, [
        claim,
        day(0),
      ]);
      // A bank reference is used once.
      expect((await pgError(receipt(trustee, built, 'offtake_payment', 1, 'RCV-1'))).code).toBe(
        'PT409',
      );
      expect(await balance(built.cycleId, 'TRUSTEE_CASH')).toBe(110_000_001n);
      expect(await balance(built.cycleId, 'HARVEST_PROCEEDS')).toBe(-100_000_000n);
      expect(await balance(built.cycleId, 'INSURANCE_RECOVERIES')).toBe(-10_000_001n);
    });

    it('refuses to settle before the harvest is complete', async () => {
      const err = await pgError(as(trustee, `select public.settle_cycle($1)`, [built.cycleId]));
      expect(err.code).toBe('PT409');
      await as(manager, `select public.complete_harvest($1)`, [built.cycleId]);
      expect(await status(built.cycleId)).toBe('harvested');
      // No more deliveries once the harvest is closed.
      expect((await pgError(deliver(agent, built, built.farms[0], 10, 'WB-LATE'))).code).toBe(
        'PT409',
      );
    });

    it('previews the waterfall: fee, capital, then profit split by agreed share and kilograms', async () => {
      const s = await preview(built);
      expect(s).toMatchObject({
        cash: '110000001',
        capital: '90000000',
        fee: '1800000', // 2% of capital
        capital_returned: '90000000',
        capital_loss: '0',
        profit: '18200001',
        funder_return: '12740001', // 70% of profit
        farmer_surplus: '5460000',
      });
      expect(s.funders.map((f) => [f.name, f.capital, f.return, f.total])).toEqual([
        ['Adaeze Okoro', '60000000', '8493334', '68493334'],
        ['Chidi Nwosu', '30000000', '4246667', '34246667'],
      ]);
      // 3,000 kg and 1,000 kg accepted; the rejected and voided loads don't count.
      expect(s.farmers.map((f) => [f.kg, f.amount])).toEqual([
        [3000, '4095000'],
        [1000, '1365000'],
      ]);
    });

    it('runs settlement as the trustee, creating one payout per payee', async () => {
      expect(
        (await pgError(as(manager, `select public.settle_cycle($1)`, [built.cycleId]))).code,
      ).toBe('PT403');
      const [{ n }] = await as<{ n: number }>(trustee, `select public.settle_cycle($1) as n`, [
        built.cycleId,
      ]);
      expect(n).toBe(5);
      expect(await balance(built.cycleId, 'FARM_DEPLOYMENT')).toBe(0n);
      expect(await balance(built.cycleId, 'PRODUCTION_COST')).toBe(90_000_000n);
      expect(
        (await pgError(as(trustee, `select public.settle_cycle($1)`, [built.cycleId]))).code,
      ).toBe('PT409');
      expect((await pgError(receipt(trustee, built, 'offtake_payment', 1, 'RCV-LATE'))).code).toBe(
        'PT409',
      );
    });

    it('closes the cycle when the last payout is confirmed, with no cash left', async () => {
      const payouts = await as<{ id: string; kind: string }>(
        trustee,
        `select id, kind from public.settlement_payouts where cycle_id = $1 order by created_at, id`,
        [built.cycleId],
      );
      for (const [i, p] of payouts.entries()) {
        expect(await status(built.cycleId)).toBe('harvested');
        await as(trustee, `select public.confirm_settlement_payout($1, $2)`, [p.id, `SET-${i}`]);
      }
      expect(
        (
          await pgError(
            as(trustee, `select public.confirm_settlement_payout($1, 'SET-9')`, [payouts[0].id]),
          )
        ).code,
      ).toBe('PT409');

      expect(await status(built.cycleId)).toBe('settled');
      expect(await balance(built.cycleId, 'TRUSTEE_CASH')).toBe(0n);
      expect(await balance(built.cycleId, 'FUNDER_CAPITAL')).toBe(0n);
      expect(await balance(built.cycleId, 'FUNDER_RETURNS')).toBe(12_740_001n);
      expect(await balance(built.cycleId, 'FARMER_SURPLUS')).toBe(5_460_000n);
      expect(await balance(built.cycleId, 'PLATFORM_FEES')).toBe(1_800_000n);
      const offtake = await one<{ status: string }>(
        `select status from public.offtake_contracts where id = $1`,
        [built.offtakeId],
      );
      expect(offtake.status).toBe('fulfilled'); // 4 t delivered against 4 t
    });

    it('cannot be written to directly', async () => {
      for (const sql of [
        `update public.settlement_payouts set amount_kobo = 1`,
        `insert into public.cycle_receipts (cycle_id) values ('${built.cycleId}')`,
        `update public.harvest_deliveries set weight_kg = 1`,
      ]) {
        expect((await pgError(as(trustee, sql))).code).toBe('42501');
      }
    });
  });

  describe('a loss-making cycle', () => {
    const lons: [number, number] = [8.2, 8.21];
    let built: Built;

    beforeAll(async () => {
      built = await buildFundedCycle('KD-LOSS-01', lons, [
        ['Funder One', 45_000_000],
        ['Funder Two', 45_000_000],
      ]);
      await releaseMilestone(built, 0, lons);
      await releaseMilestone(built, 1, lons);
      await deliver(agent, built, built.farms[0], 1200, 'WB-L1');
      await as(manager, `select public.complete_harvest($1)`, [built.cycleId]);
      await receipt(trustee, built, 'offtake_payment', 36_000_000, 'RCV-L1');
    });

    it('charges the fee, then funders share the shortfall and farmers get nothing', async () => {
      const s = await preview(built);
      expect(s).toMatchObject({
        cash: '36000000',
        fee: '1800000',
        capital_returned: '34200000',
        capital_loss: '55800000',
        profit: '0',
        farmer_surplus: '0',
      });
      expect(s.funders.map((f) => [f.capital, f.loss])).toEqual([
        ['17100000', '27900000'],
        ['17100000', '27900000'],
      ]);
    });

    it('records the loss in the ledger and settles to zero', async () => {
      await as(trustee, `select public.settle_cycle($1)`, [built.cycleId]);
      expect(await balance(built.cycleId, 'CAPITAL_LOSS')).toBe(-55_800_000n);
      const payouts = await as<{ id: string }>(
        trustee,
        `select id from public.settlement_payouts where cycle_id = $1`,
        [built.cycleId],
      );
      expect(payouts).toHaveLength(3); // fee and two funders; no farmer surplus
      for (const [i, p] of payouts.entries()) {
        await as(trustee, `select public.confirm_settlement_payout($1, $2)`, [p.id, `LSET-${i}`]);
      }
      expect(await status(built.cycleId)).toBe('settled');
      expect(await balance(built.cycleId, 'TRUSTEE_CASH')).toBe(0n);
      expect(await balance(built.cycleId, 'FUNDER_CAPITAL')).toBe(0n);
    });
  });
});
