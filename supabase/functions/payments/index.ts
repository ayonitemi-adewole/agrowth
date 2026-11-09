/**
 * payments — investors paying their pledges online. Signed in (the app sends the
 * investor's token). POST a JSON body with an action:
 *
 *   { "action": "config" }
 *     → { "provider": "paystack" | "mock" | null }   null: online payments are off
 *   { "action": "start", "pledge_id": "<uuid>", "return_url": "https://…/portfolio" }
 *     → { "reference", "checkout_url", "charge_kobo", "fee_kobo" }   send the investor there
 *   { "action": "verify", "reference": "AGC-…" }
 *     → { "status" }   asks the gateway, records the answer if there is one
 *   { "action": "simulate", "reference": "AGC-…", "pay": true }     simulated gateway only
 *     → { "status" }
 *
 * Secrets: PAYMENTS_PROVIDER (paystack | mock; unset means off) and PAYSTACK_SECRET_KEY.
 * Supabase provides SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { simulatedResult } from '../_shared/payments/mock.ts';
import { gatewayFromEnv } from '../_shared/payments/providers.ts';
import { recordPaymentResult, startPledgePayment } from '../_shared/payments/run.ts';
import { Refused, supabaseStore } from '../_shared/payments/store.ts';
import { GatewayError } from '../_shared/payments/types.ts';

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE = /^AGC-[0-9A-F]{12}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ error: 'Sign in first' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'The request body must be JSON' }, 400);
  }

  let gateway;
  try {
    gateway = gatewayFromEnv((name) => Deno.env.get(name));
  } catch (err) {
    console.error(err);
    return json({ error: 'Online payments are not configured correctly on the server' }, 500);
  }
  if (body.action === 'config') return json({ provider: gateway?.name ?? null });
  if (!gateway)
    return json({ error: 'Online payments are not available. Pay by bank transfer instead.' }, 409);

  const url = Deno.env.get('SUPABASE_URL')!;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    ...options,
    global: { headers: { Authorization: authorization } },
  });
  const asService = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, options);
  const store = supabaseStore(asCaller, asService);

  /** The investor's own payment attempt, read with their permissions. */
  const ownPayment = async (reference: unknown) => {
    if (typeof reference !== 'string' || !REFERENCE.test(reference))
      throw new Refused('Unknown payment');
    const { data } = await asCaller
      .from('online_payments')
      .select('reference, provider, charge_kobo, status')
      .eq('reference', reference)
      .maybeSingle();
    if (!data) throw new Refused('Unknown payment');
    return data as {
      reference: string;
      provider: string;
      charge_kobo: string | number;
      status: string;
    };
  };

  try {
    switch (body.action) {
      case 'start': {
        const pledgeId = body.pledge_id;
        const returnUrl = typeof body.return_url === 'string' ? body.return_url : '';
        if (typeof pledgeId !== 'string' || !UUID.test(pledgeId))
          return json({ error: 'Which pledge?' }, 400);
        let parsed: URL;
        try {
          parsed = new URL(returnUrl);
        } catch {
          return json({ error: 'A return address is needed' }, 400);
        }
        if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
          return json({ error: 'The return address must use https' }, 400);
        }
        const started = await startPledgePayment(gateway, store, pledgeId, parsed.toString());
        return json({
          reference: started.reference,
          checkout_url: started.checkoutUrl,
          charge_kobo: started.chargeKobo,
          fee_kobo: started.feeKobo,
        });
      }
      case 'verify': {
        const payment = await ownPayment(body.reference);
        if (payment.status !== 'initiated' || payment.provider !== gateway.name) {
          return json({ status: payment.status });
        }
        const status = await recordPaymentResult(
          store,
          gateway.name,
          await gateway.verify(payment.reference),
        );
        return json({ status });
      }
      case 'simulate': {
        if (gateway.name !== 'mock')
          return json({ error: 'Only the simulated gateway can do this' }, 400);
        const payment = await ownPayment(body.reference);
        const result = simulatedResult(
          payment.reference,
          BigInt(payment.charge_kobo),
          body.pay === true,
        );
        return json({ status: await recordPaymentResult(store, 'mock', result) });
      }
      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (err) {
    if (err instanceof Refused || err instanceof GatewayError)
      return json({ error: err.message }, 409);
    console.error(err);
    return json({ error: 'The payment could not be processed. Try again.' }, 500);
  }
});
