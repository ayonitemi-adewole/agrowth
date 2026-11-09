import type { PaymentGateway, PaymentResult } from './types.ts';

export type OnlinePaymentStatus =
  'initiated' | 'succeeded' | 'failed' | 'needs_refund' | 'needs_review' | 'resolved';

/** How the payment flow reaches the database; the functions, seed and tests each supply one. */
export interface PaymentStore {
  /** The pledge's amount, read as the investor (who can only see their own pledges). */
  pledgeAmount(pledgeId: string): Promise<bigint>;
  /**
   * public.start_online_payment, as the investor: the database checks the pledge is theirs,
   * pending and past its cooling-off, and opens a payment attempt.
   */
  start(
    pledgeId: string,
    provider: string,
    feeKobo: bigint,
  ): Promise<{
    reference: string;
    charge_kobo: string;
    email: string;
    pledge_reference: string;
    cycle_code: string;
  }>;
  /** public.complete_online_payment, as the service role. Returns the attempt's status. */
  complete(result: PaymentResult, provider: string): Promise<OnlinePaymentStatus>;
}

/** Opens a payment attempt for a pledge and a checkout at the gateway. */
export async function startPledgePayment(
  gateway: PaymentGateway,
  store: PaymentStore,
  pledgeId: string,
  returnUrl: string,
) {
  const fee = gateway.feeFor(await store.pledgeAmount(pledgeId));
  const attempt = await store.start(pledgeId, gateway.name, fee);
  const { checkoutUrl } = await gateway.startCheckout({
    reference: attempt.reference,
    chargeKobo: BigInt(attempt.charge_kobo),
    email: attempt.email,
    returnUrl,
    metadata: { pledge_reference: attempt.pledge_reference, cycle: attempt.cycle_code },
  });
  return {
    reference: attempt.reference,
    checkoutUrl,
    chargeKobo: attempt.charge_kobo,
    feeKobo: fee.toString(),
  };
}

/**
 * Records what the gateway says about a payment. Safe to call more than once (the
 * investor coming back and the webhook can both report the same payment): only the first
 * answer counts. A payment still in progress records nothing.
 */
export async function recordPaymentResult(
  store: PaymentStore,
  provider: string,
  result: PaymentResult,
): Promise<OnlinePaymentStatus> {
  if (result.pending && !result.succeeded) return 'initiated';
  return store.complete(result, provider);
}
