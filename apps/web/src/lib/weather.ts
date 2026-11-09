import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

/*
 * Weather per farm: what public.cycle_weather returns, and asking the weather-sync
 * function for fresh data (supabase/functions/weather-sync).
 */

export type FlagKind = 'dry' | 'wet' | 'heavy_rain' | 'heat' | 'stale';

export interface WeatherFlag {
  kind: FlagKind;
  message: string;
}

export interface WeatherDay {
  day: string;
  rain_mm: number | null;
  tmax_c: number | null;
  tmin_c: number | null;
  forecast: boolean;
  /** The 10-year average for this date; null until the normals are in. */
  normal_mm: number | null;
}

export interface WeatherCell {
  lat: number;
  lon: number;
  farms: number;
  hectares: number;
  synced_at: string | null;
  provider: string | null;
  normals_years: number | null;
  last_error: string | null;
  season: {
    from: string;
    to: string;
    rain_mm: number;
    days_with_data: number;
    normal_mm: number | null;
  } | null;
  last30: { rain_mm: number; normal_mm: number | null } | null;
  days: WeatherDay[];
  flags: WeatherFlag[];
}

export interface CycleWeather {
  today: string;
  cells: WeatherCell[];
}

export async function loadCycleWeather(cycleId: string): Promise<CycleWeather> {
  const { data, error } = await supabase.rpc('cycle_weather', { p_cycle_id: cycleId });
  if (error) throw error;
  return data as CycleWeather;
}

/** Asks for weather newer than half an hour. Returns how many areas were updated. */
export async function refreshWeather(): Promise<{
  cells: number;
  updated: number;
  failed: { error: string }[];
}> {
  const { data, error } = await supabase.functions.invoke('weather-sync', {
    body: { stale_minutes: 30 },
  });
  if (error) {
    let message = 'The weather service could not be reached.';
    if (error instanceof FunctionsHttpError) {
      const b = (await error.context.json().catch(() => null)) as { error?: string } | null;
      if (b?.error) message = b.error;
    }
    throw new Error(message);
  }
  return data;
}

/** Rain as a share of the usual, e.g. 0.42; null when there's no usual to compare with. */
export const shareOfUsual = (rain: number, usual: number | null) =>
  usual === null || usual <= 0 ? null : rain / usual;

/** "42% of usual", or "" when there's nothing to compare with. */
export function vsUsual(rain: number, usual: number | null): string {
  const share = shareOfUsual(rain, usual);
  return share === null ? '' : `${Math.round(share * 100)}% of usual (${Math.round(usual!)} mm)`;
}

/** A tidy top for the rain axis: 10, 20, 25, 50, 100… mm, never below 10. */
export function rainAxisMax(values: number[]): number {
  const top = Math.max(10, ...values.filter((v) => Number.isFinite(v)));
  const steps = [10, 20, 25, 40, 50, 60, 80, 100, 150, 200, 250, 300, 400, 500];
  return steps.find((s) => s >= top) ?? Math.ceil(top / 100) * 100;
}

export const FLAG_LABEL: Record<FlagKind, string> = {
  dry: 'Dry spell',
  wet: 'Very wet',
  heavy_rain: 'Heavy rain forecast',
  heat: 'Heat',
  stale: 'Out of date',
};
