import { CloudRain, RefreshCw, Sun, Thermometer, TimerOff } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../components/Toast';
import {
  Alert,
  Button,
  EmptyState,
  SectionTitle,
  Select,
  Skeleton,
  Stat,
  Table,
  cx,
} from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { can } from '../../lib/roles';
import { useAsync } from '../../lib/useAsync';
import {
  FLAG_LABEL,
  loadCycleWeather,
  rainAxisMax,
  refreshWeather,
  vsUsual,
  type FlagKind,
  type WeatherCell,
  type WeatherDay,
} from '../../lib/weather';
import type { TabProps } from './useCycleData';

const FLAG_ICON: Record<FlagKind, ReactNode> = {
  dry: <Sun className="size-4" aria-hidden />,
  wet: <CloudRain className="size-4" aria-hidden />,
  heavy_rain: <CloudRain className="size-4" aria-hidden />,
  heat: <Thermometer className="size-4" aria-hidden />,
  stale: <TimerOff className="size-4" aria-hidden />,
};

/** Rainfall and temperatures at the cycle's farms, from the weather provider. */
export function WeatherTab({ data }: TabProps) {
  const role = useAuth().profile?.role;
  const toast = useToast();
  const weather = useAsync(() => loadCycleWeather(data.cycle.id), [data.cycle.id]);
  const [cellIndex, setCellIndex] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await refreshWeather();
      if (r.failed.length) toast.error(`Weather: ${r.failed[0].error}`);
      else toast.success(r.updated ? 'Weather updated' : 'The weather is already up to date');
      weather.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  };

  if (weather.loading && !weather.data) return <Skeleton className="h-80 rounded-2xl" />;
  if (weather.error) return <Alert>{errorMessage(weather.error)}</Alert>;
  const { cells, today } = weather.data!;
  const refreshButton = can.readCycles(role) ? (
    <Button variant="secondary" size="sm" busy={refreshing} onClick={refresh}>
      <RefreshCw aria-hidden /> Refresh weather
    </Button>
  ) : null;

  if (cells.length === 0) {
    return <EmptyState>Add farms to the cycle to see their weather.</EmptyState>;
  }
  const cell = cells[Math.min(cellIndex, cells.length - 1)];

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Weather at the farms"
        description={
          cell.synced_at
            ? `Updated ${formatDate(cell.synced_at)} from ${cell.provider === 'open-meteo' ? 'Open-Meteo' : cell.provider}. Farms within about 11 km share a reading.`
            : 'Farms within about 11 km share a reading.'
        }
        actions={
          <>
            {cells.length > 1 && (
              <Select
                aria-label="Area"
                value={cellIndex}
                onChange={(e) => setCellIndex(Number(e.target.value))}
                className="h-8 w-auto text-xs"
              >
                {cells.map((c, i) => (
                  <option key={`${c.lat},${c.lon}`} value={i}>
                    {c.farms} farm{c.farms === 1 ? '' : 's'} near {c.lat.toFixed(1)}°N,{' '}
                    {c.lon.toFixed(1)}°E
                  </option>
                ))}
              </Select>
            )}
            {refreshButton}
          </>
        }
      />

      {cell.days.length === 0 ? (
        <EmptyState>
          No weather yet for these farms.{' '}
          {cell.last_error
            ? `The last attempt failed: ${cell.last_error}.`
            : 'It arrives with the next daily update, or press Refresh weather.'}
        </EmptyState>
      ) : (
        <CellWeather cell={cell} today={today} />
      )}
    </div>
  );
}

function CellWeather({ cell, today }: { cell: WeatherCell; today: string }) {
  const [asTable, setAsTable] = useState(false);
  const forecast = cell.days.filter((d) => d.forecast);
  const nextWeekRain = forecast.reduce((s, d) => s + (d.rain_mm ?? 0), 0);
  const hottest = forecast.reduce<number | null>(
    (m, d) => (d.tmax_c === null ? m : Math.max(m ?? -Infinity, d.tmax_c)),
    null,
  );

  return (
    <>
      {cell.flags.length > 0 && (
        <div className="space-y-2">
          {cell.flags.map((f) => (
            <Alert key={f.kind} tone="warning" title={FLAG_LABEL[f.kind]}>
              <span className="inline-flex items-center gap-2">
                {FLAG_ICON[f.kind]} {f.message}
              </span>
            </Alert>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          icon={<CloudRain />}
          tone="blue"
          label="Season so far"
          value={cell.season ? `${Math.round(cell.season.rain_mm)} mm` : '—'}
          sub={
            cell.season
              ? `${vsUsual(cell.season.rain_mm, cell.season.normal_mm) || 'No usual yet'} since ${formatDate(cell.season.from)}${
                  cell.season.days_with_data < daysBetween(cell.season.from, cell.season.to) + 1
                    ? ' (records cover the last three months)'
                    : ''
                }`
              : 'The season hasn’t started'
          }
        />
        <Stat
          icon={<CloudRain />}
          tone="blue"
          label="Last 30 days"
          value={cell.last30 ? `${Math.round(cell.last30.rain_mm)} mm` : '—'}
          sub={cell.last30 ? vsUsual(cell.last30.rain_mm, cell.last30.normal_mm) : undefined}
        />
        <Stat
          icon={<Thermometer />}
          tone="amber"
          label="Next 7 days"
          value={`${Math.round(nextWeekRain)} mm`}
          sub={hottest === null ? undefined : `Highs up to ${Math.round(hottest)} °C`}
        />
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-zinc-950/5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Daily rainfall</h3>
            <p className="text-xs text-zinc-500">Last 60 days and the coming week, in mm</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setAsTable(!asTable)}>
            {asTable ? 'Show chart' : 'Show as table'}
          </Button>
        </div>
        {asTable ? <DayTable days={cell.days} /> : <RainChart days={cell.days} today={today} />}
      </div>

      {forecast.length > 0 && (
        <div>
          <SectionTitle title="The coming week" />
          <Table head={['Day', 'Rain', 'High', 'Low']}>
            {forecast.map((d) => (
              <tr key={d.day}>
                <td className="whitespace-nowrap">{dayLabel(d.day, true)}</td>
                <td className="tabular-nums">{fmt(d.rain_mm, ' mm')}</td>
                <td className="tabular-nums">{fmt(d.tmax_c, ' °C')}</td>
                <td className="tabular-nums">{fmt(d.tmin_c, ' °C')}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </>
  );
}

const fmt = (v: number | null, unit: string) =>
  v === null ? '—' : `${Math.round(v * 10) / 10}${unit}`;
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const dayLabel = (day: string, weekday = false) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    ...(weekday ? { weekday: 'short' } : {}),
    timeZone: 'UTC',
  });

function DayTable({ days }: { days: WeatherDay[] }) {
  return (
    <div className="max-h-96 overflow-y-auto">
      <Table head={['Day', 'Rain', 'Usual', 'High', 'Low', '']}>
        {[...days].reverse().map((d) => (
          <tr key={d.day}>
            <td className="whitespace-nowrap">{dayLabel(d.day, true)}</td>
            <td className="tabular-nums">{fmt(d.rain_mm, ' mm')}</td>
            <td className="tabular-nums text-zinc-500">{fmt(d.normal_mm, ' mm')}</td>
            <td className="tabular-nums">{fmt(d.tmax_c, ' °C')}</td>
            <td className="tabular-nums">{fmt(d.tmin_c, ' °C')}</td>
            <td className="text-xs text-zinc-500">{d.forecast ? 'Forecast' : ''}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ---------- The chart ----------

const RAIN = '#2a78d6';
const USUAL = '#898781';
const GRID = '#e4e4e7';

/**
 * Daily rain as columns, the forecast hatched, and the usual rain for each date as a line,
 * on one mm axis. Hovering a day shows its figures; the table view has them all.
 */
export function RainChart({ days, today }: { days: WeatherDay[]; today: string }) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at its real width, so labels stay a readable size on a phone.
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    if (!box) return;
    const observer = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    observer.observe(box);
    return () => observer.disconnect();
  }, [box]);
  const W = Math.max(300, width);
  const H = 230;
  const m = { top: 16, right: 44, bottom: 26, left: 34 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;
  const n = days.length;
  const slot = plotW / n;
  const barW = Math.max(1, Math.min(24, slot - 2));
  const r = Math.min(4, barW / 2);
  const top = rainAxisMax(days.flatMap((d) => [d.rain_mm ?? 0, d.normal_mm ?? 0]));
  const y = (v: number) => m.top + plotH - (v / top) * plotH;
  const x = (i: number) => m.left + i * slot + slot / 2;
  const ticks = [0, top / 2, top];
  const firstForecast = days.findIndex((d) => d.forecast || d.day >= today);
  // The usual rain for each date, averaged over the week around it: a single date's
  // ten-year average still jumps about, and the line is there to show the season's shape.
  const smoothed = days.map((_, i) => {
    const near = days
      .slice(Math.max(0, i - 3), i + 4)
      .map((d) => d.normal_mm)
      .filter((v): v is number => v !== null);
    return days[i].normal_mm === null || near.length === 0
      ? null
      : near.reduce((s, v) => s + v, 0) / near.length;
  });
  const usual = smoothed
    .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .filter(Boolean);
  const lastUsualIndex = smoothed.findLastIndex((v) => v !== null);
  // Date labels at the 1st and 15th of each month.
  const labels = days
    .map((d, i) => ({ d, i }))
    // Only the 1st when the 15th wouldn't leave room between labels.
    .filter(({ d }) => d.day.endsWith('-01') || (slot * 15 >= 56 && d.day.endsWith('-15')));

  const column = (d: WeatherDay, i: number) => {
    const v = d.rain_mm ?? 0;
    if (v <= 0) return null;
    const h = Math.max(1, y(0) - y(v));
    const x0 = x(i) - barW / 2;
    const rr = Math.min(r, h);
    const path = `M${x0},${y(0)} V${y(0) - h + rr} Q${x0},${y(0) - h} ${x0 + rr},${y(0) - h} H${
      x0 + barW - rr
    } Q${x0 + barW},${y(0) - h} ${x0 + barW},${y(0) - h + rr} V${y(0)} Z`;
    return (
      <path
        key={d.day}
        d={path}
        fill={d.forecast ? 'url(#rain-forecast)' : RAIN}
        opacity={hover === null || hover === i ? 1 : 0.55}
      />
    );
  };

  const h = hover === null ? null : days[hover];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: RAIN }} aria-hidden /> Rain
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg className="size-2.5" viewBox="0 0 10 10" aria-hidden>
            <rect width="10" height="10" rx="2" fill="url(#rain-forecast)" />
          </svg>
          Forecast
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full" style={{ background: USUAL }} aria-hidden />{' '}
          Usual for the date (10-year average)
        </span>
      </div>
      <div className="relative" ref={setBox}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label="Daily rainfall for the last 60 days and the coming week, against the usual for each date"
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <pattern
              id="rain-forecast"
              width="4"
              height="4"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="4" height="4" fill="#d6e6f8" />
              <rect width="1.6" height="4" fill={RAIN} />
            </pattern>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={m.left}
                x2={W - m.right}
                y1={y(t)}
                y2={y(t)}
                stroke={GRID}
                strokeWidth="1"
              />
              <text
                x={m.left - 6}
                y={y(t) + 4}
                textAnchor="end"
                className="fill-zinc-500 text-[11px]"
              >
                {t}
              </text>
            </g>
          ))}
          {firstForecast > 0 && (
            <g>
              <line
                x1={m.left + firstForecast * slot}
                x2={m.left + firstForecast * slot}
                y1={m.top - 6}
                y2={y(0)}
                stroke="#a1a1aa"
                strokeWidth="1"
              />
              <text
                x={m.left + firstForecast * slot + 4}
                y={m.top + 2}
                className="fill-zinc-500 text-[11px]"
              >
                Forecast
              </text>
            </g>
          )}
          {days.map(column)}
          {usual.length > 1 && (
            <polyline
              points={usual.join(' ')}
              fill="none"
              stroke={USUAL}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {lastUsualIndex >= 0 && (
            <text
              x={x(lastUsualIndex) + 6}
              y={y(smoothed[lastUsualIndex]!) + 4}
              className="fill-zinc-500 text-[11px]"
            >
              Usual
            </text>
          )}
          {labels.map(({ d, i }) => (
            <text
              key={d.day}
              x={x(i)}
              y={H - 8}
              textAnchor="middle"
              className="fill-zinc-500 text-[11px]"
            >
              {dayLabel(d.day)}
            </text>
          ))}
          {/* Hit targets: the whole height of each day, wider than its column. */}
          {days.map((d, i) => (
            <rect
              key={`hit-${d.day}`}
              x={m.left + i * slot}
              y={m.top}
              width={slot}
              height={plotH}
              fill="transparent"
              onPointerEnter={() => setHover(i)}
            />
          ))}
          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={m.top}
              y2={y(0)}
              stroke="#a1a1aa"
              strokeWidth="1"
              pointerEvents="none"
            />
          )}
        </svg>
        {h && (
          <div
            className={cx(
              'pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg bg-white px-3 py-2 text-xs shadow-pop ring-1 ring-zinc-950/10',
              hover! > n / 2 ? '-translate-x-full' : '',
            )}
            style={{ left: `${(x(hover!) / W) * 100}%`, marginLeft: hover! > n / 2 ? -8 : 8 }}
          >
            <p className="mb-1 font-medium text-zinc-900">
              {dayLabel(h.day, true)}
              {h.forecast && <span className="ml-1 font-normal text-zinc-500">· forecast</span>}
            </p>
            <TipRow color={RAIN} value={fmt(h.rain_mm, ' mm')} label="Rain" />
            <TipRow color={USUAL} value={fmt(h.normal_mm, ' mm')} label="Usual" />
            <p className="mt-1 text-zinc-500">
              {fmt(h.tmax_c, '°')} / {fmt(h.tmin_c, '°C')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function TipRow({ color, value, label }: { color: string; value: string; label: string }) {
  return (
    <p className="flex items-center gap-2">
      <span className="h-0.5 w-3 rounded-full" style={{ background: color }} aria-hidden />
      <span className="font-semibold text-zinc-900 tabular-nums">{value}</span>
      <span className="text-zinc-500">{label}</span>
    </p>
  );
}
