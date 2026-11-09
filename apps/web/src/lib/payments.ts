import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

/*
 * Paying pledges online, through the "payments" Edge Function
 * (supabase/functions/payments). The gateway settles into the trustee's account.
 */

export type OnlinePaymentStatus =
  'initiated' | 'succeeded' | 'failed' | 'needs_refund' | 'needs_review' | 'resolved';

/** A row of public.online_payments. */
export interface OnlinePayment {
  id: string;
  reference: string;
  pledge_id: string;
  investor_id: string;
  cycle_id: string;
  provider: string;
  amount_kobo: string;
  fee_kobo: string;
  charge_kobo: string;
  status: OnlinePaymentStatus;
  provider_reference: string | null;
  channel: string | null;
  paid_kobo: string | null;
  paid_at: string | null;
  note: string | null;
  created_at: string;
}

export const GATEWAY_LABEL: Record<string, string> = {
  paystack: 'Paystack',
  mock: 'the simulated gateway',
};

/** What to tell the investor once they're back from the gateway. */
export const RETURN_MESSAGE: Record<OnlinePaymentStatus, { ok: boolean; text: string }> = {
  succeeded: { ok: true, text: 'Payment received. Your investment is confirmed.' },
  initiated: {
    ok: false,
    text: 'The payment hasn’t gone through yet. If you completed it, it will show here shortly.',
  },
  failed: { ok: false, text: 'The payment didn’t go through. You can try again.' },
  needs_refund: {
    ok: false,
    text: 'We received your payment, but the pledge could no longer take it. The trustee will refund you.',
  },
  needs_review: {
    ok: false,
    text: 'We received a payment, but not the amount expected. The trustee will be in touch.',
  },
  resolved: { ok: false, text: 'This payment has been dealt with by the trustee.' },
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('payments', { body });
  if (error) {
    let message = 'The payment service could not be reached.';
    if (error instanceof FunctionsHttpError) {
      const b = (await error.context.json().catch(() => null)) as { error?: string } | null;
      if (b?.error) message = b.error;
    }
    throw new Error(message);
  }
  return data as T;
}

/**
 * The gateway in use, or why there isn't one: online payments switched off on the server,
 * or the payments function not reachable (not deployed, say).
 */
export async function paymentGateway(): Promise<{
  provider: string | null;
  problem: string | null;
}> {
  try {
    const { provider } = await call<{ provider: string | null }>({ action: 'config' });
    return {
      provider,
      problem: provider ? null : 'PAYMENTS_PROVIDER is not set for the payments function.',
    };
  } catch (err) {
    return {
      provider: null,
      problem: `The payments function can't be reached (is it deployed?): ${(err as Error).message}`,
    };
  }
}

export const startPledgePayment = (pledgeId: string, returnUrl: string) =>
  call<{ reference: string; checkout_url: string; charge_kobo: string; fee_kobo: string }>({
    action: 'start',
    pledge_id: pledgeId,
    return_url: returnUrl,
  });

export const verifyPayment = async (reference: string) =>
  (await call<{ status: OnlinePaymentStatus }>({ action: 'verify', reference })).status;

export const simulatePayment = async (reference: string, pay: boolean) =>
  (await call<{ status: OnlinePaymentStatus }>({ action: 'simulate', reference, pay })).status;

/** Where the gateway sends the investor back to: My investments, with the payment's reference. */
export const returnUrl = () => `${window.location.origin}/portfolio`;

/** Paystack adds ?reference=…&trxref=…; the simulated gateway adds ?payment=…. */
export function returnedReference(search: string): string | null {
  const q = new URLSearchParams(search);
  const ref = q.get('payment') ?? q.get('reference') ?? q.get('trxref');
  return ref && /^AGC-[0-9A-F]{12}$/.test(ref) ? ref : null;
}
