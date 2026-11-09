/**
 * payments-webhook — the payment gateway tells us about payments in (pledges paid online)
 * and out (transfers the trustee sent). Not signed in: the gateway calls it directly, and
 * each call is checked against the gateway's signature instead (deployed with
 * --no-verify-jwt; see config.toml).
 *
 * Set this URL as the webhook in the Paystack dashboard (Settings → API Keys & Webhooks):
 *   https://<project>.supabase.co/functions/v1/payments-webhook
 *
 * Answers 200 to anything signed, so the gateway doesn't retry events we don't use;
 * 401 to anything unsigned; 500 if recording failed, so the gateway retries.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { gatewayFromEnv } from '../_shared/payments/providers.ts';
import { recordPaymentResult } from '../_shared/payments/run.ts';
import { supabaseStore } from '../_shared/payments/store.ts';
import { payoutsFromEnv } from '../_shared/payouts/providers.ts';
import { recordTransferResult, type PayoutStore } from '../_shared/payouts/run.ts';

const ok = (body: unknown = 'ok') =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    headers: { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Use POST', { status: 405 });
  const gateway = gatewayFromEnv((name) => Deno.env.get(name));
  if (!gateway) return new Response('Online payments are off', { status: 404 });
  const payouts = payoutsFromEnv((name) => Deno.env.get(name));

  const raw = await req.text();
  const payment = await gateway.parseWebhook(raw, req.headers);
  if (payment === null) return new Response('Bad signature', { status: 401 });

  const asService = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  try {
    if (payment !== 'ignored') {
      return ok({
        status: await recordPaymentResult(supabaseStore(null, asService), gateway.name, payment),
      });
    }
    // Not a payment in: perhaps a transfer out.
    const transfer = payouts ? await payouts.parseTransferWebhook(raw, req.headers) : 'ignored';
    if (transfer === null || transfer === 'ignored') return ok();
    const store: Pick<PayoutStore, 'complete'> = {
      async complete(id, succeeded, ref, message, reversed = false) {
        const { data, error } = await asService.rpc('complete_gateway_transfer', {
          p_transfer_id: id,
          p_succeeded: succeeded,
          p_provider_reference: ref,
          p_message: message,
          p_reversed: reversed,
        });
        if (error) throw new Error(error.message);
        return data;
      },
    };
    return ok({ status: await recordTransferResult(store as PayoutStore, transfer) });
  } catch (err) {
    // A payment or transfer we don't know (another app on the same Paystack account)
    // isn't an error.
    if (
      err instanceof Error &&
      /No online payment|No gateway transfer|invalid input syntax/.test(err.message)
    ) {
      return ok();
    }
    console.error(err);
    return new Response('Could not record the payment', { status: 500 });
  }
});
