import type { Polygon } from 'geojson';

export type Role =
  | 'admin'
  | 'cycle_manager'
  | 'field_agent'
  | 'compliance_officer'
  | 'auditor'
  | 'investor'
  | 'programme_manager'
  | 'vendor'
  | 'offtaker'
  | 'trustee';

export type KycStatus = 'pending' | 'verified' | 'rejected';
export type Gender = 'female' | 'male' | 'other';
export type TenureType = 'owned' | 'leased' | 'communal' | 'family' | 'other';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface Cooperative {
  id: string;
  name: string;
  registration_number: string | null;
  state: string;
  lga: string;
  ward: string | null;
  contact_phone: string | null;
  created_at: string;
}

export interface Farmer {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  gender: Gender | null;
  date_of_birth: string | null;
  nin_last4: string | null;
  bvn_last4: string | null;
  kyc_status: KycStatus;
  state: string;
  lga: string;
  ward: string | null;
  photo_url: string | null;
  cooperative_id: string | null;
  registered_by: string;
  created_at: string;
}

/** A row of the farm_maps view: a farm with its boundary as GeoJSON. */
export interface FarmMap {
  id: string;
  farmer_id: string;
  name: string | null;
  area_hectares: number;
  primary_crop: string | null;
  tenure_type: TenureType;
  tenure_document_url: string | null;
  soil_notes: string | null;
  boundary: Polygon;
  centroid_lon: number;
  centroid_lat: number;
  cooperative_id: string | null;
  created_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
}

// ---------- Cycles ----------

export type CycleStatus =
  | 'draft'
  | 'pending_approval'
  | 'open_for_funding'
  | 'funded'
  | 'in_progress'
  | 'harvested'
  | 'settled'
  | 'cancelled'
  | 'refunded';
export type FundingSource = 'investor' | 'programme' | 'blended';
export type MilestoneStatus =
  'pending' | 'awaiting_verification' | 'verified' | 'released' | 'blocked';
export type PriceTerms = 'fixed' | 'floor' | 'formula';
export type InsuranceCover = 'area_yield' | 'weather_index' | 'multi_peril';
export type CropCondition = 'good' | 'fair' | 'poor' | 'failed';
export type PayeeKind = 'input_vendor' | 'service_provider' | 'farmer_cash';

/** Money columns come back from the database as numbers; treat them via lib/money. */
type Money = number | string;

export interface Cycle {
  id: string;
  code: string;
  crop: string;
  season: string;
  status: CycleStatus;
  funding_source: FundingSource;
  target_amount_kobo: Money;
  budget_per_hectare_kobo: Money;
  yield_low_t_per_ha: number;
  yield_expected_t_per_ha: number;
  yield_high_t_per_ha: number;
  price_low_per_tonne_kobo: Money | null;
  price_expected_per_tonne_kobo: Money | null;
  price_high_per_tonne_kobo: Money | null;
  funding_deadline: string | null;
  start_date: string | null;
  expected_harvest_date: string | null;
  cooperative_id: string | null;
  manager_id: string;
  description: string | null;
  review_note: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  /** Settlement terms, in basis points (100 = 1%). */
  management_fee_bps: number;
  funder_profit_share_bps: number;
  harvest_completed_at: string | null;
  settlement_started_at: string | null;
  settled_at: string | null;
  created_at: string;
}

/** A row of the cycle_summaries view. */
export interface CycleSummary {
  id: string;
  code: string;
  crop: string;
  season: string;
  status: CycleStatus;
  funding_source: FundingSource;
  target_amount_kobo: Money;
  funding_deadline: string | null;
  start_date: string | null;
  expected_harvest_date: string | null;
  cooperative_id: string | null;
  farm_count: number;
  hectares: number;
  milestone_total_kobo: Money;
  created_at: string;
}

export interface Milestone {
  id: string;
  cycle_id: string;
  sequence: number;
  name: string;
  description: string | null;
  planned_date: string | null;
  amount_kobo: Money;
  status: MilestoneStatus;
  verification_requested_at: string | null;
  verified_at: string | null;
  released_at: string | null;
}

export interface OfftakeContract {
  id: string;
  cycle_id: string;
  buyer_name: string;
  buyer_contact: string | null;
  commodity: string;
  volume_tonnes: number;
  price_terms: PriceTerms;
  price_per_tonne_kobo: Money | null;
  price_floor_per_tonne_kobo: Money | null;
  price_formula: string | null;
  delivery_window_start: string | null;
  delivery_window_end: string | null;
  document_path: string | null;
  signed_on: string | null;
  status: 'draft' | 'signed' | 'approved' | 'fulfilled' | 'breached';
}

export interface InsurancePolicy {
  id: string;
  cycle_id: string;
  insurer_name: string;
  policy_number: string;
  cover_type: InsuranceCover;
  sum_insured_kobo: Money;
  premium_kobo: Money;
  loss_payee: string;
  cover_start: string;
  cover_end: string;
  document_path: string | null;
}

export interface ReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string | null;
}

export interface CycleEvent {
  id: string;
  cycle_id: string;
  kind: string;
  message: string;
  actor_id: string | null;
  created_at: string;
}

export interface FundingContribution {
  id: string;
  cycle_id: string;
  funder_name: string;
  funder_kind: 'investor' | 'programme';
  amount_kobo: Money;
  trustee_reference: string;
  received_on: string;
  refund_entry_id: string | null;
  created_at: string;
}

export interface FieldVisit {
  id: string;
  farm_id: string;
  milestone_id: string;
  agent_id: string;
  visited_at: string;
  /** Where the agent checked in. */
  lon: number;
  lat: number;
  gps_accuracy_m: number;
  distance_from_boundary_m: number;
  gps_ok: boolean;
  checklist_passed: boolean;
  crop_condition: CropCondition;
  notes: string | null;
  photo_paths: string[];
  passed: boolean;
}

export interface Disbursement {
  id: string;
  cycle_id: string;
  milestone_id: string;
  payee_kind: PayeeKind;
  payee_name: string;
  payee_account: string;
  purpose: string;
  amount_kobo: Money;
  status: 'instructed' | 'executed' | 'cancelled';
  instructed_at: string;
  executed_at: string | null;
  trustee_reference: string | null;
}

export type HarvestGrade = 'grade_a' | 'grade_b' | 'grade_c' | 'rejected';

export interface HarvestDelivery {
  id: string;
  cycle_id: string;
  farm_id: string;
  offtake_contract_id: string;
  delivered_on: string;
  weight_kg: number;
  grade: HarvestGrade;
  moisture_pct: number | null;
  waybill_reference: string;
  notes: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
}

export type ReceiptKind = 'offtake_payment' | 'insurance_payout';

export interface CycleReceipt {
  id: string;
  cycle_id: string;
  kind: ReceiptKind;
  payer_name: string;
  amount_kobo: Money;
  trustee_reference: string;
  received_on: string;
  notes: string | null;
  created_at: string;
}

export type PayoutKind = 'platform_fee' | 'funder' | 'farmer';

export interface SettlementPayout {
  id: string;
  cycle_id: string;
  kind: PayoutKind;
  contribution_id: string | null;
  farmer_id: string | null;
  payee_name: string;
  amount_kobo: Money;
  capital_kobo: Money;
  status: 'instructed' | 'executed' | 'cancelled';
  paid_at: string | null;
  trustee_reference: string | null;
  created_at: string;
}

/** The waterfall from settlement_preview; amounts are kobo as strings. */
export interface SettlementPreview {
  cash: string;
  capital: string;
  deployed: string;
  fee: string;
  capital_returned: string;
  capital_loss: string;
  profit: string;
  funder_return: string;
  farmer_surplus: string;
  accepted_kg: number;
  management_fee_bps: number;
  funder_profit_share_bps: number;
  funders: {
    contribution_id: string;
    name: string;
    contributed: string;
    capital: string;
    return: string;
    loss: string;
    total: string;
  }[];
  farmers: { farmer_id: string; name: string; kg: number; amount: string }[];
}

export interface LedgerBalance {
  account_id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  cycle_id: string | null;
  balance_kobo: string;
}
