import { ProviderError, type Claimed, type IdentityProvider, type NumberType } from './types.ts';

/**
 * The simulated provider, for development and demos. It has no database of people: it
 * answers as if the number belongs to the person claiming it, except for numbers ending
 * in these digits, which act out the other answers:
 *
 *   …0000  not found
 *   …1111  belongs to someone else (no match)
 *   …2222  right name, different date of birth and phone (partial)
 *   …9999  the provider is unavailable (error)
 *
 * Checks it answers are recorded with provider "mock", and the app labels them simulated.
 */
export const MOCK_ENDINGS = {
  notFound: '0000',
  someoneElse: '1111',
  partial: '2222',
  unavailable: '9999',
} as const;

export const mockProvider: IdentityProvider = {
  name: 'mock',
  async lookup(type: NumberType, number: string, claimed: Claimed) {
    const ending = number.slice(-4);
    const reference = `mock-${type}-${number.slice(-4)}`;
    if (ending === MOCK_ENDINGS.unavailable) {
      throw new ProviderError('The identity provider is unavailable (simulated). Try again.');
    }
    if (ending === MOCK_ENDINGS.notFound) return { found: false, reference };
    if (ending === MOCK_ENDINGS.someoneElse) {
      return {
        found: true,
        reference,
        record: {
          first_name: 'Chidinma',
          last_name: 'Okonkwo-Bello',
          date_of_birth: '1979-02-14',
          phones: ['+2349090000001'],
        },
      };
    }

    const words = claimed.full_name.trim().split(/\s+/);
    const first = claimed.first_name ?? words[0];
    const last = claimed.last_name ?? words[words.length - 1];
    const partial = ending === MOCK_ENDINGS.partial;
    return {
      found: true,
      reference,
      record: {
        first_name: first,
        last_name: last,
        date_of_birth: partial ? '1970-01-01' : (claimed.date_of_birth ?? null),
        phones: partial ? ['+2347000000000'] : claimed.phone ? [claimed.phone] : [],
      },
    };
  },
};
