import { openMeteoProvider } from './openmeteo.ts';
import type { WeatherProvider } from './types.ts';

/**
 * Weather comes from Open-Meteo. Without OPEN_METEO_API_KEY it uses the free API (no
 * sign-up; non-commercial use only); with one, the commercial endpoints.
 */
export function weatherFromEnv(env: (name: string) => string | undefined): WeatherProvider {
  return openMeteoProvider({ apiKey: env('OPEN_METEO_API_KEY') });
}
