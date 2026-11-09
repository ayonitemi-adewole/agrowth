import type { PaymentGateway, PaymentResult } from './types.ts';

/**
 * The simulated gateway, for demos and development. Its checkout is a page in the app
 * (/pay/simulated) where the investor chooses to pay or decline; nothing is charged. The
 * database refuses its payments unless an admin has turned simulated payments on
 * (investor_settings.allow_simulated_payments), so it can't be used to fake a payment in
 * production even if the function is misconfigured.
 */
export function mockGateway(appOrigin: (returnUrl: string) => string): PaymentGateway {
  return {
    name: 'mock',
    feeFor: () => 0n,
    async startCheckout(req) {
      const page = new URL('/pay/simulated', appOrigin(req.returnUrl));
      page.searchParams.set('reference', req.reference);
      page.searchParams.set('amount', req.chargeKobo.toString());
      page.searchParams.set('return', req.returnUrl);
      return { checkoutUrl: page.toString() };
    },
    // The simulated checkout reports its outcome directly (see simulatedResult); asking
    // afterwards finds nothing new.
    async verify(reference): Promise<PaymentResult> {
      return {
        reference,
        succeeded: false,
        pending: true,
        paidKobo: null,
        providerReference: null,
        channel: null,
        paidAt: null,
        message: 'Waiting for the simulated checkout',
      };
    },
    async parseWebhook() {
      return null;
    },
  };
}

/** What the simulated checkout reports when the investor pays or declines. */
export function simulatedResult(
  reference: string,
  chargeKobo: bigint,
  pay: boolean,
  now = new Date(),
): PaymentResult {
  return {
    reference,
    succeeded: pay,
    pending: false,
    paidKobo: pay ? chargeKobo : null,
    providerReference: `SIM${now.getTime().toString(36).toUpperCase()}`,
    channel: pay ? 'simulated' : null,
    paidAt: pay ? now.toISOString() : null,
    message: pay ? 'Approved (simulated)' : 'Declined (simulated)',
  };
}
