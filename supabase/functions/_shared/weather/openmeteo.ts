import { WeatherError, type DailyWeather, type Normals, type WeatherProvider } from './types.ts';

/**
 * Open-Meteo (open-meteo.com): weather models and the ERA5 reanalysis, by coordinates.
 *
 *   GET {forecast}/v1/forecast?latitude&longitude&daily=precipitation_sum,temperature_2m_max,
 *       temperature_2m_min&past_days=92&forecast_days=8&timezone=Africa/Lagos
 *   GET {archive}/v1/archive?latitude&longitude&start_date&end_date&daily=precipitation_sum
 *       &timezone=Africa/Lagos
 *   → { daily: { time: [...], precipitation_sum: [...], temperature_2m_max: [...], … } }
 *
 * The free API needs no key but is for non-commercial use. A commercial subscription uses
 * the customer- hosts with &apikey=…; set OPEN_METEO_API_KEY and those are used instead.
 */
export interface OpenMeteoConfig {
  apiKey?: string;
  fetch?: typeof fetch;
}

/** Years of history averaged for the normals. */
export const NORMAL_YEARS = 10;

type Daily = Record<string, (number | string | null)[] | undefined>;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Average rainfall for each MM-DD over the days given (29 Feb uses its own few years). */
export function normalsFrom(
  days: { day: string; rain_mm: number | null }[],
): Record<string, number> {
  const sums = new Map<string, { total: number; n: number }>();
  for (const d of days) {
    if (d.rain_mm === null) continue;
    const key = d.day.slice(5, 10);
    const s = sums.get(key) ?? { total: 0, n: 0 };
    s.total += d.rain_mm;
    s.n += 1;
    sums.set(key, s);
  }
  const out: Record<string, number> = {};
  for (const [key, s] of [...sums].sort(([a], [b]) => a.localeCompare(b))) {
    out[key] = Math.round((s.total / s.n) * 100) / 100;
  }
  return out;
}

export function openMeteoProvider(config: OpenMeteoConfig = {}): WeatherProvider {
  const doFetch = config.fetch ?? fetch;
  const key = config.apiKey?.trim();
  const forecastBase = key ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com';
  const archiveBase = key
    ? 'https://customer-archive-api.open-meteo.com'
    : 'https://archive-api.open-meteo.com';

  const get = async (
    base: string,
    path: string,
    params: Record<string, string>,
  ): Promise<Daily> => {
    const q = new URLSearchParams({ ...params, timezone: 'Africa/Lagos' });
    if (key) q.set('apikey', key);
    let res: Response;
    try {
      res = await doFetch(`${base}${path}?${q}`, { signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new WeatherError('Could not reach Open-Meteo');
    }
    const body = (await res.json().catch(() => null)) as { daily?: Daily; reason?: string } | null;
    if (!res.ok || !body?.daily || !Array.isArray(body.daily.time)) {
      throw new WeatherError(`Open-Meteo: ${body?.reason ?? `HTTP ${res.status}`}`);
    }
    return body.daily;
  };
  const coords = (lat: number, lon: number) => ({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
  });

  return {
    name: 'open-meteo',

    async recent(lat, lon, today) {
      const d = await get(forecastBase, '/v1/forecast', {
        ...coords(lat, lon),
        daily: 'precipitation_sum,temperature_2m_max,temperature_2m_min',
        past_days: '92',
        forecast_days: '8',
      });
      return (d.time as string[]).map((day, i): DailyWeather => ({
        day,
        rain_mm: num(d.precipitation_sum?.[i]),
        tmax_c: num(d.temperature_2m_max?.[i]),
        tmin_c: num(d.temperature_2m_min?.[i]),
        forecast: day >= today,
      }));
    },

    async normals(lat, lon, today): Promise<Normals> {
      const lastYear = Number(today.slice(0, 4)) - 1;
      const d = await get(archiveBase, '/v1/archive', {
        ...coords(lat, lon),
        daily: 'precipitation_sum',
        start_date: `${lastYear - NORMAL_YEARS + 1}-01-01`,
        end_date: `${lastYear}-12-31`,
      });
      const days = (d.time as string[]).map((day, i) => ({
        day,
        rain_mm: num(d.precipitation_sum?.[i]),
      }));
      return { rain_mm: normalsFrom(days), years: NORMAL_YEARS };
    },
  };
}
