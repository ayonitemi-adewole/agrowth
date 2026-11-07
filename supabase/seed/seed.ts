/**
 * Seeds a Supabase project with a lived-in demo portfolio (see portfolio.ts), through the
 * same functions and row-level security the web app uses: each step is done by the demo
 * user whose job it is, and the database checks it exactly as it would a real one.
 *
 * Dates. Business dates (deposits, deliveries, receipts) are set to tell a realistic season.
 * The database refuses a funding deadline in the past, so cycles whose story starts in the
 * past are created with their dates moved forward, run through their lifecycle, and then
 * given their real planned dates. System timestamps (history, field visits, the ledger)
 * are append-only and show when the seed ran.
 */
import type { SeedApi, Session } from './api.ts';
import { fieldPhoto, type FieldStage } from './field-photo.ts';
import {
  COOPERATIVES,
  CYCLES,
  STAFF,
  UNASSIGNED_REJECTED,
  type CoopKey,
  type CoopSpec,
  type CycleSpec,
  type Payee,
  type Stage,
  type StaffKey,
} from './portfolio.ts';

/** How many milestones have been paid out by each stage. */
const RELEASED: Partial<Record<Stage, number>> = { in_progress: 1, harvested: 3, settled: 3 };

export interface SeedOptions {
  password: string;
  offtakePdf: Uint8Array;
  insurancePdf: Uint8Array;
  log?: (message: string) => void;
}

export interface SeedResult {
  accounts: { role: string; email: string; fullName: string }[];
  cycles: { code: string; stage: string }[];
  farmers: number;
}

/** The first cooperative's registration number marks a project as already seeded. */
export async function isSeeded(api: SeedApi): Promise<boolean> {
  const rows = await api.adminSelect('cooperatives', 'id', {
    registration_number: COOPERATIVES[0].registrationNumber,
  });
  return rows.length > 0;
}

// Helpers -----------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const kobo = (naira: number) => Math.round(naira * 100);
const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const floorTo = (n: number, step: number) => Math.floor(n / step) * step;
const naira = (n: number) => `₦${Math.round(n).toLocaleString('en-NG')}`;

/** Deterministic random numbers (mulberry32), so every seed builds the same portfolio. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Splits `total` by `shares`, rounding each part to `step`; the last part takes the remainder. */
function split(total: number, shares: number[], step: number): number[] {
  const parts = shares.slice(0, -1).map((s) => roundTo(total * s, step));
  return [...parts, total - parts.reduce((a, b) => a + b, 0)];
}

/** "2026 wet" for a season starting April–August, otherwise "2026/27 dry". */
function season(start: Date) {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + 1;
  if (m >= 4 && m <= 8) return { label: `${y} wet`, code: `${y % 100}W` };
  const from = m >= 9 ? y : y - 1;
  return {
    label: `${from}/${String((from + 1) % 100).padStart(2, '0')} dry`,
    code: `${from % 100}D`,
  };
}

interface Farm {
  farmerId: string;
  farmId: string;
  farmerName: string;
  farmName: string;
  hectares: number;
  centre: [lon: number, lat: number];
}

const FARM_NAMES = [
  'North field',
  'River field',
  'East block',
  'Dam side',
  'Baobab field',
  'Well field',
  'Lowland plot',
  'Road field',
  'Hill plot',
  'South block',
  'Shea grove',
  'Upper field',
  'Market road',
  'Stream plot',
];
const SOILS = ['Sandy loam', 'Clay loam', 'Loam', 'Silty loam', 'Sandy clay loam'];
const TENURE = ['owned', 'family', 'family', 'leased', 'communal'] as const;
const MAIN_CROP: Record<CoopKey, string> = {
  zaria: 'maize',
  kura: 'rice',
  makurdi: 'soybean',
  ikara: 'sorghum',
};

/**
 * An irregular five-sided field of roughly 1.1–1.9 ha in cell `index` of a four-wide grid.
 * Cells are larger than the fields, so neighbours never overlap.
 */
function farmBoundary(origin: [number, number], index: number, rand: () => number) {
  const cell = 0.0016;
  const size = 0.00095 + rand() * 0.0003;
  const margin = (cell - size) / 2;
  const x0 = origin[0] + (index % 4) * cell + margin;
  const y0 = origin[1] + Math.floor(index / 4) * cell + margin;
  const j = () => (rand() - 0.5) * 0.00016;
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  const ne: [number, number] = [x0 + size + j(), y0 + size + j()];
  const nw: [number, number] = [x0 + j(), y0 + size + j()];
  const corners: [number, number][] = [
    [x0 + j(), y0 + j()],
    [x0 + size + j(), y0 + j()],
    ne,
    // A slight bulge on the north edge, so fields don't look machine-drawn.
    [(ne[0] + nw[0]) / 2, (ne[1] + nw[1]) / 2 + 0.00005 + rand() * 0.00004],
    nw,
  ];
  const ring = [...corners, corners[0]].map(([x, y]) => [r6(x), r6(y)]);
  return {
    geojson: { type: 'Polygon', coordinates: [ring] },
    centre: [x0 + size / 2, y0 + size / 2] as [number, number],
  };
}

// The seed ----------------------------------------------------------------------------------

export async function seedDemo(api: SeedApi, opts: SeedOptions): Promise<SeedResult> {
  const log = opts.log ?? (() => {});
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const date = (offset: number) => new Date(today + offset * DAY_MS);
  const day = (offset: number) => date(offset).toISOString().slice(0, 10);
  const rand = random(20261106);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);

  // Accounts --------------------------------------------------------------------------------
  log('Creating demo accounts');
  const ids = {} as Record<StaffKey, string>;
  for (const s of STAFF) {
    ids[s.key] = await api.ensureUser({
      email: s.email,
      password: opts.password,
      fullName: s.fullName,
      role: s.role,
    });
  }
  const as = (key: StaffKey): Session => api.as(ids[key]);
  const manager = as('manager');
  const compliance = as('compliance');
  const trustee = as('trustee');

  // Which farmers go into which cycle: each cycle takes the next ones from its cooperative.
  const taken: Record<CoopKey, number> = { zaria: 0, kura: 0, makurdi: 0, ikara: 0 };
  const placement = new Map<string, { cycle: string; position: number }>();
  for (const c of CYCLES) {
    for (let p = 0; p < c.farmers; p++) {
      placement.set(`${c.coop}:${taken[c.coop]++}`, { cycle: c.key, position: p });
    }
  }

  // Registry --------------------------------------------------------------------------------
  const coopIds = {} as Record<CoopKey, string>;
  const farmsByCycle = new Map<string, Farm[]>();
  let identity = 0;
  let farmerCount = 0;

  for (const coop of COOPERATIVES) {
    log(`Enrolling ${coop.name}`);
    const agent = as(coop.agent);
    const [row] = await agent.insert('cooperatives', {
      name: coop.name,
      registration_number: coop.registrationNumber,
      contact_phone: coop.phone,
      state: coop.state,
      lga: coop.lga,
      ward: coop.wards[0],
    });
    coopIds[coop.key] = row.id as string;

    for (const [i, [first, last, gender]] of coop.farmers.entries()) {
      const farm = await enrolAndMap(agent, coop, i, first, last, gender);
      farmerCount++;
      const placed = placement.get(`${coop.key}:${i}`);
      const spec = placed && CYCLES.find((c) => c.key === placed.cycle);
      let kyc: 'verified' | 'pending' | 'rejected' = 'verified';
      if (!spec) kyc = i - taken[coop.key] < UNASSIGNED_REJECTED ? 'rejected' : 'pending';
      else if (spec.pendingKyc?.includes(placed.position)) kyc = 'pending';
      if (kyc !== 'pending') {
        await compliance.rpc('set_farmer_kyc', { p_farmer_id: farm.farmerId, p_status: kyc });
      }
      if (placed) {
        const list = farmsByCycle.get(placed.cycle) ?? [];
        list[placed.position] = farm;
        farmsByCycle.set(placed.cycle, list);
      }
    }
  }

  async function enrolAndMap(
    agent: Session,
    coop: CoopSpec,
    i: number,
    first: string,
    last: string,
    gender: 'female' | 'male',
  ): Promise<Farm> {
    const n = identity++;
    const farmerId = await agent.rpc<string>('register_farmer', {
      p_first_name: first,
      p_last_name: last,
      p_phone: `+234803${String(2_100_000 + n * 7_919).padStart(7, '0')}`,
      p_state: coop.state,
      p_lga: coop.lga,
      // Most farmers have both identifiers; some have only one.
      p_nin: n % 3 === 2 ? null : String(61_000_000_000 + n * 7_331),
      p_bvn: n % 3 === 0 ? null : String(22_150_000_000 + n * 4_517),
      p_gender: gender,
      p_date_of_birth: day(-Math.round(between(25, 58) * 365.25)),
      p_ward: coop.wards[i % coop.wards.length],
      p_cooperative_id: coopIds[coop.key],
    });
    const boundary = farmBoundary(coop.origin, i, rand);
    const farmName = FARM_NAMES[i % FARM_NAMES.length];
    const farmId = await agent.rpc<string>('map_farm', {
      p_farmer_id: farmerId,
      p_boundary: boundary.geojson,
      p_name: farmName,
      p_primary_crop: MAIN_CROP[coop.key],
      p_tenure_type: TENURE[i % TENURE.length],
      p_soil_notes: SOILS[(i * 3) % SOILS.length],
    });
    const [farm] = await agent.select('farms', 'area_hectares', { id: farmId });
    return {
      farmerId,
      farmId,
      farmerName: `${first} ${last}`,
      farmName,
      hectares: Number(farm.area_hectares),
      centre: boundary.centre,
    };
  }

  // Cycles ----------------------------------------------------------------------------------
  const codeCounts = new Map<string, number>();
  const cycles: SeedResult['cycles'] = [];
  let waybill = 0;

  for (const spec of CYCLES) {
    const farms = farmsByCycle.get(spec.key)!;
    const coop = COOPERATIVES.find((c) => c.key === spec.coop)!;
    const ha = farms.reduce((s, f) => s + f.hectares, 0);
    const target = floorTo(spec.budgetPerHa * ha * 0.97, 10_000);
    const s = season(date(spec.start));
    const prefix = `${coop.stateCode}-${spec.cropCode}-${s.code}`;
    const nn = (codeCounts.get(prefix) ?? 0) + 1;
    codeCounts.set(prefix, nn);
    const code = `${prefix}-${String(nn).padStart(2, '0')}`;
    log(
      `Building ${code} (${spec.stage.replace(/_/g, ' ')}, ${farms.length} farms, ${naira(target)})`,
    );

    // Cycles whose deadline has passed are created with every date moved forward by `shift`.
    const shift = Math.max(0, -spec.deadline);
    const plan = (offset: number) => day(offset + shift);
    const signedDay = Math.min(spec.deadline - 40, -3);

    const [cycle] = await manager.insert('cycles', {
      code,
      crop: spec.crop,
      season: s.label,
      funding_source: spec.fundingSource,
      cooperative_id: coopIds[spec.coop],
      target_amount_kobo: kobo(target),
      budget_per_hectare_kobo: kobo(spec.budgetPerHa),
      yield_low_t_per_ha: spec.yields[0],
      yield_expected_t_per_ha: spec.yields[1],
      yield_high_t_per_ha: spec.yields[2],
      price_low_per_tonne_kobo: kobo(spec.prices[0]),
      price_expected_per_tonne_kobo: kobo(spec.prices[1]),
      price_high_per_tonne_kobo: kobo(spec.prices[2]),
      funding_deadline: plan(spec.deadline),
      start_date: plan(spec.start),
      expected_harvest_date: plan(spec.harvest),
      management_fee_bps: Math.round(spec.feePct * 100),
      funder_profit_share_bps: Math.round(spec.funderSharePct * 100),
      description: spec.description,
    });
    const cycleId = cycle.id as string;
    cycles.push({ code, stage: spec.stage });

    await manager.insert(
      'cycle_farms',
      farms.map((f) => ({ cycle_id: cycleId, farm_id: f.farmId })),
    );

    const amounts = split(
      target,
      spec.milestones.map((m) => m.share),
      1_000,
    );
    const milestoneRows = await manager.insert(
      'milestones',
      spec.milestones.map((m, i) => ({
        cycle_id: cycleId,
        sequence: i + 1,
        name: m.name,
        description: m.description,
        planned_date: plan(m.day),
        amount_kobo: kobo(amounts[i]),
      })),
    );
    const milestoneIds = [...milestoneRows]
      .sort((a, b) => Number(a.sequence) - Number(b.sequence))
      .map((m) => m.id as string);

    const offtakePath = `${cycleId}/${crypto.randomUUID()}-offtake-agreement.pdf`;
    await manager.upload('cycle-documents', offtakePath, opts.offtakePdf, 'application/pdf');
    const [offtake] = await manager.insert('offtake_contracts', {
      cycle_id: cycleId,
      buyer_name: spec.buyer.name,
      buyer_contact: spec.buyer.contact,
      commodity: spec.crop,
      volume_tonnes: Math.ceil(spec.yields[1] * ha * 1.15 * 2) / 2,
      price_terms: 'floor',
      price_floor_per_tonne_kobo: kobo(spec.prices[0]),
      delivery_window_start: plan(spec.harvest),
      delivery_window_end: plan(spec.harvest + 30),
      signed_on: day(signedDay + shift),
      document_path: offtakePath,
    });
    const offtakeId = offtake.id as string;

    let policyId: string | null = null;
    if (!spec.withoutInsurance) {
      const policyPath = `${cycleId}/${crypto.randomUUID()}-insurance-policy.pdf`;
      await manager.upload('cycle-documents', policyPath, opts.insurancePdf, 'application/pdf');
      const [policy] = await manager.insert('insurance_policies', {
        cycle_id: cycleId,
        insurer_name: spec.insurer.name,
        policy_number: `${spec.insurer.prefix}-${code}`,
        cover_type: spec.insurer.cover,
        sum_insured_kobo: kobo(target),
        premium_kobo: kobo(roundTo(target * 0.03, 1_000)),
        loss_payee: 'Trustee, on behalf of the cycle funders',
        cover_start: plan(spec.start),
        cover_end: plan(spec.harvest + 20),
        document_path: policyPath,
      });
      policyId = policy.id as string;
    }

    const restoreDates = async () => {
      if (shift === 0) return;
      await api.adminUpdate(
        'cycles',
        { id: cycleId },
        {
          funding_deadline: day(spec.deadline),
          start_date: day(spec.start),
          expected_harvest_date: day(spec.harvest),
        },
      );
      for (const [i, m] of spec.milestones.entries()) {
        await api.adminUpdate('milestones', { id: milestoneIds[i] }, { planned_date: day(m.day) });
      }
      await api.adminUpdate(
        'offtake_contracts',
        { id: offtakeId },
        {
          delivery_window_start: day(spec.harvest),
          delivery_window_end: day(spec.harvest + 30),
          signed_on: day(signedDay),
        },
      );
      if (policyId) {
        await api.adminUpdate(
          'insurance_policies',
          { id: policyId },
          {
            cover_start: day(spec.start),
            cover_end: day(spec.harvest + 20),
          },
        );
      }
    };

    if (spec.stage === 'draft') continue;

    // Approval -------------------------------------------------------------------------------
    await manager.rpc('submit_cycle', { p_cycle_id: cycleId });
    if (spec.returnedWith) {
      await compliance.rpc('review_cycle', {
        p_cycle_id: cycleId,
        p_approve: false,
        p_note: spec.returnedWith,
      });
      await manager.rpc('submit_cycle', { p_cycle_id: cycleId });
    }
    if (spec.stage === 'pending_approval') continue;
    await compliance.rpc('review_cycle', { p_cycle_id: cycleId, p_approve: true, p_note: null });

    // Funding --------------------------------------------------------------------------------
    const fullyFunded = spec.stage !== 'open_for_funding';
    const deposits = fullyFunded
      ? split(
          target,
          spec.funders.map((f) => f[1]),
          10_000,
        )
      : spec.funders.map((f) => floorTo(target * f[1], 10_000));
    for (const [i, [name, , received]] of spec.funders.entries()) {
      await trustee.rpc('record_funding', {
        p_cycle_id: cycleId,
        p_funder_name: name,
        p_funder_kind: spec.funderKind ?? 'investor',
        p_amount_kobo: kobo(deposits[i]),
        p_trustee_reference: `DEP-${code}-${String(i + 1).padStart(2, '0')}`,
        p_received_on: day(received),
      });
    }
    if (!fullyFunded) continue;

    // Field verification and releases --------------------------------------------------------
    const agentKey = coop.agent;
    const agent = as(agentKey);
    const STAGES: FieldStage[] = ['soil', 'green', 'golden'];

    const visit = async (farm: Farm, m: number, pass: boolean) => {
      const milestoneId = milestoneIds[m];
      const accuracy = 3 + Math.floor(rand() * 6);
      // A failed visit: the agent checked in from the village, about 340 m away.
      const lon = farm.centre[0] + (pass ? (rand() - 0.5) * 0.0001 : 0.0031);
      const lat = farm.centre[1] + (pass ? (rand() - 0.5) * 0.0001 : 0.0004);
      const path = `${milestoneId}/${farm.farmId}/${crypto.randomUUID()}-photo.svg`;
      const photo = fieldPhoto({
        stage: STAGES[m],
        title: `${farm.farmName} · ${farm.farmerName}`,
        lat,
        lon,
        accuracy,
        takenAt: new Date(),
        variant: Math.floor(rand() * 1000),
      });
      await agent.upload('field-photos', path, photo, 'image/svg+xml');
      const result = await agent.rpc<{ passed: boolean }>('record_field_visit', {
        p_farm_id: farm.farmId,
        p_milestone_id: milestoneId,
        p_lon: lon,
        p_lat: lat,
        p_gps_accuracy_m: accuracy,
        p_crop_condition: rand() < 0.7 ? 'good' : 'fair',
        p_checklist_passed: true,
        p_photo_paths: [path],
        p_notes: pass
          ? spec.milestones[m].visitNotes
          : 'Checked in from the village: the farm track was flooded after the rain.',
      });
      if (result.passed !== pass) {
        throw new Error(
          `Visit to ${farm.farmName} in ${code} should have ${pass ? 'passed' : 'failed'}`,
        );
      }
    };

    const requestVerification = (m: number) =>
      manager.rpc('request_milestone_verification', { p_milestone_id: milestoneIds[m] });

    const release = async (m: number) => {
      const payees: Payee[] = spec.milestones[m].payees;
      const parts = split(
        amounts[m],
        payees.map((p) => p.share),
        1_000,
      );
      await manager.rpc('instruct_milestone_release', {
        p_milestone_id: milestoneIds[m],
        p_lines: payees.map((p, i) => ({
          payee_kind: p.kind,
          payee_name: p.name,
          payee_account: p.account,
          purpose: p.purpose,
          amount_kobo: String(kobo(parts[i])),
        })),
      });
      const lines = await trustee.select('disbursements', 'id, amount_kobo', {
        milestone_id: milestoneIds[m],
      });
      for (const [i, line] of lines.entries()) {
        await trustee.rpc('confirm_disbursement', {
          p_disbursement_id: line.id,
          p_trustee_reference: `PAY-${code}-M${m + 1}-${String(i + 1).padStart(2, '0')}`,
        });
      }
    };

    const releasedCount = RELEASED[spec.stage] ?? 0;
    for (let m = 0; m < releasedCount; m++) {
      await requestVerification(m);
      for (const farm of farms) await visit(farm, m, true);
      await release(m);
    }

    if (spec.stage === 'in_progress') {
      // The mid-season release is blocked: one farm's visit was recorded off-site.
      await requestVerification(1);
      for (const [i, farm] of farms.entries()) await visit(farm, 1, i !== 2);
    }
    if (spec.stage === 'funded') {
      // Verification of the first release is under way: half the farms visited so far.
      await requestVerification(0);
      for (const farm of farms.slice(0, Math.ceil(farms.length / 2))) await visit(farm, 0, true);
    }

    // Harvest and settlement -----------------------------------------------------------------
    const h = spec.harvestResult;
    if (h) {
      const recorder = agent;
      let value = 0;
      let acceptedKg = 0;
      const deliver = async (
        farm: Farm,
        kg: number,
        grade: string,
        moisture: number,
        notes?: string,
      ) => {
        waybill++;
        const id = await recorder.rpc<string>('record_harvest_delivery', {
          p_cycle_id: cycleId,
          p_farm_id: farm.farmId,
          p_offtake_contract_id: offtakeId,
          p_delivered_on: day(Math.round(between(h.deliveryDays[0], h.deliveryDays[1]))),
          p_weight_kg: kg,
          p_grade: grade,
          p_waybill_reference: `WB-${code}-${String(waybill).padStart(3, '0')}`,
          p_moisture_pct: moisture,
          p_notes: notes ?? null,
        });
        return id;
      };

      for (const farm of farms) {
        const total = Math.round(farm.hectares * h.yieldPerHa * 1000 * between(0.9, 1.1));
        // One truck carries about 3.5 t.
        const trucks = Math.max(1, Math.ceil(total / 3500));
        const loads = split(total, Array<number>(trucks).fill(1 / trucks), 10);
        for (const kg of loads) {
          const gradeA = rand() < 0.75;
          await deliver(
            farm,
            kg,
            gradeA ? 'grade_a' : 'grade_b',
            Math.round(between(12.5, 14.5) * 10) / 10,
          );
          acceptedKg += kg;
          value += (kg / 1000) * h.pricePerTonne * (gradeA ? 1 : 0.96);
        }
      }
      if (h.rejectedLoad) {
        await deliver(
          farms[farms.length - 1],
          350,
          'rejected',
          19.5,
          'Mouldy and above the moisture limit',
        );
      }
      if (h.voidedLoad) {
        const dup = await deliver(farms[0], 1_000, 'grade_a', 13.5);
        await recorder.rpc('void_harvest_delivery', {
          p_delivery_id: dup,
          p_reason: 'Entered twice',
        });
      }
      await manager.rpc('complete_harvest', { p_cycle_id: cycleId });

      const proceeds = roundTo(value, 1_000);
      await trustee.rpc('record_cycle_receipt', {
        p_cycle_id: cycleId,
        p_kind: 'offtake_payment',
        p_source_id: offtakeId,
        p_amount_kobo: kobo(proceeds),
        p_trustee_reference: `RCV-${code}-01`,
        p_received_on: day(h.receiptDay),
        p_notes: `${(acceptedKg / 1000).toFixed(1)} t accepted at ${naira(h.pricePerTonne)}/t, less grade B discount`,
      });
      if (h.insuranceTopUpTo && policyId) {
        const fee = target * (spec.feePct / 100);
        const claim = roundTo(target * h.insuranceTopUpTo + fee - proceeds, 1_000);
        if (claim > 0) {
          await trustee.rpc('record_cycle_receipt', {
            p_cycle_id: cycleId,
            p_kind: 'insurance_payout',
            p_source_id: policyId,
            p_amount_kobo: kobo(claim),
            p_trustee_reference: `CLM-${code}-01`,
            p_received_on: day(h.insuranceDay ?? h.receiptDay),
            p_notes: `Area-yield claim: ${h.yieldPerHa} t/ha measured against a ${spec.yields[0]} t/ha trigger`,
          });
        }
      }

      if (spec.stage === 'settled') {
        await trustee.rpc('settle_cycle', { p_cycle_id: cycleId });
        const payouts = await trustee.select('settlement_payouts', 'id', { cycle_id: cycleId });
        for (const [i, p] of payouts.entries()) {
          await trustee.rpc('confirm_settlement_payout', {
            p_payout_id: p.id,
            p_trustee_reference: `SET-${code}-${String(i + 1).padStart(2, '0')}`,
          });
        }
      }
    }

    await restoreDates();
  }

  log('Done');
  return {
    accounts: STAFF.map((s) => ({ role: s.role, email: s.email, fullName: s.fullName })),
    cycles,
    farmers: farmerCount,
  };
}
