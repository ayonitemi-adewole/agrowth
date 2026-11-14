import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createDb, createUser, pgError, square, type Tx } from './db';

const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

interface VisitResult {
  visit_id: string;
  passed: boolean;
  milestone_status: string;
  duplicate: boolean;
}

/**
 * Visits recorded offline and synced later: the phone's reference makes a resend safe,
 * and the visit is judged on when the agent was at the farm.
 */
describe('offline field visits', () => {
  let db: PGlite;
  let manager: string;
  let compliance: string;
  let trustee: string;
  let agent: string;
  let otherAgent: string;
  let farms: string[];
  let milestone: string;
  let requestedAt: string;

  const as = <T>(user: string, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (tx: Tx) => (await tx.query<T>(sql, params)).rows);

  const visit = (
    user: string,
    farm: string,
    lon: number,
    ref: string | null,
    visitedAt: string = new Date().toISOString(),
  ) =>
    as<{ r: VisitResult }>(
      user,
      `select public.record_field_visit($1, $2, $3, 11.30045, 5, 'good', true, $4, null, $5, $6, p_portrait_path => 'visit/portrait.jpg') as r`,
      [farm, milestone, lon + 0.00045, ['m/f/photo.jpg'], visitedAt, ref],
    ).then((rows) => rows[0].r);

  beforeAll(async () => {
    db = await createDb();
    manager = await createUser(db, 'manager@test.ng', 'cycle_manager');
    compliance = await createUser(db, 'compliance@test.ng', 'compliance_officer');
    trustee = await createUser(db, 'trustee@test.ng', 'trustee');
    agent = await createUser(db, 'agent@test.ng', 'field_agent');
    otherAgent = await createUser(db, 'agent2@test.ng', 'field_agent');

    farms = [];
    for (const [i, last] of ['Audu', 'Bello'].entries()) {
      const [{ id: farmer }] = await as<{ id: string }>(
        agent,
        `select public.register_farmer('Farmer', $1, '+2348044440000', 'Kaduna', 'Zaria', $2, p_portrait_path => auth.uid()::text || '/portrait.jpg') as id`,
        [last, String(90_000_000_000 + i)],
      );
      await as(compliance, `select public.set_farmer_kyc($1, 'verified', 'NIN slip seen')`, [
        farmer,
      ]);
      const [{ id }] = await as<{ id: string }>(
        agent,
        `select public.map_farm($1, $2, p_photo_paths => array[auth.uid()::text || '/farm.jpg']) as id`,
        [farmer, JSON.stringify(square(8.5 + i * 0.01, 11.3))],
      );
      farms.push(id);
    }
    const [{ id: cycle }] = await as<{ id: string }>(
      manager,
      `insert into public.cycles (code, crop, season, funding_source, target_amount_kobo,
         budget_per_hectare_kobo, yield_low_t_per_ha, yield_expected_t_per_ha, yield_high_t_per_ha,
         price_low_per_tonne_kobo, price_expected_per_tonne_kobo, price_high_per_tonne_kobo,
         funding_deadline, start_date, expected_harvest_date)
       values ('KD-OFFLINE-01', 'maize', '2027 wet', 'investor', 90000000, 50000000, 2, 3, 4,
               30000000, 38000000, 45000000, $1, $2, $3)
       returning id`,
      [day(10), day(20), day(140)],
    );
    await as(
      manager,
      `insert into public.cycle_farms (cycle_id, farm_id) values ($1, $2), ($1, $3)`,
      [cycle, ...farms],
    );
    [{ id: milestone }] = await as<{ id: string }>(
      manager,
      `insert into public.milestones (cycle_id, sequence, name, planned_date, amount_kobo)
       values ($1, 1, 'Planting', $2, 90000000) returning id`,
      [cycle, day(25)],
    );
    await as(
      manager,
      `insert into public.offtake_contracts (cycle_id, buyer_name, commodity, volume_tonnes,
         price_terms, price_floor_per_tonne_kobo, document_path, signed_on)
       values ($1, 'Northern Mills Ltd', 'maize', 10, 'floor', 30000000, $2, $3)`,
      [cycle, `${cycle}/offtake.pdf`, day(0)],
    );
    await as(
      manager,
      `insert into public.insurance_policies (cycle_id, insurer_name, policy_number, cover_type,
         sum_insured_kobo, premium_kobo, loss_payee, cover_start, cover_end, document_path)
       values ($1, 'Pula Assurance', 'POL-OFF', 'area_yield', 90000000, 2700000,
               'Trustee on behalf of funders', $2, $3, $4)`,
      [cycle, day(20), day(150), `${cycle}/policy.pdf`],
    );
    await as(manager, `select public.submit_cycle($1)`, [cycle]);
    await as(compliance, `select public.review_cycle($1, true, null)`, [cycle]);
    await as(trustee, `select public.record_funding($1, 'Fund', 'investor', 90000000, 'DEP-OFF')`, [
      cycle,
    ]);
    await as(manager, `select public.request_milestone_verification($1)`, [milestone]);
    requestedAt = (
      await db.query<{ t: string }>(
        `select verification_requested_at::text as t from public.milestones where id = $1`,
        [milestone],
      )
    ).rows[0].t;
  });

  let firstRef: string;

  it('records a visit sent twice only once, answering the resend with the first result', async () => {
    firstRef = crypto.randomUUID();
    const first = await visit(agent, farms[0], 8.5, firstRef);
    expect(first).toMatchObject({ passed: true, duplicate: false });
    const again = await visit(agent, farms[0], 8.5, firstRef);
    expect(again).toMatchObject({ visit_id: first.visit_id, passed: true, duplicate: true });
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.field_visits where client_ref = $1`,
      [firstRef],
    );
    expect(rows[0].n).toBe(1);
  });

  it("refuses another agent's reference", async () => {
    expect((await pgError(visit(otherAgent, farms[0], 8.5, firstRef))).message).toMatch(
      /belongs to another agent/,
    );
  });

  it('still refuses a visit dated before verification was requested', async () => {
    const early = new Date(new Date(requestedAt).getTime() - 60_000).toISOString();
    expect(
      (await pgError(visit(agent, farms[1], 8.51, crypto.randomUUID(), early))).message,
    ).toMatch(/before verification was requested/);
  });

  it('judges a late sync on when the agent was at the farm, and keeps that time', async () => {
    // Visited a second after verification was requested; it arrives whenever coverage returns.
    const visitedAt = new Date(new Date(requestedAt).getTime() + 1_000).toISOString();
    const ref = crypto.randomUUID();
    const r = await visit(agent, farms[1], 8.51, ref, visitedAt);
    expect(r).toMatchObject({ passed: true, milestone_status: 'verified' });
    const { rows } = await db.query<{ same: boolean }>(
      `select visited_at = $2::timestamptz as same from public.field_visits where client_ref = $1`,
      [ref, visitedAt],
    );
    expect(rows[0].same).toBe(true);
  });
});
