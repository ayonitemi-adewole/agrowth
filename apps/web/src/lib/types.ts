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
  /** Compliance's note on the KYC decision, e.g. why it verified without a matching check. */
  kyc_note: string | null;
  kyc_reviewed_at: string | null;
  /** Where the farmer's harvest surplus is paid; null when none is on file. */
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  bank_updated_at: string | null;
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
export type PayeeKind = 'input_vendor' | 'service_provider' | 'farmer_cash' | 'input_voucher';

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
  programme_id: string | null;
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
  /** Set for funders who came through the portal; they're paid to their profile's account. */
  investor_id: string | null;
  /** Where a funder outside the portal is paid back. */
  payout_bank_name: string | null;
  payout_account_number: string | null;
  payout_account_name: string | null;
  created_at: string;
}

export interface FieldVisit {
  id: string;
  farm_id: string;
  milestone_id: string;
  agent_id: string;
  visited_at: string;
  /** When it reached the server; later than visited_at if it was recorded offline. */
  created_at?: string;
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
  /** The buyer's answer on the offtaker portal. */
  buyer_confirmed_at: string | null;
  buyer_disputed_at: string | null;
  buyer_dispute: string | null;
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

export type VendorKind = 'agro_dealer' | 'service_provider';
export type VendorStatus = 'pending' | 'approved' | 'suspended';

export interface Vendor {
  id: string;
  name: string;
  kind: VendorKind;
  registration_number: string | null;
  contact_phone: string;
  contact_email: string | null;
  state: string;
  lga: string;
  address: string | null;
  bank_name: string;
  account_number: string;
  account_name: string;
  status: VendorStatus;
  status_note: string | null;
  reviewed_at: string | null;
  user_id: string | null;
  registered_by: string;
  created_at: string;
}

export type VoucherStatus = 'active' | 'redeemed' | 'closed';

export interface Voucher {
  id: string;
  code: string;
  cycle_id: string;
  milestone_id: string;
  disbursement_id: string;
  farm_id: string;
  farmer_id: string;
  purpose: string;
  value_kobo: Money;
  redeemed_kobo: Money;
  status: VoucherStatus;
  expires_on: string;
  issued_at: string;
  closed_at: string | null;
  close_reason: string | null;
}

export interface VoucherRedemption {
  id: string;
  voucher_id: string;
  vendor_id: string;
  cycle_id: string;
  amount_kobo: Money;
  items: string;
  redeemed_at: string;
  paid_at: string | null;
  trustee_reference: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

/** What check_voucher and redeem_voucher return at the counter. */
export interface VoucherCheck {
  ok: boolean;
  message?: string;
  voucher_id?: string;
  code?: string;
  farmer?: string;
  cooperative?: string | null;
  cycle_code?: string;
  crop?: string;
  purpose?: string;
  value_kobo?: string;
  remaining_kobo?: string;
  expires_on?: string;
  unusable_reason?: string | null;
  redemption_id?: string;
}

// ---------- Investor Edition ----------

export type InvestorClass = 'retail' | 'high_net_worth' | 'institutional';
export type PledgeStatus = 'pending' | 'paid' | 'withdrawn' | 'lapsed';

export interface InvestorProfile {
  user_id: string;
  legal_name: string;
  declared_class: InvestorClass;
  classification: InvestorClass | null;
  kyc_status: KycStatus;
  annual_income_kobo: Money;
  other_crowdfunding_kobo: Money;
  id_document_path: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  submitted_at: string;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface InvestorSettings {
  retail_cap_bps: number;
  cooling_off_hours: number;
  payment_window_days: number;
  min_pledge_kobo: Money;
  escrow_bank_name: string;
  escrow_account_name: string;
  escrow_account_number: string;
  risk_disclosure: string;
  disclosure_version: number;
  updated_at: string;
}

/** Where an investor stands against their 12-month limit (amounts in kobo). */
export interface InvestmentCap {
  kyc_status: KycStatus | null;
  classification: InvestorClass | null;
  capped: boolean;
  cap_kobo: string | null;
  used_here_kobo: string;
  used_elsewhere_kobo: string;
  remaining_kobo: string | null;
}

/** A cycle as investors see it in the marketplace. Amounts in kobo, as strings. */
export interface Listing {
  id: string;
  code: string;
  crop: string;
  season: string;
  status: CycleStatus;
  funding_source: FundingSource;
  description: string | null;
  target_kobo: string;
  raised_kobo: string;
  reserved_kobo: string;
  funders: number;
  funding_deadline: string | null;
  start_date: string | null;
  expected_harvest_date: string | null;
  farm_count: number;
  hectares: number;
  yield_low: number;
  yield_expected: number;
  yield_high: number;
  price_low_kobo: string | null;
  price_expected_kobo: string | null;
  price_high_kobo: string | null;
  management_fee_bps: number;
  funder_profit_share_bps: number;
  cooperative: { name: string; state: string; lga: string } | null;
  sum_insured_kobo: string;
  insurers: string[];
  offtakers: string[];
  offtake_volume_t: number;
  offtake_price_terms: PriceTerms[];
  offtake_floor_kobo: string | null;
}

export interface MyPledge {
  id: string;
  reference: string;
  cycle_id: string;
  amount_kobo: string;
  status: PledgeStatus;
  pledged_at: string;
  cooling_off_ends_at: string;
  pay_by: string;
  disclosure_version: number;
  disclosure_acknowledged_at: string;
  received_on: string | null;
  trustee_reference: string | null;
  refunded: boolean;
  refunded_at: string | null;
  payouts: {
    amount_kobo: string;
    capital_kobo: string;
    status: 'instructed' | 'executed' | 'cancelled';
    paid_at: string | null;
    created_at: string;
  }[];
}

/** One cycle in full, as an investor sees it (investor_listing). */
export interface ListingDetail extends Listing {
  farms: Pick<
    FarmMap,
    'id' | 'name' | 'area_hectares' | 'primary_crop' | 'boundary' | 'centroid_lon' | 'centroid_lat'
  >[];
  milestones: {
    id: string;
    sequence: number;
    name: string;
    description: string | null;
    planned_date: string | null;
    amount_kobo: string;
    status: MilestoneStatus;
    verified_at: string | null;
    released_at: string | null;
    released: Partial<Record<PayeeKind, string>>;
  }[];
  offtake: {
    buyer_name: string;
    commodity: string;
    volume_tonnes: number;
    price_terms: PriceTerms;
    price_kobo: string | null;
    floor_kobo: string | null;
    formula: string | null;
    delivery_window_start: string | null;
    delivery_window_end: string | null;
    signed_on: string | null;
    status: OfftakeContract['status'];
  }[];
  insurance: {
    insurer_name: string;
    cover_type: InsuranceCover;
    sum_insured_kobo: string;
    loss_payee: string;
    cover_start: string;
    cover_end: string;
  }[];
  visits: {
    milestone_id: string;
    farm_id: string;
    visited_at: string;
    passed: boolean;
    gps_ok: boolean;
    crop_condition: CropCondition;
    photo_paths: string[];
  }[];
  harvest: { accepted_kg: number; rejected_kg: number; deliveries: number };
  events: { kind: string; message: string; created_at: string }[];
  my_pledges: MyPledge[];
}

export interface MyInvestments {
  cap: InvestmentCap;
  escrow: { bank_name: string; account_name: string; account_number: string };
  pledges: (MyPledge & { cycle: Listing })[];
}

/** What pledge_investment returns: the pledge and how to pay it. */
export interface PledgeReceipt {
  id: string;
  reference: string;
  amount_kobo: string;
  pay_by: string;
  cooling_off_ends_at: string;
  escrow_bank_name: string;
  escrow_account_name: string;
  escrow_account_number: string;
}

/** A pledge row as staff see it on a cycle's Funding tab. */
export interface InvestmentPledge {
  id: string;
  reference: string;
  cycle_id: string;
  investor_id: string;
  amount_kobo: Money;
  status: PledgeStatus;
  pledged_at: string;
  cooling_off_ends_at: string;
  pay_by: string;
  contribution_id: string | null;
}

// ---------- Government Edition ----------

export type ProgrammeKind = 'input_loan' | 'grant';
export type ProgrammeStatus = 'draft' | 'active' | 'closed';
export type RepaymentMode = 'produce' | 'cash' | 'either';

export interface Programme {
  id: string;
  code: string;
  name: string;
  sponsor: string;
  description: string | null;
  kind: ProgrammeKind;
  status: ProgrammeStatus;
  budget_kobo: Money;
  commodities: string[];
  target_states: string[];
  target_lgas: string[];
  max_hectares_per_farmer: number | null;
  require_cooperative: boolean;
  input_package: string | null;
  max_budget_per_ha_kobo: Money | null;
  repayment_bps: number;
  repayment_mode: RepaymentMode;
  starts_on: string;
  ends_on: string;
  activated_at: string | null;
  closed_at: string | null;
}

/** Totals for a programme or one slice of it. Amounts in kobo, as strings. */
export interface ProgrammeFigures {
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

export type ProgrammeSummary = ProgrammeFigures &
  Pick<
    Programme,
    'id' | 'code' | 'name' | 'sponsor' | 'kind' | 'status' | 'commodities' | 'target_states'
  > & {
    budget_kobo: string;
    starts_on: string;
    ends_on: string;
    cycles: number;
    committed_kobo: string;
  };

export interface ProgrammeDashboard {
  programme: Programme;
  totals: ProgrammeFigures;
  budget_committed_kobo: string;
  by_state: (ProgrammeFigures & { key: string })[];
  by_lga: (ProgrammeFigures & { key: string })[];
  by_ward: (ProgrammeFigures & { key: string })[];
  by_commodity: (ProgrammeFigures & { key: string })[];
  by_cooperative: (ProgrammeFigures & { key: string })[];
  cycles: {
    id: string;
    code: string;
    crop: string;
    season: string;
    status: CycleStatus;
    funding_source: FundingSource;
    target_kobo: string;
    programme_kobo: string;
  }[];
  under_delivered: {
    farmer_id: string;
    farmer_name: string;
    cooperative: string;
    lga: string;
    ward: string;
    cycle_id: string;
    cycle_code: string;
    hectares: number;
    delivered_kg: number;
    low_kg: number;
  }[];
  agents: {
    agent_id: string;
    name: string;
    visits: number;
    passed: number;
    gps_failed: number;
    farms: number;
    avg_days_to_visit: number | null;
  }[];
  visits_outstanding: number;
}

/** One beneficiary farm, for the audit export. */
export interface ProgrammeBeneficiary {
  cycle_code: string;
  crop: string;
  cycle_status: CycleStatus;
  farmer_id: string;
  farmer_name: string;
  gender: Gender | null;
  state: string;
  lga: string;
  ward: string;
  cooperative: string;
  hectares: number;
  committed_kobo: number;
  inputs_kobo: number;
  cash_kobo: number;
  delivered_kg: number;
  low_kg: number;
  season_over: boolean;
  due_kobo: number;
  recovered_kobo: number;
}
