import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createDb, createUser, pgError, square, type Tx } from './db';

const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const lagosToday = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10); // WAT is UTC+1, no DST

interface CheckResult {
  check_id: string;
  gps_ok: boolean;
  distance_from_boundary_m: number;
  next_due_on: string | null;
  duplicate: boolean;
}

interface ScheduleRow {
  farm_id: string;
  interval_days: number;
  starts_on: string;
  last_check_at: string | null;
  checks: number;
  next_due_on: string;
  days_overdue: number;
}

/**
 * Photos of the farmer and the farm at enrolment and at every visit, and routine farm
 * checks every N days once a cycle has begun — separate from milestones and money.
 */
describe('farm photos and routine farm checks', () => {
  let db: PGlite;
  let manager: string;
  let compliance: string;
  let trustee: string;
  let agent: string;
  let otherAgent: string;
  let auditor: string;
  let farmers: string[];
  let farms: string[];
  let cycle: string;
  let milestone: string;
  let nextNin = 70_000_000_000;

  const as = <T>(user: string, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (tx: Tx) => (await tx.query<T>(sql, params)).rows);

  const enrol = (user: string, portrait: string | null) =>
    as<{ id: string }>(
      user,
      `select public.register_farmer('Farmer', 'Check', '+2348055550000', 'Kaduna', 'Zaria',
         $1, p_portrait_path => $2) as id`,
      [String(nextNin++), portrait],
    ).then((rows) => rows[0].id);

  const check = (
    farm: string,
    opts: {
      user?: string;
      lon?: number;
      accuracy?: number;
      condition?: string;
      portrait?: string | null;
      photos?: string[];
      ref?: string | null;
      visitedAt?: string;
    } = {},
  ) => {
    const i = farms.indexOf(farm);
    return as<{ r: CheckResult }>(
      opts.user ?? agent,
      `select public.record_farm_check($1, $2, $3, 11.40045, $4, $5, $6, $7, null, $8, $9) as r`,
      [
        cycle,
        farm,
        opts.lon ?? 8.6 + i * 0.01 + 0.00045,
        opts.accuracy ?? 5,
        opts.condition ?? 'good',
        opts.portrait === undefined ? `checks/${cycle}/${farm}/portrait.jpg` : opts.portrait,
        opts.photos ?? [`checks/${cycle}/${farm}/farm.jpg`],
        opts.visitedAt ?? new Date().toISOString(),
        opts.ref ?? null,
      ],
    ).then((rows) => rows[0].r);
  };

  const schedule = () =>
    as<ScheduleRow>(
      manager,
      `select farm_id, interval_days, starts_on::text, last_check_at::text, checks::int,
              next_due_on::text, days_overdue
         from public.farm_check_schedule where cycle_id = $1`,
      [cycle],
    );

  beforeAll(async () => {
    db = await createDb();
    manager = await createUser(db, 'manager@test.ng', 'cycle_manager');
    compliance = await createUser(db, 'compliance@test.ng', 'compliance_officer');
    trustee = await createUser(db, 'trustee@test.ng', 'trustee');
    agent = await createUser(db, 'agent@test.ng', 'field_agent');
    otherAgent = await createUser(db, 'agent2@test.ng', 'field_agent');
    auditor = await createUser(db, 'auditor@test.ng', 'auditor');

    farmers = [];
    farms = [];
    for (const i of [0, 1]) {
      const farmer = await enrol(agent, `${agent}/portrait-${i}.jpg`);
      await as(compliance, `select public.set_farmer_kyc($1, 'verified', 'NIN slip seen')`, [
        farmer,
      ]);
      const [{ id }] = await as<{ id: string }>(
        agent,
        `select public.map_farm($1, $2, p_photo_paths => $3) as id`,
        [farmer, JSON.stringify(square(8.6 + i * 0.01, 11.4)), [`${agent}/farm-${i}.jpg`]],
      );
      farmers.push(farmer);
      farms.push(id);
    }

    [{ id: cycle }] = await as<{ id: string }>(
      manager,
      `insert into public.cycles (code, crop, season, funding_source, target_amount_kobo,
         budget_per_hectare_kobo, yield_low_t_per_ha, yield_expected_t_per_ha, yield_high_t_per_ha,
         price_low_per_tonne_kobo, price_expected_per_tonne_kobo, price_high_per_tonne_kobo,
         funding_deadline, start_date, expected_harvest_date, monitoring_interval_days)
       values ('KD-CHECKS-01', 'maize', '2027 wet', 'investor', 90000000, 50000000, 2, 3, 4,
               30000000, 38000000, 45000000, $1, $2, $3, 10)
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
       values ($1, 'Pula Assurance', 'POL-CHK', 'area_yield', 90000000, 2700000,
               'Trustee on behalf of funders', $2, $3, $4)`,
      [cycle, day(20), day(150), `${cycle}/policy.pdf`],
    );
    await as(manager, `select public.submit_cycle($1)`, [cycle]);
    await as(compliance, `select public.review_cycle($1, true, null)`, [cycle]);
    await as(trustee, `select public.record_funding($1, 'Fund', 'investor', 90000000, 'DEP-CHK')`, [
      cycle,
    ]);
  });

  describe('photos at enrolment', () => {
    it('needs a portrait of the farmer to enrol them', async () => {
      expect((await pgError(enrol(agent, null))).message).toMatch(/portrait of the farmer/);
    });

    it("refuses a portrait uploaded by someone else's account", async () => {
      expect((await pgError(enrol(agent, `${otherAgent}/portrait.jpg`))).message).toMatch(
        /one you uploaded/,
      );
    });

    it('keeps the portrait on the farmer and the farm photos on the farm', async () => {
      const [f] = await as<{ portrait_path: string }>(
        manager,
        `select portrait_path from public.farmers where id = $1`,
        [farmers[0]],
      );
      expect(f.portrait_path).toBe(`${agent}/portrait-0.jpg`);
      const [m] = await as<{ photo_paths: string[] }>(
        manager,
        `select photo_paths from public.farm_maps where id = $1`,
        [farms[0]],
      );
      expect(m.photo_paths).toEqual([`${agent}/farm-0.jpg`]);
    });

    it("needs a photo of the farm's condition to map it", async () => {
      const farmer = await enrol(agent, `${agent}/p.jpg`);
      const map = (photos: string[] | null) =>
        as(agent, `select public.map_farm($1, $2, p_photo_paths => $3)`, [
          farmer,
          JSON.stringify(square(8.9, 11.4)),
          photos,
        ]);
      expect((await pgError(map(null))).message).toMatch(/photo of the farm/);
      expect((await pgError(map([]))).message).toMatch(/photo of the farm/);
      expect((await pgError(map([`${otherAgent}/x.jpg`]))).message).toMatch(/one you uploaded/);
    });

    it('lets agents upload registry photos only under their own id', async () => {
      const upload = (user: string, name: string) =>
        as(user, `insert into storage.objects (bucket_id, name) values ('registry-photos', $1)`, [
          name,
        ]);
      await upload(agent, `${agent}/new.jpg`);
      expect((await pgError(upload(agent, `${otherAgent}/new.jpg`))).code).toBe('42501');
      expect((await pgError(upload(manager, `${manager}/new.jpg`))).code).toBe('42501');
    });
  });

  describe('before the season starts', () => {
    it('has nothing due and refuses checks', async () => {
      expect(await schedule()).toEqual([]);
      expect((await pgError(check(farms[0]))).message).toMatch(/start when the season does/);
    });
  });

  describe('milestone visits', () => {
    it("don't pass without a portrait of the farmer", async () => {
      await as(manager, `select public.request_milestone_verification($1)`, [milestone]);
      const visit = (portrait: string | null) =>
        as<{ r: { passed: boolean; has_portrait: boolean } }>(
          agent,
          `select public.record_field_visit($1, $2, 8.60045, 11.40045, 5, 'good', true, $3,
             p_portrait_path => $4) as r`,
          [farms[0], milestone, ['m/f/photo.jpg'], portrait],
        ).then((rows) => rows[0].r);
      expect(await visit(null)).toMatchObject({ passed: false, has_portrait: false });
      expect(await visit('m/f/portrait.jpg')).toMatchObject({ passed: true, has_portrait: true });
    });
  });

  describe('once the season has begun', () => {
    beforeAll(async () => {
      // The season started 25 days ago (as the superuser: approved cycles can't be edited).
      await db.query(
        `update public.cycles set funding_deadline = $2, start_date = $3 where id = $1`,
        [cycle, day(-30), day(-25)],
      );
    });

    it('lists every farm as due the interval after the start, and overdue since', async () => {
      const rows = await schedule();
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        expect(r).toMatchObject({
          interval_days: 10,
          starts_on: day(-25),
          checks: 0,
          last_check_at: null,
          next_due_on: day(-15),
        });
        expect(r.days_overdue).toBeGreaterThanOrEqual(14);
      }
    });

    it('needs a portrait of the farmer and a photo of the farm', async () => {
      expect((await pgError(check(farms[0], { portrait: null }))).message).toMatch(
        /portrait of the farmer/,
      );
      expect((await pgError(check(farms[0], { photos: [] }))).message).toMatch(/photo of the farm/);
      expect((await pgError(check(farms[0], { photos: ['  '] }))).message).toMatch(
        /photo of the farm/,
      );
    });

    it('refuses other roles, and checks dated before the start or in the future', async () => {
      expect((await pgError(check(farms[0], { user: manager }))).message).toMatch(
        /Only field agents/,
      );
      const early = new Date(Date.now() - 27 * 86_400_000).toISOString();
      expect((await pgError(check(farms[0], { visitedAt: early }))).message).toMatch(
        /start when the season does/,
      );
      const future = new Date(Date.now() + 3_600_000).toISOString();
      expect((await pgError(check(farms[0], { visitedAt: future }))).message).toMatch(
        /in the future/,
      );
    });

    let firstRef: string;

    it('records a check at the farm and moves the farm’s next check on', async () => {
      firstRef = crypto.randomUUID();
      const r = await check(farms[0], { ref: firstRef });
      expect(r).toMatchObject({ gps_ok: true, duplicate: false });
      expect(Number(r.distance_from_boundary_m)).toBe(0);
      const row = (await schedule()).find((s) => s.farm_id === farms[0])!;
      expect(row.checks).toBe(1);
      expect(row.days_overdue).toBe(0);
      // Due 10 days after the check (in Nigerian time).
      const due = new Date(lagosToday());
      due.setUTCDate(due.getUTCDate() + 10);
      expect(row.next_due_on).toBe(due.toISOString().slice(0, 10));
      expect(r.next_due_on).toBe(row.next_due_on);
    });

    it('records a check sent twice only once', async () => {
      const again = await check(farms[0], { ref: firstRef });
      expect(again.duplicate).toBe(true);
      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int as n from public.farm_checks where client_ref = $1`,
        [firstRef],
      );
      expect(rows[0].n).toBe(1);
      expect((await pgError(check(farms[0], { user: otherAgent, ref: firstRef }))).message).toMatch(
        /belongs to another agent/,
      );
    });

    it("keeps a check made away from the farm, but it doesn't count towards the schedule", async () => {
      const r = await check(farms[1], { lon: 8.65 });
      expect(r.gps_ok).toBe(false);
      expect(Number(r.distance_from_boundary_m)).toBeGreaterThan(20);
      const row = (await schedule()).find((s) => s.farm_id === farms[1])!;
      expect(row).toMatchObject({ checks: 1, last_check_at: null, next_due_on: day(-15) });
      expect(row.days_overdue).toBeGreaterThan(0);
    });

    it('logs a crop in poor shape in the cycle history', async () => {
      await check(farms[1], { condition: 'poor' });
      const events = await as<{ kind: string; message: string }>(
        manager,
        `select kind, message from public.cycle_events where cycle_id = $1 and kind = 'farm_check_alert'`,
        [cycle],
      );
      expect(events).toHaveLength(1);
      expect(events[0].message).toMatch(/serious issues/);
    });

    it('does not touch milestones or money', async () => {
      const [m] = await as<{ status: string }>(
        manager,
        `select status from public.milestones where id = $1`,
        [milestone],
      );
      expect(m.status).toBe('awaiting_verification');
    });

    it('lets managers change the interval, logged, and refuses others', async () => {
      expect(
        (await pgError(as(agent, `select public.set_monitoring_interval($1, 7)`, [cycle]))).message,
      ).toMatch(/Only cycle or programme managers/);
      expect(
        (await pgError(as(manager, `select public.set_monitoring_interval($1, 0)`, [cycle])))
          .message,
      ).toMatch(/between 1 and 90/);
      await as(manager, `select public.set_monitoring_interval($1, 7)`, [cycle]);
      expect((await schedule()).every((r) => r.interval_days === 7)).toBe(true);
      const events = await as<{ message: string }>(
        manager,
        `select message from public.cycle_events where cycle_id = $1 and kind = 'monitoring_interval'`,
        [cycle],
      );
      expect(events.map((e) => e.message)).toEqual(['Farm checks: every 7 days (was every 10)']);
    });

    it('shows checks to staff who read cycles, never as edits', async () => {
      const rows = await as<{ portrait_path: string; lon: number }>(
        auditor,
        `select portrait_path, lon from public.farm_check_evidence where cycle_id = $1`,
        [cycle],
      );
      expect(rows.length).toBe(3);
      expect(
        (
          await pgError(
            db.query(`update public.farm_checks set notes = 'edited' where cycle_id = $1`, [cycle]),
          )
        ).message,
      ).toBeTruthy();
    });

    it('stops once the harvest is in', async () => {
      await db.query(`update public.cycles set status = 'harvested' where id = $1`, [cycle]);
      expect((await pgError(check(farms[0]))).message).toMatch(/under way/);
      expect(await schedule()).toEqual([]);
      expect(
        (await pgError(as(manager, `select public.set_monitoring_interval($1, 5)`, [cycle])))
          .message,
      ).toMatch(/ended/);
    });
  });
});
