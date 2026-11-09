/**
 * Online payments (collections): investors paying their pledges through a payment gateway.
 * The gateway settles into the trustee's account; the platform never holds the money.
 *
 * Plain TypeScript with no Deno- or Node-only APIs (fetch and Web Crypto only), so the
 * payments Edge Functions, the seed and the tests share it.
 */

export interface CheckoutRequest {
  /** Our reference for this payment attempt, e.g. AGC-0123456789AB. */
  reference: string;
  /** What the investor is charged, in kobo: the pledge plus the gateway's fee. */
  chargeKobo: bigint;
  email: string;
  /** Where the gateway sends the investor back to. */
  returnUrl: string;
  /** Shown on the gateway's records, e.g. the pledge reference and cycle. */
  metadata: Record<string, string>;
}

/** What the gateway says about a payment. */
export interface PaymentResult {
  reference: string;
  succeeded: boolean;
  /** Still in progress (abandoned or pending): nothing to record yet. */
  pending: boolean;
  paidKobo: bigint | null;
  providerReference: string | null;
  channel: string | null;
  paidAt: string | null;
  message: string | null;
}

export interface PaymentGateway {
  /** Recorded on each payment, e.g. 'paystack'. */
  readonly name: string;
  /** The gateway's fee on a payment, which the investor pays on top of the pledge. */
  feeFor(amountKobo: bigint): bigint;
  /** Opens a checkout and returns the page to send the investor to. */
  startCheckout(req: CheckoutRequest): Promise<{ checkoutUrl: string }>;
  /** Asks the gateway how a payment went. */
  verify(reference: string): Promise<PaymentResult>;
  /**
   * Reads a webhook call: null if its signature isn't the gateway's, otherwise the
   * payment it reports (or no payment, for events we don't use).
   */
  parseWebhook(rawBody: string, headers: Headers): Promise<PaymentResult | 'ignored' | null>;
}

/** The gateway couldn't do what was asked. The message is safe to show. */
export class GatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayError';
  }
}
