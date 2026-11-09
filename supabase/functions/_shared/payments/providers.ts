import { mockGateway } from './mock.ts';
import { paystackGateway } from './paystack.ts';
import type { PaymentGateway } from './types.ts';

/**
 * Picks the gateway from the functions' secrets. Unlike identity checks there is no
 * default: online payments are off until PAYMENTS_PROVIDER is set.
 *
 *   PAYMENTS_PROVIDER=paystack  needs PAYSTACK_SECRET_KEY (sk_test_… or sk_live_…)
 *   PAYMENTS_PROVIDER=mock      the simulated gateway (the database must allow it too)
 *
 * Returns null when online payments are off.
 */
export function gatewayFromEnv(env: (name: string) => string | undefined): PaymentGateway | null {
  const name = env('PAYMENTS_PROVIDER')?.trim().toLowerCase();
  switch (name) {
    case undefined:
    case '':
    case 'off':
      return null;
    case 'paystack': {
      const secretKey = env('PAYSTACK_SECRET_KEY')?.trim();
      if (!secretKey)
        throw new Error('PAYMENTS_PROVIDER is paystack, but PAYSTACK_SECRET_KEY is missing');
      return paystackGateway({ secretKey });
    }
    case 'mock':
      return mockGateway((returnUrl) => new URL(returnUrl).origin);
    default:
      throw new Error(`Unknown PAYMENTS_PROVIDER "${name}" (expected paystack, mock or off)`);
  }
}
