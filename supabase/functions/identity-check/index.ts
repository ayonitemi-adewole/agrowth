/**
 * identity-check — looks up NINs and BVNs with the identity provider and records the
 * outcome on public.identity_checks.
 *
 * POST, signed in (the app sends the user's token):
 *   { "subject": "farmer" | "investor", "subject_id": "<uuid>",
 *     "checks": [{ "number_type": "nin" | "bvn", "number": "12345678901" }] }
 * → { "results": [ CheckResult | { "number_type", "refused": "<why>" } ] }
 *
 * The number is used for the lookup and then forgotten. The database stores only its
 * keyed hash (from enrolment) and the check's outcome.
 *
 * Secrets: IDENTITY_PROVIDER (mock | dojah, default mock); for Dojah, DOJAH_APP_ID,
 * DOJAH_SECRET_KEY and optionally DOJAH_BASE_URL. Supabase provides SUPABASE_URL,
 * SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { providerFromEnv } from '../_shared/identity/providers.ts';
import { runIdentityCheck, type CheckStore } from '../_shared/identity/run.ts';
import type { NumberType, Subject } from '../_shared/identity/types.ts';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ error: 'Sign in first' }, 401);

  let body: { subject?: unknown; subject_id?: unknown; checks?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'The request body must be JSON' }, 400);
  }
  const subject = body.subject as Subject;
  const subjectId = body.subject_id as string;
  const checks = body.checks as { number_type?: unknown; number?: unknown }[];
  if (
    (subject !== 'farmer' && subject !== 'investor') ||
    typeof subjectId !== 'string' ||
    !UUID.test(subjectId) ||
    !Array.isArray(checks) ||
    checks.length < 1 ||
    checks.length > 2 ||
    checks.some(
      (c) => (c.number_type !== 'nin' && c.number_type !== 'bvn') || typeof c.number !== 'string',
    )
  ) {
    return json({ error: 'Send subject, subject_id and one or two checks' }, 400);
  }

  let provider;
  try {
    provider = providerFromEnv((name) => Deno.env.get(name));
  } catch (err) {
    console.error(err);
    return json({ error: 'Identity checks are not configured on the server' }, 500);
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const asService = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const store: CheckStore = {
    async start(r, providerName) {
      const { data, error } = await asCaller.rpc('start_identity_check', {
        p_subject: r.subject,
        p_subject_id: r.subject_id,
        p_number_type: r.number_type,
        p_number: r.number,
        p_provider: providerName,
      });
      if (error) throw new Refused(error.message);
      return data;
    },
    async complete(args) {
      const { error } = await asService.rpc('complete_identity_check', args);
      if (error) throw new Error(`Recording the result failed: ${error.message}`);
    },
  };

  const results = [];
  for (const c of checks) {
    const numberType = c.number_type as NumberType;
    try {
      results.push(
        await runIdentityCheck(provider, store, {
          subject,
          subject_id: subjectId,
          number_type: numberType,
          number: c.number as string,
        }),
      );
    } catch (err) {
      if (err instanceof Refused) {
        results.push({ number_type: numberType, refused: err.message });
      } else {
        console.error(err);
        return json({ error: 'The identity check failed on the server' }, 500);
      }
    }
  }
  return json({ results });
});

/** The database refused to open the check (permission, wrong number, too many tries). */
class Refused extends Error {}
