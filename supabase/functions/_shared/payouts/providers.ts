import { mockPayouts } from './mock.ts';
import { paystackPayouts } from './paystack.ts';
import type { PayoutGateway } from './types.ts';

/**
 * Payouts use the same gateway as online payments (PAYMENTS_PROVIDER), but stay off until
 * PAYOUTS_ENABLED=true: they need the trustee's own Paystack account, with transfers
 * switched on and money in its balance. Returns null when they're off.
 */
export function payoutsFromEnv(env: (name: string) => string | undefined): PayoutGateway | null {
  if (env('PAYOUTS_ENABLED')?.trim().toLowerCase() !== 'true') return null;
  const name = env('PAYMENTS_PROVIDER')?.trim().toLowerCase();
  if (name === 'mock') return mockPayouts;
  if (name === 'paystack') {
    const secretKey = env('PAYSTACK_SECRET_KEY')?.trim();
    if (!secretKey) throw new Error('PAYOUTS_ENABLED is true, but PAYSTACK_SECRET_KEY is missing');
    return paystackPayouts({ secretKey });
  }
  throw new Error('PAYOUTS_ENABLED is true, but PAYMENTS_PROVIDER is not paystack or mock');
}
