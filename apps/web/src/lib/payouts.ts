import { FunctionsHttpError } from '@supabase/supabase-js';
import type { PaymentKind, TrusteePayment } from './bankfiles';
import { supabase } from './supabase';
import { useAsync } from './useAsync';

/*
 * The trustee paying through the payment gateway (transfers from its Paystack balance),
 * through the "payouts" Edge Function (supabase/functions/payouts).
 */

export type TransferStatus = 'pending' | 'sent' | 'paid' | 'failed' | 'needs_review';

/** A row of public.gateway_transfers. */
export interface GatewayTransfer {
  id: string;
  kind: PaymentKind;
  item_id: string;
  cycle_id: string;
  provider: string;
  amount_kobo: string;
  payee_name: string;
  bank_name: string | null;
  account_number: string;
  account_name: string;
  resolved_account_name: string | null;
  status: TransferStatus;
  provider_reference: string | null;
  message: string | null;
  requested_at: string;
  completed_at: string | null;
}

export const TRANSFER_STATUS: Record<
  TransferStatus,
  { label: string; tone: 'neutral' | 'blue' | 'green' | 'red' | 'amber' }
> = {
  pending: { label: 'Sending', tone: 'blue' },
  sent: { label: 'Sent, awaiting the bank', tone: 'blue' },
  paid: { label: 'Paid', tone: 'green' },
  failed: { label: 'Failed', tone: 'neutral' },
  needs_review: { label: 'Held', tone: 'red' },
};

export const isLive = (s: TransferStatus) =>
  s === 'pending' || s === 'sent' || s === 'needs_review';

export const GATEWAY_NAME: Record<string, string> = {
  paystack: 'Paystack',
  mock: 'the simulated gateway',
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('payouts', { body });
  if (error) {
    let message = 'The payouts service could not be reached.';
    if (error instanceof FunctionsHttpError) {
      const b = (await error.context.json().catch(() => null)) as { error?: string } | null;
      if (b?.error) message = b.error;
    }
    throw new Error(message);
  }
  return data as T;
}

/** The gateway in use and its balance, or a null provider when payouts are off. */
export async function payoutsConfig(): Promise<{
  provider: string | null;
  balance_kobo: string | null;
}> {
  try {
    return await call({ action: 'config' });
  } catch {
    return { provider: null, balance_kobo: null };
  }
}

export const sendPayouts = (items: { kind: PaymentKind; item_id: string }[]) =>
  call<{
    results: { id: string; item_id: string; status: TransferStatus; message: string | null }[];
  }>({
    action: 'send',
    items,
  });

/** One line on how a send went, for a toast. */
export function describeSend(results: { status: TransferStatus }[]): {
  ok: boolean;
  message: string;
} {
  const count = (s: TransferStatus) => results.filter((r) => r.status === s).length;
  const parts = [
    count('paid') && `${count('paid')} paid`,
    count('sent') && `${count('sent')} sent, awaiting the bank`,
    count('needs_review') && `${count('needs_review')} held for you to check`,
    count('failed') && `${count('failed')} failed`,
  ].filter(Boolean);
  return {
    ok: count('needs_review') + count('failed') === 0,
    message: parts.join(', ') || 'Nothing sent',
  };
}

/**
 * For the trustee: whether payouts are on, the payments waiting, and the transfers out.
 * Loads nothing for anyone else.
 */
export function useGatewayPayouts(enabled: boolean, cycleId?: string) {
  return useAsync(async () => {
    if (!enabled) return null;
    let transfers = supabase
      .from('gateway_transfers')
      .select('*')
      .order('requested_at', { ascending: false });
    if (cycleId) transfers = transfers.eq('cycle_id', cycleId);
    const [config, payments, rows] = await Promise.all([
      payoutsConfig(),
      supabase.rpc('trustee_payments'),
      transfers.limit(200),
    ]);
    if (payments.error) throw payments.error;
    if (rows.error) throw rows.error;
    const all = rows.data as GatewayTransfer[];
    const live = new Map(
      all.filter((t) => isLive(t.status)).map((t) => [`${t.kind}:${t.item_id}`, t]),
    );
    const waiting = (payments.data as TrusteePayment[]).filter(
      (p) => !cycleId || p.cycle_id === cycleId,
    );
    const byKey = new Map(waiting.map((p) => [`${p.kind}:${p.item_id}`, p]));
    return {
      provider: config.provider,
      balance: config.balance_kobo,
      // What can go through the gateway now: an account on file, and not already on its
      // way in a bank payment file or a transfer.
      payable: waiting.filter(
        (p) => !p.problem && !p.batch_id && !live.has(`${p.kind}:${p.item_id}`),
      ),
      transfers: all,
      liveFor: (kind: PaymentKind, id: string) => live.get(`${kind}:${id}`) ?? null,
      /** A payment still to make, with its account, file and any problem; null once paid. */
      paymentFor: (kind: PaymentKind, id: string) => byKey.get(`${kind}:${id}`) ?? null,
    };
  }, [enabled, cycleId]);
}
