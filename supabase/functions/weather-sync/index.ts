/**
 * weather-sync — refreshes the weather of every farm in a live cycle (see the weather
 * migration). Called by a daily scheduled job with the service role key, and by staff
 * pressing "Refresh weather" (with their own sign-in).
 *
 * POST {}, or { "stale_minutes": 30 } to refresh cells older than that (at least 15;
 * default 180). → { cells, updated, failed: [{ lat, lon, error }] }
 *
 * Secrets: OPEN_METEO_API_KEY (optional; for Open-Meteo's commercial API). Supabase
 * provides SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { weatherFromEnv } from '../_shared/weather/providers.ts';
import { syncWeather, type WeatherStore } from '../_shared/weather/run.ts';

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
  const body = (await req.json().catch(() => ({}))) as { stale_minutes?: unknown };
  const staleMinutes = Math.max(15, Math.min(24 * 60, Number(body.stale_minutes) || 180));

  const url = Deno.env.get('SUPABASE_URL')!;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    ...options,
    global: { headers: { Authorization: authorization } },
  });
  const { data: allowed, error } = await asCaller.rpc('may_refresh_weather');
  if (error || !allowed) return json({ error: 'Your role cannot refresh the weather' }, 403);

  const asService = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, options);
  const store: WeatherStore = {
    async cellsToSync() {
      const { data, error } = await asService.rpc('weather_cells_to_sync', {
        p_stale: `${staleMinutes} minutes`,
      });
      if (error) throw new Error(error.message);
      return (data as { id: string; lat: string; lon: string; needs_normals: boolean }[]).map(
        (c) => ({ ...c, lat: Number(c.lat), lon: Number(c.lon) }),
      );
    },
    async record(cellId, provider, days, normals, err) {
      const { error } = await asService.rpc('record_weather', {
        p_cell_id: cellId,
        p_provider: provider,
        p_days: days,
        p_normals: normals,
        p_error: err,
      });
      if (error) throw new Error(error.message);
    },
  };

  try {
    return json(
      await syncWeather(
        weatherFromEnv((n) => Deno.env.get(n)),
        store,
      ),
    );
  } catch (err) {
    console.error(err);
    return json({ error: 'The weather could not be refreshed' }, 500);
  }
});
