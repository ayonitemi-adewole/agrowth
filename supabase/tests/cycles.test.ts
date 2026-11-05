import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createDb, createUser, pgError, square, type Tx } from './db';

/** A date `days` from today, as YYYY-MM-DD. */
const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

interface Check {
  key: string;
  ok: boolean;
  detail: string | null;
}

/**
 * Walks one cycle through its whole life, as each role would:
 * draft → submitted → rejected → approved → funded → verified → released.
 */
describe('a funding cycle, end to end', () => {
  let db: PGlite;
  let admin: string;
  let manager: string;
  let compliance: string;
  let trustee: string;
  let agent: string;
  let investor: string;
  let farmerA: string;
  let farmerB: string;
  let farmA: string;
  let farmB: string;
  let strayFarm: string;
  let cycleId: string;
  let milestone1: string;
  let milestone2: string;

  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows[0];
  const as = <T>(user: string, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (tx: Tx) => (await tx.query<T>(sql, params)).rows);
  const readiness = async () =>
    (await as<{ r: Check[] }>(manager, `select public.cycle_readiness($1) as r`, [cycleId]))[0].r;
  const status = async () =>
    (await one<{ status: string }>(`select status from public.cycles where id = $1`, [cycleId]))
      .status;
  const balance = async (code: string) =>
    BigInt(
      (
        await one<{ b: string }>(
          `select balance_kobo as b from public.ledger_balances where cycle_id = $1 and code = $2`,
          [cycleId, code],
        )
      ).b,
    );

  const enrol = async (nin: string, last: string) => {
    const [{ id }] = await as<{ id: string }>(
      agent,
      `select public.register_farmer($1, $2, '+2348012345678', 'Kaduna', 'Zaria', $3) as id`,
      ['Farmer', last, nin],
    );
    return id;
  };
  const mapFarm = async (farmer: string, lon: number) => {
    const [{ id }] = await as<{ id: string }>(agent, `select public.map_farm($1, $2) as id`, [
      farmer,
      JSON.stringify(square(lon, 11.1)),
    ]);
    return id;
  };

  beforeAll(async () => {
    db = await createDb();
    admin = await createUser(db, 'admin@agrowth.test', 'admin');
    manager = await createUser(db, 'manager@agrowth.test', 'cycle_manager');
    compliance = await createUser(db, 'compliance@agrowth.test', 'compliance_officer');
    trustee = await createUser(db, 'trustee@agrowth.test', 'trustee');
    agent = await createUser(db, 'agent@agrowth.test', 'field_agent');
    investor = await createUser(db, 'investor@example.com', 'investor');

    farmerA = await enrol('11111111111', 'Audu');
    farmerB = await enrol('22222222222', 'Bello');
    farmA = await mapFarm(farmerA, 7.7);
    farmB = await mapFarm(farmerB, 7.71);
    strayFarm = await mapFarm(farmerA, 7.72);
  });

  describe('building the draft', () => {
    it('lets a cycle manager create a draft, owned by them', async () => {
      const [row] = await as<{ id: string; manager_id: string; status: string }>(
        manager,
        `insert into public.cycles (code, crop, season, funding_source, target_amount_kobo,
           budget_per_hectare_kobo, yield_low_t_per_ha, yield_expected_t_per_ha, yield_high_t_per_ha)
         values ('KD-MAIZE-2027-001', 'maize', '2027 wet', 'investor', 90000000, 50000000, 2, 3, 4)
         returning id, manager_id, status`,
      );
      cycleId = row.id;
      expect(row).toMatchObject({ manager_id: manager, status: 'draft' });
    });

    it('does not let field agents or investors create cycles', async () => {
      for (const user of [agent, investor]) {
        const err = await pgError(
          as(
            user,
            `insert into public.cycles (code, crop, season, funding_source, target_amount_kobo,
               budget_per_hectare_kobo, yield_low_t_per_ha, yield_expected_t_per_ha, yield_high_t_per_ha)
             values ('KD-NOPE', 'maize', '2027 wet', 'investor', 1, 1, 1, 2, 3)`,
          ),
        );
        expect(err.code).toBe('42501');
      }
    });

    it('does not let anyone set a cycle status directly', async () => {
      const err = await pgError(
        as(manager, `update public.cycles set status = 'funded' where id = $1`, [cycleId]),
      );
      expect(err.code).toBe('42501');
    });

    it('refuses to submit an incomplete cycle and says what is missing', async () => {
      const checks = await readiness();
      expect(checks.filter((c) => !c.ok).map((c) => c.key)).toEqual(
        expect.arrayContaining(['farms', 'milestones', 'offtake', 'insurance', 'dates']),
      );
      const err = await pgError(as(manager, `select public.submit_cycle($1)`, [cycleId]));
      expect(err.code).toBe('PT400');
      expect(JSON.parse(err.detail!).length).toBeGreaterThan(3);
    });

    it('fills in farms, schedule, prices and dates', async () => {
      await as(
        manager,
        `insert into public.cycle_farms (cycle_id, farm_id) values ($1, $2), ($1, $3)`,
        [cycleId, farmA, farmB],
      );
      const ms = await as<{ id: string }>(
        manager,
        `insert into public.milestones (cycle_id, sequence, name, planned_date, amount_kobo)
         values ($1, 1, 'Land preparation and planting', $2, 54000000),
                ($1, 2, 'Mid-season inputs', $3, 36000000)
         returning id`,
        [cycleId, day(25), day(70)],
      );
      [milestone1, milestone2] = ms.map((m) => m.id);
      await as(
        manager,
        `update public.cycles set funding_deadline = $2, start_date = $3, expected_harvest_date = $4,
           price_low_per_tonne_kobo = 30000000, price_expected_per_tonne_kobo = 38000000,
           price_high_per_tonne_kobo = 45000000
         where id = $1`,
        [cycleId, day(10), day(20), day(140)],
      );
    });

    it('stores documents only under a draft the manager can edit', async () => {
      await as(
        manager,
        `insert into storage.objects (bucket_id, name) values ('cycle-documents', $1)`,
        [`${cycleId}/offtake.pdf`],
      );
      const agentUpload = await pgError(
        as(agent, `insert into storage.objects (bucket_id, name) values ('cycle-documents', $1)`, [
          `${cycleId}/fake.pdf`,
        ]),
      );
      expect(agentUpload.code).toBe('42501');
      const badPath = await pgError(
        as(
          manager,
          `insert into storage.objects (bucket_id, name) values ('cycle-documents', 'loose.pdf')`,
        ),
      );
      expect(badPath.code).toBe('42501');
    });

    it('requires the offtake to cover at least the low-yield harvest', async () => {
      // ~1.96 ha × 2 t/ha low yield ≈ 3.9 t, so 3 t is not enough.
      await as(
        manager,
        `insert into public.offtake_contracts (cycle_id, buyer_name, commodity, volume_tonnes,
           price_terms, price_floor_per_tonne_kobo, document_path, signed_on)
         values ($1, 'Northern Mills Ltd', 'maize', 3, 'floor', 30000000, $2, $3)`,
        [cycleId, `${cycleId}/offtake.pdf`, day(0)],
      );
      const offtake = (await readiness()).find((c) => c.key === 'offtake')!;
      expect(offtake.ok).toBe(false);
      await as(
        manager,
        `update public.offtake_contracts set volume_tonnes = 5 where cycle_id = $1`,
        [cycleId],
      );
      expect((await readiness()).find((c) => c.key === 'offtake')!.ok).toBe(true);
    });

    it('rejects price terms that are missing their price', async () => {
      const err = await pgError(
        as(
          manager,
          `insert into public.offtake_contracts (cycle_id, buyer_name, commodity, volume_tonnes, price_terms)
           values ($1, 'Vague Buyer', 'maize', 10, 'fixed')`,
          [cycleId],
        ),
      );
      expect(err.code).toBe('23514');
    });

    it('requires insurance that covers the budget for the whole season', async () => {
      await as(
        manager,
        `insert into public.insurance_policies (cycle_id, insurer_name, policy_number, cover_type,
           sum_insured_kobo, premium_kobo, loss_payee, cover_start, cover_end, document_path)
         values ($1, 'Pula Assurance', 'AY-2027-0042', 'area_yield', 90000000, 2700000,
                 'Trustee on behalf of funders', $2, $3, $4)`,
        [cycleId, day(20), day(100), `${cycleId}/policy.pdf`],
      );
      const insurance = (await readiness()).find((c) => c.key === 'insurance')!;
      expect(insurance.ok).toBe(false); // cover ends before the harvest
      await as(manager, `update public.insurance_policies set cover_end = $2 where cycle_id = $1`, [
        cycleId,
        day(150),
      ]);
    });

    it('requires every farmer to have passed KYC', async () => {
      expect((await readiness()).find((c) => c.key === 'kyc')!.ok).toBe(false);
      for (const f of [farmerA, farmerB]) {
        await as(compliance, `select public.set_farmer_kyc($1, 'verified')`, [f]);
      }
      const failing = (await readiness()).filter((c) => !c.ok);
      expect(failing).toEqual([]);
    });
  });

  describe('approval', () => {
    it('submits, after which the draft is frozen', async () => {
      await as(manager, `select public.submit_cycle($1)`, [cycleId]);
      expect(await status()).toBe('pending_approval');
      const rows = await as(
        manager,
        `update public.cycles set crop = 'rice' where id = $1 returning id`,
        [cycleId],
      );
      expect(rows).toHaveLength(0);
      const err = await pgError(
        as(
          manager,
          `insert into public.milestones (cycle_id, sequence, name, amount_kobo) values ($1, 3, 'Extra', 1)`,
          [cycleId],
        ),
      );
      expect(err.code).toBe('42501');
    });

    it('needs a reason to reject, and sends the cycle back to draft', async () => {
      const noReason = await pgError(
        as(compliance, `select public.review_cycle($1, false)`, [cycleId]),
      );
      expect(noReason.code).toBe('PT400');
      await as(
        compliance,
        `select public.review_cycle($1, false, 'Attach the signed page of the offtake')`,
        [cycleId],
      );
      expect(await status()).toBe('draft');
      await as(manager, `select public.submit_cycle($1)`, [cycleId]);
    });

    it('re-checks readiness at approval time', async () => {
      await db.query(`update public.farmers set kyc_status = 'rejected' where id = $1`, [farmerB]);
      const err = await pgError(as(compliance, `select public.review_cycle($1, true)`, [cycleId]));
      expect(err.message).toMatch(/not ready/);
      await db.query(`update public.farmers set kyc_status = 'verified' where id = $1`, [farmerB]);
    });

    it('does not let the cycle manager approve their own cycle', async () => {
      const err = await pgError(as(manager, `select public.review_cycle($1, true)`, [cycleId]));
      expect(err.code).toBe('PT403');
    });

    it('opens the cycle for funding and creates its ledger accounts on approval', async () => {
      await as(compliance, `select public.review_cycle($1, true, 'All documents in order')`, [
        cycleId,
      ]);
      expect(await status()).toBe('open_for_funding');
      const accounts = await db.query<{ code: string }>(
        `select code from public.ledger_accounts where cycle_id = $1 order by code`,
        [cycleId],
      );
      expect(accounts.rows.map((a) => a.code)).toEqual([
        'FARM_DEPLOYMENT',
        'FUNDER_CAPITAL',
        'TRUSTEE_CASH',
      ]);
      const { status: offtake } = await one<{ status: string }>(
        `select status from public.offtake_contracts where cycle_id = $1`,
        [cycleId],
      );
      expect(offtake).toBe('approved');
    });

    it('keeps a history of every step', async () => {
      const events = await as<{ kind: string }>(
        compliance,
        `select kind from public.cycle_events where cycle_id = $1 order by created_at`,
        [cycleId],
      );
      expect(events.map((e) => e.kind)).toEqual(['submitted', 'rejected', 'submitted', 'approved']);
      const tamper = await pgError(db.query(`delete from public.cycle_events`));
      expect(tamper.message).toMatch(/append-only/);
    });

    it('stops an admin approving a cycle they manage', async () => {
      const { id } = await one<{ id: string }>(
        `insert into public.cycles (code, crop, season, status, funding_source, target_amount_kobo,
           budget_per_hectare_kobo, yield_low_t_per_ha, yield_expected_t_per_ha, yield_high_t_per_ha, manager_id)
         values ('KD-SELF', 'rice', '2027 wet', 'pending_approval', 'investor', 1, 1, 1, 2, 3, $1) returning id`,
        [admin],
      );
      const err = await pgError(as(admin, `select public.review_cycle($1, true)`, [id]));
      expect(err.message).toMatch(/someone else must review/);
    });
  });

  describe('funding', () => {
    const fund = (user: string, kind: string, amount: number, ref: string) =>
      as(user, `select public.record_funding($1, 'Adaeze Okoro', $2, $3, $4)`, [
        cycleId,
        kind,
        amount,
        ref,
      ]);

    it('accepts deposits only from the trustee', async () => {
      for (const user of [manager, admin]) {
        expect((await pgError(fund(user, 'investor', 1000, 'X-1'))).code).toBe('PT403');
      }
    });

    it('records a deposit in the ledger', async () => {
      await fund(trustee, 'investor', 50_000_000, 'TRX-001');
      expect(await balance('TRUSTEE_CASH')).toBe(50_000_000n);
      expect(await balance('FUNDER_CAPITAL')).toBe(-50_000_000n);
    });

    it('refuses the wrong kind of funder, a repeated reference and oversubscription', async () => {
      expect((await pgError(fund(trustee, 'programme', 1000, 'TRX-002'))).message).toMatch(
        /only accepts investor/,
      );
      expect((await pgError(fund(trustee, 'investor', 1000, 'TRX-001'))).code).toBe('PT409');
      expect((await pgError(fund(trustee, 'investor', 50_000_000, 'TRX-003'))).message).toMatch(
        /past its target/,
      );
    });

    it('marks the cycle funded when the target is reached', async () => {
      await fund(trustee, 'investor', 40_000_000, 'TRX-004');
      expect(await status()).toBe('funded');
      const [progress] = await as<{ raised_kobo: string }>(
        trustee,
        `select raised_kobo from public.cycle_funding where cycle_id = $1`,
        [cycleId],
      );
      expect(BigInt(progress.raised_kobo)).toBe(90_000_000n);
    });
  });

  describe('field verification', () => {
    const visit = (farm: string, lon: number, overrides: Record<string, unknown> = {}) => {
      const v = {
        milestone: milestone1,
        accuracy: 6,
        condition: 'good',
        checklist: true,
        photos: ['m1/farm/photo.jpg'],
        ...overrides,
      };
      return as<{ r: { passed: boolean; gps_ok: boolean; milestone_status: string } }>(
        agent,
        `select public.record_field_visit($1, $2, $3, 11.10045, $4, $5, $6, $7) as r`,
        [farm, v.milestone, lon, v.accuracy, v.condition, v.checklist, v.photos],
      ).then((rows) => rows[0].r);
    };

    it('releases milestones in order', async () => {
      const err = await pgError(
        as(manager, `select public.request_milestone_verification($1)`, [milestone2]),
      );
      expect(err.message).toMatch(/Earlier milestones/);
      await as(manager, `select public.request_milestone_verification($1)`, [milestone1]);
    });

    it('passes a visit with a precise GPS fix inside the farm, a checklist and a photo', async () => {
      const r = await visit(farmA, 7.70045);
      expect(r).toMatchObject({
        passed: true,
        gps_ok: true,
        milestone_status: 'awaiting_verification',
      });
    });

    it('blocks the milestone when a check-in is outside the farm', async () => {
      const r = await visit(farmB, 7.705); // ~300 m from farm B
      expect(r).toMatchObject({ passed: false, gps_ok: false, milestone_status: 'blocked' });
    });

    it('fails a visit without a photo, or with an imprecise GPS fix', async () => {
      expect((await visit(farmB, 7.71045, { photos: [] })).passed).toBe(false);
      expect((await visit(farmB, 7.71045, { accuracy: 45 })).gps_ok).toBe(false);
    });

    it('verifies the milestone once every farm has passed', async () => {
      const r = await visit(farmB, 7.71045);
      expect(r).toMatchObject({ passed: true, milestone_status: 'verified' });
    });

    it('refuses visits to farms outside the cycle, and direct inserts', async () => {
      const err = await pgError(visit(strayFarm, 7.72045, { milestone: milestone2 }));
      expect(err.code).toBe('PT409'); // milestone 2 isn't awaiting verification
      const direct = await pgError(
        as(agent, `insert into public.field_visits (farm_id) values ($1)`, [farmA]),
      );
      expect(direct.code).toBe('42501');
    });
  });

  describe('disbursement', () => {
    const release = (user: string, lines: Record<string, unknown>[]) =>
      as(user, `select public.instruct_milestone_release($1, $2)`, [
        milestone1,
        JSON.stringify(lines),
      ]);
    const line = (kind: string, amount: number, name = 'Zaria Agro Inputs') => ({
      payee_kind: kind,
      payee_name: name,
      payee_account: 'Access Bank 0123456789',
      purpose: 'Seed and fertiliser',
      amount_kobo: String(amount),
    });

    it('limits cash to farmers to 20% of a milestone', async () => {
      const err = await pgError(
        release(manager, [
          line('input_vendor', 37_800_000),
          line('farmer_cash', 16_200_000, 'Farmers'),
        ]),
      );
      expect(err.message).toMatch(/Cash to farmers is limited/);
    });

    it('requires payments to add up to the milestone', async () => {
      const err = await pgError(release(manager, [line('input_vendor', 50_000_000)]));
      expect(err.message).toMatch(/add up to/);
    });

    it('creates instructions for the trustee', async () => {
      await release(manager, [
        line('input_vendor', 44_000_000),
        line('service_provider', 5_000_000, 'Tractor Hire Co-op'),
        line('farmer_cash', 5_000_000, 'Farmer labour allowance'),
      ]);
      const again = await pgError(release(manager, [line('input_vendor', 54_000_000)]));
      expect(again.code).toBe('PT409');
    });

    it('posts each payment when the trustee confirms it, then releases the milestone', async () => {
      const rows = await as<{ id: string }>(
        trustee,
        `select id from public.disbursements where milestone_id = $1 order by amount_kobo desc`,
        [milestone1],
      );
      expect(rows).toHaveLength(3);
      const notTrustee = await pgError(
        as(manager, `select public.confirm_disbursement($1, 'BANK-1')`, [rows[0].id]),
      );
      expect(notTrustee.code).toBe('PT403');

      for (const [i, r] of rows.entries()) {
        await as(trustee, `select public.confirm_disbursement($1, $2)`, [r.id, `BANK-${i}`]);
      }
      const twice = await pgError(
        as(trustee, `select public.confirm_disbursement($1, 'BANK-9')`, [rows[0].id]),
      );
      expect(twice.code).toBe('PT409');

      const m = await one<{ status: string }>(
        `select status from public.milestones where id = $1`,
        [milestone1],
      );
      expect(m.status).toBe('released');
      expect(await status()).toBe('in_progress');
      expect(await balance('TRUSTEE_CASH')).toBe(36_000_000n);
      expect(await balance('FARM_DEPLOYMENT')).toBe(54_000_000n);
    });

    it('never pays out more cash than the trustee holds for the cycle', async () => {
      const { id } = await one<{ id: string }>(
        `insert into public.disbursements (cycle_id, milestone_id, payee_kind, payee_name, payee_account,
           purpose, amount_kobo, instructed_by)
         values ($1, $2, 'input_vendor', 'Greedy Ltd', 'x', 'x', 100000000, $3) returning id`,
        [cycleId, milestone2, manager],
      );
      const err = await pgError(
        as(trustee, `select public.confirm_disbursement($1, 'BANK-X')`, [id]),
      );
      expect(err.message).toMatch(/not hold enough/);
    });
  });

  describe('refunds', () => {
    let other: string;

    it('refunds every funder in full when a cycle misses its deadline', async () => {
      ({ id: other } = await one<{ id: string }>(
        `insert into public.cycles (code, crop, season, status, funding_source, target_amount_kobo,
           budget_per_hectare_kobo, yield_low_t_per_ha, yield_expected_t_per_ha, yield_high_t_per_ha,
           manager_id, funding_deadline, start_date, expected_harvest_date)
         values ('KD-SLOW', 'soybean', '2027 wet', 'open_for_funding', 'blended', 10000000, 1, 1, 2, 3,
                 $1, $2, $3, $4) returning id`,
        [manager, day(5), day(10), day(100)],
      ));
      await db.query(
        `insert into public.ledger_accounts (code, name, type, cycle_id) values
           ('TRUSTEE_CASH', 'c', 'asset', $1), ('FUNDER_CAPITAL', 'f', 'liability', $1),
           ('FARM_DEPLOYMENT', 'd', 'asset', $1)`,
        [other],
      );
      await as(
        trustee,
        `select public.record_funding($1, 'State ADP', 'programme', 3000000, 'SLOW-1')`,
        [other],
      );
      await as(
        trustee,
        `select public.record_funding($1, 'Chidi', 'investor', 2000000, 'SLOW-2')`,
        [other],
      );

      const early = await pgError(as(trustee, `select public.refund_cycle($1)`, [other]));
      expect(early.code).toBe('PT409');

      await db.query(`update public.cycles set funding_deadline = $2 where id = $1`, [
        other,
        day(-1),
      ]);
      const late = await pgError(
        as(trustee, `select public.record_funding($1, 'Late', 'investor', 1, 'SLOW-3')`, [other]),
      );
      expect(late.message).toMatch(/deadline has passed/);

      const [{ n }] = await as<{ n: number }>(trustee, `select public.refund_cycle($1) as n`, [
        other,
      ]);
      expect(n).toBe(2);
      const { b } = await one<{ b: string }>(
        `select balance_kobo as b from public.ledger_balances where cycle_id = $1 and code = 'TRUSTEE_CASH'`,
        [other],
      );
      expect(BigInt(b)).toBe(0n);
      const { status: s } = await one<{ status: string }>(
        `select status from public.cycles where id = $1`,
        [other],
      );
      expect(s).toBe('refunded');
    });
  });

  describe('cancelling', () => {
    it('cancels a draft with a reason, but not a cycle that has started', async () => {
      const [{ id }] = await as<{ id: string }>(
        manager,
        `insert into public.cycles (code, crop, season, funding_source, target_amount_kobo,
           budget_per_hectare_kobo, yield_low_t_per_ha, yield_expected_t_per_ha, yield_high_t_per_ha)
         values ('KD-DROP', 'rice', '2027 dry', 'programme', 1, 1, 1, 2, 3) returning id`,
      );
      expect((await pgError(as(manager, `select public.cancel_cycle($1, '')`, [id]))).code).toBe(
        'PT400',
      );
      await as(manager, `select public.cancel_cycle($1, 'Cooperative withdrew')`, [id]);
      const started = await pgError(
        as(manager, `select public.cancel_cycle($1, 'Too late')`, [cycleId]),
      );
      expect(started.code).toBe('PT409');
    });
  });
});
