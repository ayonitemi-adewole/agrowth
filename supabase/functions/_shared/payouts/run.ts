import { GatewayError } from '../payments/types.ts';
import { bankCode, sameAccountHolder } from './banks.ts';
import type { PayoutGateway, TransferResult } from './types.ts';

export type TransferStatus = 'pending' | 'sent' | 'paid' | 'failed' | 'needs_review';

/** A payment the trustee wants sent: from public.trustee_payments(). */
export interface Payable {
  kind: string;
  item_id: string;
  reference: string;
  bank_name: string | null;
}

/** A row of public.gateway_transfers, as start_gateway_payouts returns it. */
export interface OpenTransfer {
  id: string;
  kind: string;
  item_id: string;
  amount_kobo: string | number;
  account_number: string;
  bank_code: string;
  account_name: string;
}

/** How the payout flow reaches the database; the function and the tests each supply one. */
export interface PayoutStore {
  /** public.start_gateway_payouts, as the trustee. */
  start(
    items: { kind: string; item_id: string; bank_code: string | null }[],
    provider: string,
  ): Promise<OpenTransfer[]>;
  /** public.record_gateway_transfer, as the service role. */
  record(
    id: string,
    status: 'sent' | 'needs_review',
    providerReference: string | null,
    resolvedName: string | null,
    message: string | null,
  ): Promise<void>;
  /** public.complete_gateway_transfer, as the service role. */
  complete(
    id: string,
    succeeded: boolean,
    providerReference: string | null,
    message: string | null,
    reversed?: boolean,
  ): Promise<TransferStatus>;
}

/**
 * Sends payments through the gateway: opens a transfer for each, checks the account is the
 * payee's, sends it, and records what happened. One payment's trouble doesn't stop the
 * others. Returns each transfer's status.
 */
export async function sendPayouts(
  gateway: PayoutGateway,
  store: PayoutStore,
  payments: Payable[],
  reasons: Record<string, string>,
): Promise<{ id: string; item_id: string; status: TransferStatus; message: string | null }[]> {
  const transfers = await store.start(
    payments.map((p) => ({ kind: p.kind, item_id: p.item_id, bank_code: bankCode(p.bank_name) })),
    gateway.name,
  );
  const results = [];
  for (const t of transfers) {
    let resolved: string | null;
    try {
      resolved = await gateway.resolveAccount(t.account_number, t.bank_code, t.account_name);
    } catch (err) {
      // Nothing has been sent, so the payment can simply go back with those waiting.
      const message =
        err instanceof GatewayError ? err.message : 'The gateway could not check the account';
      results.push({
        id: t.id,
        item_id: t.item_id,
        status: await store.complete(t.id, false, null, message),
        message,
      });
      continue;
    }
    if (!resolved || !sameAccountHolder(t.account_name, resolved)) {
      const message = resolved
        ? `The bank holds this account for "${resolved}", not ${t.account_name}. Nothing was sent.`
        : 'The bank has no such account. Nothing was sent.';
      await store.record(t.id, 'needs_review', null, resolved, message);
      results.push({ id: t.id, item_id: t.item_id, status: 'needs_review' as const, message });
      continue;
    }

    let sent: TransferResult;
    try {
      sent = await gateway.sendTransfer({
        reference: t.id,
        amountKobo: BigInt(t.amount_kobo),
        accountNumber: t.account_number,
        bankCode: t.bank_code,
        accountName: t.account_name,
        reason: reasons[t.item_id] ?? 'Agrowth payment',
      });
    } catch (err) {
      // It may or may not have gone: hold it until the trustee has checked the gateway.
      const message = `${err instanceof GatewayError ? err.message : 'The gateway failed'} Check Paystack before paying this again.`;
      await store.record(t.id, 'needs_review', null, resolved, message);
      results.push({ id: t.id, item_id: t.item_id, status: 'needs_review' as const, message });
      continue;
    }

    let status: TransferStatus;
    if (sent.outcome === 'paid') {
      status = await store.complete(t.id, true, sent.providerReference, sent.message);
    } else if (sent.outcome === 'failed') {
      status = await store.complete(t.id, false, sent.providerReference, sent.message);
    } else {
      status = sent.outcome === 'sent' ? 'sent' : 'needs_review';
      await store.record(t.id, status, sent.providerReference, resolved, sent.message);
    }
    results.push({ id: t.id, item_id: t.item_id, status, message: sent.message });
  }
  return results;
}

/** Records what a gateway's webhook says about a transfer. */
export function recordTransferResult(
  store: PayoutStore,
  r: TransferResult,
): Promise<TransferStatus> {
  if (r.outcome === 'sent' || r.outcome === 'needs_otp') {
    return Promise.resolve('sent');
  }
  return store.complete(
    r.reference,
    r.outcome === 'paid',
    r.providerReference,
    r.message,
    r.outcome === 'reversed',
  );
}
