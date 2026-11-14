import { supabase } from '../../lib/supabase';
import type {
  Cycle,
  CycleEvent,
  CycleReceipt,
  Disbursement,
  FarmMap,
  FieldVisit,
  FundingContribution,
  HarvestDelivery,
  InsurancePolicy,
  InvestmentPledge,
  KycStatus,
  Milestone,
  OfftakeContract,
  ReadinessCheck,
  SettlementPayout,
  SettlementPreview,
  Vendor,
  Voucher,
  VoucherRedemption,
} from '../../lib/types';
import { useAsync } from '../../lib/useAsync';

export type CycleFarm = FarmMap & { farmer_name: string; kyc_status: KycStatus };

export type RedemptionRow = VoucherRedemption & {
  vendors: Pick<Vendor, 'name' | 'bank_name' | 'account_number' | 'account_name' | 'status'>;
};

/** Investor names are only readable by compliance, the trustee, admins and auditors. */
export type PledgeRow = InvestmentPledge & { investor_profiles: { legal_name: string } | null };

export interface CycleData {
  cycle: Cycle;
  farms: CycleFarm[];
  milestones: Milestone[];
  offtake: OfftakeContract[];
  insurance: InsurancePolicy[];
  contributions: FundingContribution[];
  pledges: PledgeRow[];
  raisedKobo: number;
  events: CycleEvent[];
  disbursements: Disbursement[];
  visits: FieldVisit[];
  readiness: ReadinessCheck[] | null;
  deliveries: HarvestDelivery[];
  receipts: CycleReceipt[];
  payouts: SettlementPayout[];
  vouchers: Voucher[];
  redemptions: RedemptionRow[];
  /** The waterfall as it would run now; null once settlement has run or before the season. */
  settlement: SettlementPreview | null;
  hectares: number;
  /** Names of people who appear in the cycle's history, by id. */
  people: Map<string, string>;
}

const must = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

export async function loadCycle(id: string): Promise<CycleData | null> {
  const cycleRes = await supabase.from('cycles').select('*').eq('id', id).maybeSingle();
  const cycle = must(cycleRes) as Cycle | null;
  if (!cycle) return null;

  const underway = ['in_progress', 'harvested', 'settled'].includes(cycle.status);
  const [
    farmLinks,
    milestones,
    offtake,
    insurance,
    contributions,
    funding,
    events,
    disbursements,
    deliveries,
    receipts,
    payouts,
    settlement,
    vouchers,
    redemptions,
    pledges,
  ] = await Promise.all([
    supabase.from('cycle_farms').select('farm_id').eq('cycle_id', id),
    supabase.from('milestones').select('*').eq('cycle_id', id).order('sequence'),
    supabase.from('offtake_contracts').select('*').eq('cycle_id', id).order('created_at'),
    supabase.from('insurance_policies').select('*').eq('cycle_id', id).order('created_at'),
    supabase.from('funding_contributions').select('*').eq('cycle_id', id).order('created_at'),
    supabase.from('cycle_funding').select('raised_kobo').eq('cycle_id', id).maybeSingle(),
    supabase
      .from('cycle_events')
      .select('*')
      .eq('cycle_id', id)
      .order('created_at', { ascending: false }),
    supabase.from('disbursements').select('*').eq('cycle_id', id).order('instructed_at'),
    underway
      ? supabase
          .from('harvest_deliveries')
          .select('*')
          .eq('cycle_id', id)
          .order('delivered_on', { ascending: false })
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    underway
      ? supabase.from('cycle_receipts').select('*').eq('cycle_id', id).order('received_on')
      : Promise.resolve({ data: [], error: null }),
    underway
      ? supabase.from('settlement_payouts').select('*').eq('cycle_id', id).order('created_at')
      : Promise.resolve({ data: [], error: null }),
    ['in_progress', 'harvested'].includes(cycle.status) && !cycle.settlement_started_at
      ? supabase.rpc('settlement_preview', { p_cycle_id: id })
      : Promise.resolve({ data: null, error: null }),
    supabase.from('vouchers').select('*').eq('cycle_id', id).order('issued_at').order('code'),
    supabase
      .from('voucher_redemptions')
      .select('*, vendors(name, bank_name, account_number, account_name, status)')
      .eq('cycle_id', id)
      .order('redeemed_at', { ascending: false }),
    supabase
      .from('investment_pledges')
      .select('*, investor_profiles(legal_name)')
      .eq('cycle_id', id)
      .order('pledged_at', { ascending: false }),
  ]);

  const farmIds = must(farmLinks).map((f: { farm_id: string }) => f.farm_id);
  const milestoneRows = must(milestones) as Milestone[];

  const [farms, visits, readiness] = await Promise.all([
    farmIds.length
      ? supabase.from('farm_maps').select('*, farmers(full_name, kyc_status)').in('id', farmIds)
      : Promise.resolve({ data: [], error: null }),
    milestoneRows.length
      ? supabase
          .from('field_visit_evidence')
          .select(
            'id, farm_id, milestone_id, agent_id, visited_at, created_at, lon, lat, gps_accuracy_m, distance_from_boundary_m, gps_ok, checklist_passed, crop_condition, notes, photo_paths, portrait_path, passed',
          )
          .in(
            'milestone_id',
            milestoneRows.map((m) => m.id),
          )
          .order('visited_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    ['draft', 'pending_approval'].includes(cycle.status)
      ? supabase.rpc('cycle_readiness', { p_cycle_id: id })
      : Promise.resolve({ data: null, error: null }),
  ]);

  const farmRows = (
    must(farms) as (FarmMap & { farmers: { full_name: string; kyc_status: KycStatus } })[]
  ).map((f) => ({ ...f, farmer_name: f.farmers.full_name, kyc_status: f.farmers.kyc_status }));
  const eventRows = must(events) as CycleEvent[];

  // Names for the history. Profiles are only readable by admins (and yourself); others see "Staff".
  const actorIds = [...new Set(eventRows.map((e) => e.actor_id).filter(Boolean))] as string[];
  const people = new Map<string, string>();
  if (actorIds.length) {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', actorIds);
    for (const p of data ?? []) people.set(p.id, p.full_name || p.email);
  }

  return {
    cycle,
    farms: farmRows,
    milestones: milestoneRows,
    offtake: must(offtake) as OfftakeContract[],
    insurance: must(insurance) as InsurancePolicy[],
    contributions: must(contributions) as FundingContribution[],
    pledges: must(pledges) as PledgeRow[],
    raisedKobo: (must(funding) as { raised_kobo: number } | null)?.raised_kobo ?? 0,
    events: eventRows,
    disbursements: must(disbursements) as Disbursement[],
    visits: must(visits) as FieldVisit[],
    readiness: must(readiness) as ReadinessCheck[] | null,
    deliveries: must(deliveries) as HarvestDelivery[],
    receipts: must(receipts) as CycleReceipt[],
    payouts: must(payouts) as SettlementPayout[],
    settlement: must(settlement) as SettlementPreview | null,
    vouchers: must(vouchers) as Voucher[],
    redemptions: must(redemptions) as RedemptionRow[],
    hectares: farmRows.reduce((s, f) => s + Number(f.area_hectares), 0),
    people,
  };
}

export interface TabProps {
  data: CycleData;
  reload: () => void;
}

export const useCycleData = (id: string) => useAsync(() => loadCycle(id), [id]);
