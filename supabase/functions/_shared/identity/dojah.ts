import { ProviderError, type IdentityProvider, type Lookup, type NumberType } from './types.ts';

/**
 * Dojah (dojah.io) NIN and BVN lookups.
 *
 *   GET {base}/api/v1/kyc/nin?nin=…        → { entity: { first_name, last_name, middle_name,
 *                                               date_of_birth, phone_number, … } }
 *   GET {base}/api/v1/kyc/bvn/full?bvn=…   → { entity: { …, phone_number1, phone_number2 } }
 *
 * Headers: AppId, and Authorization set to the secret key (no "Bearer").
 * Sandbox base: https://sandbox.dojah.io (test numbers: NIN 70123456789, BVN 22222222222).
 * Only names, date of birth and phones are read; the photo and the rest are discarded.
 */
export interface DojahConfig {
  appId: string;
  secretKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type Entity = Record<string, unknown>;
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function dojahProvider(config: DojahConfig): IdentityProvider {
  const base = (config.baseUrl ?? 'https://api.dojah.io').replace(/\/+$/, '');
  const doFetch = config.fetch ?? fetch;

  return {
    name: 'dojah',
    async lookup(type: NumberType, number: string): Promise<Lookup> {
      const url =
        type === 'nin'
          ? `${base}/api/v1/kyc/nin?nin=${encodeURIComponent(number)}`
          : `${base}/api/v1/kyc/bvn/full?bvn=${encodeURIComponent(number)}`;
      let res: Response;
      try {
        res = await doFetch(url, {
          headers: { AppId: config.appId, Authorization: config.secretKey },
          signal: AbortSignal.timeout(config.timeoutMs ?? 20_000),
        });
      } catch {
        throw new ProviderError('Could not reach Dojah. Try again.');
      }

      const body = (await res.json().catch(() => null)) as { entity?: Entity } | null;
      // Dojah answers 404 (and some 400s) when it has no record of the number.
      if (res.status === 404 || (res.ok && !body?.entity)) return { found: false };
      if (res.status === 400) {
        const message = JSON.stringify(body ?? {}).toLowerCase();
        if (/not\s*found|no\s*record|invalid\s*(nin|bvn)/.test(message)) return { found: false };
      }
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError('Dojah refused the request: check the AppId and secret key.');
      }
      if (res.status === 402) throw new ProviderError('The Dojah account is out of credit.');
      if (!res.ok || !body?.entity) {
        throw new ProviderError(`Dojah could not answer (HTTP ${res.status}). Try again.`);
      }

      const e = body.entity;
      const firstName = text(e.first_name);
      const lastName = text(e.last_name);
      if (!firstName || !lastName) return { found: false };
      return {
        found: true,
        record: {
          first_name: firstName,
          last_name: lastName,
          middle_name: text(e.middle_name),
          date_of_birth: text(e.date_of_birth),
          phones: [e.phone_number, e.phone_number1, e.phone_number2]
            .map(text)
            .filter((p): p is string => p !== null),
        },
      };
    },
  };
}
