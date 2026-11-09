import { CloudRain, Sun, Thermometer } from 'lucide-react';
import { Link } from 'react-router';
import { supabase } from '../lib/supabase';
import { useAsync } from '../lib/useAsync';
import type { FlagKind, WeatherFlag } from '../lib/weather';
import { Card, SectionTitle } from './ui';

const ICON: Partial<Record<FlagKind, typeof Sun>> = {
  dry: Sun,
  wet: CloudRain,
  heavy_rain: CloudRain,
  heat: Thermometer,
};

/** Live cycles whose farms have weather to watch. Shows nothing when all is quiet. */
export function WeatherWatch() {
  const alerts = useAsync(async () => {
    const { data, error } = await supabase.rpc('weather_alerts');
    if (error) throw error;
    return data as { cycle_id: string; code: string; crop: string; flags: WeatherFlag[] }[];
  }, []);
  if (!alerts.data || alerts.data.length === 0) return null;

  return (
    <Card>
      <SectionTitle title="Weather to watch" description="At farms in live cycles" />
      <ul className="-mx-2 divide-y divide-zinc-950/5">
        {alerts.data.map((a) => (
          <li key={a.cycle_id}>
            <Link
              to={`/cycles/${a.cycle_id}?tab=weather`}
              className="block rounded-xl px-2 py-3 transition hover:bg-zinc-50"
            >
              <p className="text-sm font-medium text-zinc-900">
                {a.code} <span className="font-normal text-zinc-500">· {a.crop}</span>
              </p>
              <ul className="mt-1 space-y-1">
                {a.flags.map((f) => {
                  const Icon = ICON[f.kind] ?? Sun;
                  return (
                    <li key={f.message} className="flex items-start gap-2 text-xs text-zinc-600">
                      <Icon className="mt-px size-3.5 shrink-0 text-amber-600" aria-hidden />
                      {f.message}
                    </li>
                  );
                })}
              </ul>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
