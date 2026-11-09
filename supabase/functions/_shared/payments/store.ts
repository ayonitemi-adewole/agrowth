import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { PaymentStore } from './run.ts';

/**
 * The payment flow's database access from an Edge Function: reads and starts as the
 * signed-in investor (so row-level security and the database's checks apply), records
 * results as the service role.
 */
export function supabaseStore(
  asCaller: SupabaseClient | null,
  asService: SupabaseClient,
): PaymentStore {
  const caller = () => {
    if (!asCaller) throw new Error('This needs the signed-in investor');
    return asCaller;
  };
  return {
    async pledgeAmount(pledgeId) {
      const { data, error } = await caller()
        .from('investment_pledges')
        .select('amount_kobo')
        .eq('id', pledgeId)
        .maybeSingle();
      if (error) throw new Refused(error.message);
      if (!data) throw new Refused('Pledge not found');
      return BigInt(String(data.amount_kobo));
    },
    async start(pledgeId, provider, feeKobo) {
      const { data, error } = await caller().rpc('start_online_payment', {
        p_pledge_id: pledgeId,
        p_provider: provider,
        p_fee_kobo: feeKobo.toString(),
      });
      if (error) throw new Refused(error.message);
      return data;
    },
    async complete(r) {
      const { data, error } = await asService.rpc('complete_online_payment', {
        p_reference: r.reference,
        p_succeeded: r.succeeded,
        p_paid_kobo: r.paidKobo?.toString() ?? null,
        p_provider_reference: r.providerReference,
        p_channel: r.channel,
        p_paid_at: r.paidAt,
        p_message: r.message,
      });
      if (error) throw new Error(`Recording the payment failed: ${error.message}`);
      return data;
    },
  };
}

/** The database refused (not the investor's pledge, still cooling off, …). Safe to show. */
export class Refused extends Error {}
