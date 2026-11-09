import { supabase } from './supabase';
import type { Kobo as Money } from './money';

/* Insurance claims: reported → insurer notified → assessed → paid (or rejected/withdrawn). */

export type ClaimCause =
  'drought' | 'flood' | 'storm' | 'pests' | 'disease' | 'fire' | 'theft' | 'other';
export type ClaimStatus = 'reported' | 'notified' | 'assessed' | 'paid' | 'rejected' | 'withdrawn';

export interface WeatherEvidence {
  lat: number;
  lon: number;
  farms: number;
  from: string;
  to: string;
  days_with_data: number;
  rain_mm: number;
  normal_mm: number | null;
  longest_dry_run_days: number;
  max_tmax_c: number | null;
}

export interface VisitEvidence {
  farm_id: string;
  farm: string;
  farmer: string;
  visit_id: string;
  visited_at: string;
  crop_condition: 'good' | 'fair' | 'poor' | 'failed';
  passed: boolean;
  photos: number;
  notes: string | null;
}

/** A row of public.insurance_claims, with its farms. */
export interface InsuranceClaim {
  id: string;
  reference: string;
  cycle_id: string;
  policy_id: string;
  cause: ClaimCause;
  loss_from: string;
  loss_to: string | null;
  description: string;
  estimated_loss_kobo: Money | null;
  status: ClaimStatus;
  reported_by: string;
  reported_at: string;
  weather_evidence: WeatherEvidence[];
  visit_evidence: VisitEvidence[];
  notified_on: string | null;
  insurer_claim_number: string | null;
  assessed_on: string | null;
  assessor: string | null;
  assessed_loss_kobo: Money | null;
  approved_kobo: Money | null;
  assessment_notes: string | null;
  paid_kobo: Money | null;
  closed_reason: string | null;
  closed_at: string | null;
  document_paths: string[];
  insurance_claim_farms: { farm_id: string; estimated_loss_pct: number }[];
}

export const CLAIM_CAUSE: Record<ClaimCause, string> = {
  drought: 'Drought',
  flood: 'Flood',
  storm: 'Storm or hail',
  pests: 'Pests',
  disease: 'Crop disease',
  fire: 'Fire',
  theft: 'Theft',
  other: 'Other',
};

export const CLAIM_STATUS: Record<
  ClaimStatus,
  { label: string; tone: 'neutral' | 'amber' | 'blue' | 'green' | 'red' }
> = {
  reported: { label: 'Reported', tone: 'amber' },
  notified: { label: 'Insurer notified', tone: 'blue' },
  assessed: { label: 'Assessed', tone: 'blue' },
  paid: { label: 'Paid', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

/** The four steps of a claim that runs its course, for the timeline. */
export const CLAIM_STEPS: ClaimStatus[] = ['reported', 'notified', 'assessed', 'paid'];

/** How far a claim got: the index of its last step reached (closed claims stop where they were). */
export function stepReached(c: Pick<InsuranceClaim, 'status' | 'notified_on' | 'assessed_on'>) {
  if (c.status === 'paid') return 3;
  if (c.status === 'assessed' || c.assessed_on) return 2;
  if (c.status === 'notified' || c.notified_on) return 1;
  return 0;
}

export const isOpen = (s: ClaimStatus) => s === 'reported' || s === 'notified' || s === 'assessed';

export async function loadClaims(cycleId: string): Promise<InsuranceClaim[]> {
  const { data, error } = await supabase
    .from('insurance_claims')
    .select('*, insurance_claim_farms(farm_id, estimated_loss_pct)')
    .eq('cycle_id', cycleId)
    .order('reported_at', { ascending: false });
  if (error) throw error;
  return data as InsuranceClaim[];
}
