import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

/*
 * Identity checks: NIN and BVN looked up with an identity provider by the
 * "identity-check" Edge Function (supabase/functions/identity-check). The database keeps
 * each check's outcome; this module runs checks and reads those outcomes.
 */

export type NumberType = 'nin' | 'bvn';
export type IdentitySubject = 'farmer' | 'investor';
export type IdentityCheckStatus =
  'pending' | 'match' | 'partial' | 'no_match' | 'not_found' | 'error';

export interface FieldResults {
  first_name: boolean;
  last_name: boolean;
  date_of_birth: boolean | null;
  phone: boolean | null;
}

/** A row of public.identity_checks. */
export interface IdentityCheck {
  id: string;
  subject: IdentitySubject;
  farmer_id: string | null;
  investor_id: string | null;
  number_type: NumberType;
  provider: string;
  status: IdentityCheckStatus;
  fields: FieldResults | null;
  provider_reference: string | null;
  error_message: string | null;
  requested_by: string;
  requested_at: string;
  completed_at: string | null;
}

export const NUMBER_LABEL: Record<NumberType, string> = { nin: 'NIN', bvn: 'BVN' };

export const CHECK_STATUS: Record<
  IdentityCheckStatus,
  { label: string; tone: 'green' | 'amber' | 'red' | 'neutral'; help: string }
> = {
  match: { label: 'Match', tone: 'green', help: 'The provider’s record matches.' },
  partial: {
    label: 'Partial match',
    tone: 'amber',
    help: 'The name matches but something else differs. Check before verifying.',
  },
  no_match: {
    label: 'No match',
    tone: 'red',
    help: 'The provider has this number under someone else’s name.',
  },
  not_found: {
    label: 'Not found',
    tone: 'red',
    help: 'The provider has no record of this number.',
  },
  error: {
    label: 'Check failed',
    tone: 'neutral',
    help: 'The provider couldn’t answer. Try again.',
  },
  pending: { label: 'Checking…', tone: 'neutral', help: 'Waiting for the provider.' },
};

export const FIELD_LABEL: Record<keyof FieldResults, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  date_of_birth: 'Date of birth',
  phone: 'Phone',
};

/** The simulated provider, used until a real one is configured. */
export const isSimulated = (provider: string) => provider === 'mock';

/** Checks of a farmer or investor, newest first. */
export async function loadIdentityChecks(
  subject: IdentitySubject,
  subjectId: string,
): Promise<IdentityCheck[]> {
  const { data, error } = await supabase
    .from('identity_checks')
    .select('*')
    .eq(subject === 'farmer' ? 'farmer_id' : 'investor_id', subjectId)
    .order('requested_at', { ascending: false });
  if (error) throw error;
  return data as IdentityCheck[];
}

/**
 * The check that counts for each number: the newest answered one. For investors, pass
 * `since` (when they last submitted), as checks of earlier numbers no longer count.
 */
export function latestAnswered(
  checks: IdentityCheck[],
  since?: string | null,
): Partial<Record<NumberType, IdentityCheck>> {
  const out: Partial<Record<NumberType, IdentityCheck>> = {};
  const from = since ? new Date(since).getTime() : -Infinity;
  for (const c of [...checks].sort((a, b) => b.requested_at.localeCompare(a.requested_at))) {
    if (c.status === 'pending' || new Date(c.requested_at).getTime() < from) continue;
    out[c.number_type] ??= c;
  }
  return out;
}

/**
 * Whether every number on record has a matching check, so compliance can verify without
 * a note. Mirrors private.identity_confirmed in the database, which has the final say.
 */
export function identityConfirmed(
  onRecord: NumberType[],
  checks: IdentityCheck[],
  since?: string | null,
): boolean {
  const latest = latestAnswered(checks, since);
  return onRecord.length > 0 && onRecord.every((t) => latest[t]?.status === 'match');
}

export type CheckOutcome =
  | {
      number_type: NumberType;
      check_id: string;
      provider: string;
      status: Exclude<IdentityCheckStatus, 'pending'>;
      fields: FieldResults | null;
      error_message: string | null;
    }
  | { number_type: NumberType; refused: string };

/**
 * Asks the identity-check function to check numbers. Throws if the function can't be
 * reached (not deployed, offline); a refusal or provider failure comes back per number.
 */
export async function runIdentityChecks(
  subject: IdentitySubject,
  subjectId: string,
  checks: { number_type: NumberType; number: string }[],
): Promise<CheckOutcome[]> {
  const { data, error } = await supabase.functions.invoke<{ results: CheckOutcome[] }>(
    'identity-check',
    { body: { subject, subject_id: subjectId, checks } },
  );
  if (error) {
    let message = 'The identity check service could not be reached.';
    if (error instanceof FunctionsHttpError) {
      const body = (await error.context.json().catch(() => null)) as { error?: string } | null;
      if (body?.error) message = body.error;
    }
    throw new Error(message);
  }
  return data!.results;
}

/** One line on how a set of checks went, for a toast or notice. */
export function describeOutcomes(outcomes: CheckOutcome[]): {
  ok: boolean;
  message: string;
} {
  const parts = outcomes.map((o) =>
    'refused' in o
      ? `${NUMBER_LABEL[o.number_type]}: ${o.refused}`
      : `${NUMBER_LABEL[o.number_type]}: ${CHECK_STATUS[o.status].label.toLowerCase()}`,
  );
  const ok =
    outcomes.length > 0 && outcomes.every((o) => !('refused' in o) && o.status === 'match');
  return {
    ok,
    message: ok
      ? `Identity confirmed (${parts.join(', ')})`
      : `Identity check: ${parts.join('; ')}`,
  };
}
