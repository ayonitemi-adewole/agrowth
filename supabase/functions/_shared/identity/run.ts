import { compare } from './compare.ts';
import {
  ProviderError,
  type CheckStatus,
  type Claimed,
  type FieldResults,
  type IdentityProvider,
  type NumberType,
  type Subject,
} from './types.ts';

export interface CheckRequest {
  subject: Subject;
  subject_id: string;
  number_type: NumberType;
  number: string;
}

export interface CheckResult {
  check_id: string;
  number_type: NumberType;
  provider: string;
  status: CheckStatus;
  fields: FieldResults | null;
  error_message: string | null;
}

/** How a check reaches the database; the Edge Function, seed and tests each supply one. */
export interface CheckStore {
  /**
   * public.start_identity_check, run as the person asking, so the database decides
   * whether they may check this person and whether the number is the one on record.
   */
  start(req: CheckRequest, provider: string): Promise<{ check_id: string; claimed: Claimed }>;
  /** public.complete_identity_check, run as the service role. */
  complete(args: {
    p_check_id: string;
    p_status: CheckStatus;
    p_fields: FieldResults | null;
    p_provider_reference: string | null;
    p_error_message: string | null;
  }): Promise<void>;
}

/**
 * Runs one check: open it, ask the provider, compare, record. If the database refuses
 * to open it, that error is thrown and nothing is asked. A provider failure is recorded
 * as an "error" check, not thrown, so the caller can show it and retry.
 */
export async function runIdentityCheck(
  provider: IdentityProvider,
  store: CheckStore,
  req: CheckRequest,
): Promise<CheckResult> {
  const number = req.number.replace(/[\s-]/g, '');
  const { check_id, claimed } = await store.start({ ...req, number }, provider.name);

  let status: CheckStatus;
  let fields: FieldResults | null = null;
  let reference: string | null = null;
  let errorMessage: string | null = null;
  try {
    const lookup = await provider.lookup(req.number_type, number, claimed);
    reference = lookup.reference ?? null;
    if (lookup.found) ({ status, fields } = compare(claimed, lookup.record));
    else status = 'not_found';
  } catch (err) {
    status = 'error';
    // Anything other than a ProviderError may carry request details; keep it generic.
    errorMessage =
      err instanceof ProviderError ? err.message : 'The identity provider failed. Try again.';
  }

  await store.complete({
    p_check_id: check_id,
    p_status: status,
    p_fields: fields,
    p_provider_reference: reference,
    p_error_message: errorMessage,
  });
  return {
    check_id,
    number_type: req.number_type,
    provider: provider.name,
    status,
    fields,
    error_message: errorMessage,
  };
}
