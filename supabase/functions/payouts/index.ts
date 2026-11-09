/**
 * payouts — the trustee pays through the payment gateway (transfers from its Paystack
 * balance). Signed in as the trustee. POST a JSON body with an action:
 *
 *   { "action": "config" }
 *     → { "provider": "paystack" | "mock" | null, "balance_kobo": "…" | null }
 *   { "action": "send", "items": [{ "kind", "item_id" }] }
 *     → { "results": [{ id, item_id, status, message }] }
 *
 * Each payment's account is looked up first; it's only sent if the bank holds it for the
 * payee. Paystack confirms transfers by webhook (payments-webhook).
 *
 * Secrets: PAYOUTS_ENABLED=true, PAYMENTS_PROVIDER (paystack | mock), PAYSTACK_SECRET_KEY.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { GatewayError } from '../_shared/payments/types.ts';
import { payoutsFromEnv } from '../_shared/payouts/providers.ts';
import { sendPayouts, type Payable, type PayoutStore } from '../_shared/payouts/run.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ error: 'Sign in first' }, 401);
  const body = (await req.json().catch(() => ({}))) as { action?: string; items?: unknown };

  let gateway;
  try {
    gateway = payoutsFromEnv((name) => Deno.env.get(name));
  } catch (err) {
    console.error(err);
    return json({ error: 'Payouts are not configured correctly on the server' }, 500);
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    ...options,
    global: { headers: { Authorization: authorization } },
  });
  const asService = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, options);

  // Only the trustee: trustee_payments() refuses everyone who can't read the ledger, and
  // start_gateway_payouts everyone but the trustee.
  const { data: payments, error: listError } = await asCaller.rpc('trustee_payments');
  if (listError) return json({ error: listError.message }, 403);

  if (body.action === 'config') {
    let balance: bigint | null = null;
    try {
      balance = gateway ? await gateway.balance() : null;
    } catch {
      balance = null;
    }
    return json({ provider: gateway?.name ?? null, balance_kobo: balance?.toString() ?? null });
  }
  if (!gateway) return json({ error: 'Paying through the gateway is not switched on' }, 409);
  if (body.action !== 'send') return json({ error: 'Unknown action' }, 400);

  const wanted = Array.isArray(body.items)
    ? (body.items as { kind?: string; item_id?: string }[])
    : [];
  const chosen = (payments as (Payable & { narration: string })[]).filter((p) =>
    wanted.some((w) => w.kind === p.kind && w.item_id === p.item_id),
  );
  if (chosen.length === 0 || chosen.length !== wanted.length) {
    return json({ error: 'Some of those payments are not waiting to be paid' }, 400);
  }

  const store: PayoutStore = {
    async start(items, provider) {
      const { data, error } = await asCaller.rpc('start_gateway_payouts', {
        p_items: items,
        p_provider: provider,
      });
      if (error) throw new GatewayError(error.message);
      return data;
    },
    async record(id, status, ref, name, message) {
      const { error } = await asService.rpc('record_gateway_transfer', {
        p_transfer_id: id,
        p_status: status,
        p_provider_reference: ref,
        p_resolved_account_name: name,
        p_message: message,
      });
      if (error) throw new Error(error.message);
    },
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

  try {
    const reasons = Object.fromEntries(chosen.map((p) => [p.item_id, p.narration]));
    return json({ results: await sendPayouts(gateway, store, chosen, reasons) });
  } catch (err) {
    if (err instanceof GatewayError) return json({ error: err.message }, 409);
    console.error(err);
    return json({ error: 'The payments could not be sent' }, 500);
  }
});
