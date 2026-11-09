import { dojahProvider } from './dojah.ts';
import { mockProvider } from './mock.ts';
import type { IdentityProvider } from './types.ts';

/**
 * Picks the provider from the function's secrets:
 *
 *   IDENTITY_PROVIDER=mock    (the default) simulated answers, see mock.ts
 *   IDENTITY_PROVIDER=dojah   needs DOJAH_APP_ID and DOJAH_SECRET_KEY; DOJAH_BASE_URL
 *                             defaults to live, set https://sandbox.dojah.io to test
 */
export function providerFromEnv(env: (name: string) => string | undefined): IdentityProvider {
  const name = (env('IDENTITY_PROVIDER') ?? 'mock').trim().toLowerCase();
  switch (name) {
    case 'mock':
      return mockProvider;
    case 'dojah': {
      const appId = env('DOJAH_APP_ID')?.trim();
      const secretKey = env('DOJAH_SECRET_KEY')?.trim();
      if (!appId || !secretKey) {
        throw new Error(
          'IDENTITY_PROVIDER is dojah, but DOJAH_APP_ID or DOJAH_SECRET_KEY is missing',
        );
      }
      return dojahProvider({
        appId,
        secretKey,
        baseUrl: env('DOJAH_BASE_URL')?.trim() || undefined,
      });
    }
    default:
      throw new Error(`Unknown IDENTITY_PROVIDER "${name}" (expected mock or dojah)`);
  }
}
