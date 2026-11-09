/**
 * Identity checks: the provider-neutral part.
 *
 * This folder is plain TypeScript with no Deno- or Node-only APIs (just fetch), so the
 * same code runs in the identity-check Edge Function (Deno), the demo seed and the tests
 * (Node). Imports use explicit .ts extensions, which both runtimes accept.
 */

export type NumberType = 'nin' | 'bvn';
export type Subject = 'farmer' | 'investor';
export type CheckStatus = 'match' | 'partial' | 'no_match' | 'not_found' | 'error';

/** What we hold about the person: compared with the provider's record. */
export interface Claimed {
  /** Farmers have separate names; investors give only a legal name, in `full_name`. */
  first_name?: string | null;
  last_name?: string | null;
  full_name: string;
  /** ISO date, YYYY-MM-DD. */
  date_of_birth?: string | null;
  phone?: string | null;
}

/** The provider's record for a number, reduced to the fields we compare. */
export interface ProviderRecord {
  first_name: string;
  last_name: string;
  middle_name?: string | null;
  /** As the provider sends it; parsed by compare.ts. */
  date_of_birth?: string | null;
  phones: string[];
}

export type Lookup =
  | { found: true; record: ProviderRecord; reference?: string }
  | { found: false; reference?: string };

/**
 * One identity provider. Adding a provider means implementing this and registering it
 * in providers.ts; nothing else changes.
 */
export interface IdentityProvider {
  /** Recorded on each check, e.g. 'dojah'. Lower case. */
  readonly name: string;
  /**
   * Looks a number up. Resolves `found: false` when the provider has no such number,
   * and throws ProviderError when it can't answer (down, out of credit, bad key).
   * `claimed` is passed for providers whose API matches details instead of returning
   * them; the simulated provider uses it to build its answer.
   */
  lookup(type: NumberType, number: string, claimed: Claimed): Promise<Lookup>;
}

/** The provider couldn't answer. The message is safe to show and store. */
export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Per field: true matches, false differs, null wasn't compared. */
export interface FieldResults {
  first_name: boolean;
  last_name: boolean;
  date_of_birth: boolean | null;
  phone: boolean | null;
}
