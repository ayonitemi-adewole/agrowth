/**
 * payments-webhook — the payment gateway tells us about payments. Not signed in: the
 * gateway calls it directly, and each call is checked against the gateway's signature
 * instead (deployed with --no-verify-jwt; see config.toml).
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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Use POST', { status: 405 });
  const gateway = gatewayFromEnv((name) => Deno.env.get(name));
  if (!gateway) return new Response('Online payments are off', { status: 404 });

  const raw = await req.text();
  const result = await gateway.parseWebhook(raw, req.headers);
  if (result === null) return new Response('Bad signature', { status: 401 });
  if (result === 'ignored') return new Response('ok');

  const asService = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  try {
    const status = await recordPaymentResult(supabaseStore(null, asService), gateway.name, result);
    return new Response(JSON.stringify({ status }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    // A payment we don't know (another app on the same Paystack account) isn't an error.
    if (err instanceof Error && /No online payment/.test(err.message)) return new Response('ok');
    console.error(err);
    return new Response('Could not record the payment', { status: 500 });
  }
});
