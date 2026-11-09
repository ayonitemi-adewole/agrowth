import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { normalsFrom, openMeteoProvider } from '../functions/_shared/weather/openmeteo';
import { lagosToday, syncWeather, type WeatherStore } from '../functions/_shared/weather/run';
import { seedDemo } from '../seed/seed';
import { asService, asUser, createDb, pgError, type Tx } from './db';
import { pgliteApi } from './pglite-api';

const today = lagosToday();
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * A stand-in for Open-Meteo, answering in its format: a dry month (1 mm a day against a
 * normal of 5), 60 mm forecast in two days, and 41 °C in three.
 */
const calls: string[] = [];
const fakeOpenMeteo = (async (url: string) => {
  calls.push(url);
  const u = new URL(url);
  const time: string[] = [];
  if (u.pathname === '/v1/forecast') {
    for (let i = -92; i <= 7; i++) time.push(addDays(today, i));
    return Response.json({
      daily: {
        time,
        precipitation_sum: time.map((d) => (d === addDays(today, 2) ? 60 : 1)),
        temperature_2m_max: time.map((d) => (d === addDays(today, 3) ? 41 : 33)),
        temperature_2m_min: time.map(() => 21),
      },
    });
  }
  for (
    let d = u.searchParams.get('start_date')!;
    d <= u.searchParams.get('end_date')!;
    d = addDays(d, 1)
  ) {
    time.push(d);
  }
  return Response.json({ daily: { time, precipitation_sum: time.map(() => 5) } });
}) as unknown as typeof fetch;

describe('Open-Meteo adapter', () => {
  it('averages each day of the year over the years given', () => {
    expect(
      normalsFrom([
        { day: '2023-06-01', rain_mm: 4 },
        { day: '2024-06-01', rain_mm: 7 },
        { day: '2024-02-29', rain_mm: 3 },
        { day: '2025-06-01', rain_mm: null },
      ]),
    ).toEqual({ '02-29': 3, '06-01': 5.5 });
  });

  it('asks for the last three months and the coming week, and marks the forecast', async () => {
    const days = await openMeteoProvider({ fetch: fakeOpenMeteo }).recent(11.06, 7.71, today);
    const url = new URL(calls.at(-1)!);
    expect(url.origin).toBe('https://api.open-meteo.com');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      latitude: '11.06',
      longitude: '7.71',
      past_days: '92',
      forecast_days: '8',
      timezone: 'Africa/Lagos',
    });
    expect(days.find((d) => d.day === addDays(today, -1))).toMatchObject({
      rain_mm: 1,
      forecast: false,
    });
    expect(days.find((d) => d.day === today)?.forecast).toBe(true);
  });

  it('uses ten past full years for the normals, and the commercial hosts with a key', async () => {
    const normals = await openMeteoProvider({ fetch: fakeOpenMeteo, apiKey: 'k1' }).normals(
      11,
      7,
      '2026-11-09',
    );
    const url = new URL(calls.at(-1)!);
    expect(url.origin).toBe('https://customer-archive-api.open-meteo.com');
    expect(url.searchParams.get('apikey')).toBe('k1');
    expect([url.searchParams.get('start_date'), url.searchParams.get('end_date')]).toEqual([
      '2016-01-01',
      '2025-12-31',
    ]);
    expect(normals.years).toBe(10);
    expect(normals.rain_mm['07-15']).toBe(5);
  });

  it('says what went wrong when Open-Meteo refuses', async () => {
    const refusing = (async () =>
      Response.json(
        { error: true, reason: 'Latitude must be in range' },
        { status: 400 },
      )) as unknown as typeof fetch;
    await expect(openMeteoProvider({ fetch: refusing }).recent(99, 0, today)).rejects.toThrow(
      /Latitude must be in range/,
    );
  });
});

/** Weather for the demo portfolio's farms, synced through the weather-sync function's code. */
describe('weather per farm', () => {
  let db: PGlite;
  let manager: string;
  let investor: string;
  let cycleId: string;

  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows[0];
  const as = async <T>(user: string, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (tx: Tx) => (await tx.query<T>(sql, params)).rows);
  const store: WeatherStore = {
    cellsToSync: () =>
      asService(db, async (tx) => {
        const { rows } = await tx.query<{
          id: string;
          lat: string;
          lon: string;
          needs_normals: boolean;
        }>(`select * from public.weather_cells_to_sync()`);
        return rows.map((r) => ({ ...r, lat: Number(r.lat), lon: Number(r.lon) }));
      }),
    record: (cellId, provider, days, normals, error) =>
      asService(db, async (tx) => {
        await tx.query(`select public.record_weather($1, $2, $3, $4, $5)`, [
          cellId,
          provider,
          days && JSON.stringify(days),
          normals && JSON.stringify(normals),
          error,
        ]);
      }),
  };
  const provider = openMeteoProvider({ fetch: fakeOpenMeteo });

  beforeAll(async () => {
    db = await createDb();
    const pdf = readFileSync(
      join(import.meta.dirname, '..', '..', 'docs', 'demo', 'sample-offtake-agreement.pdf'),
    );
    await seedDemo(pgliteApi(db), { password: 'unused', offtakePdf: pdf, insurancePdf: pdf });
    const id = async (email: string) =>
      (await one<{ id: string }>(`select id from public.profiles where email = $1`, [email])).id;
    manager = await id('manager@agrowth.test');
    investor = await id('investor@agrowth.test');
    cycleId = (
      await one<{ id: string }>(`select id from public.cycles where status = 'in_progress' limit 1`)
    ).id;
  }, 300_000);

  it('syncs one cell per 0.1° square with farms in live cycles, then waits before syncing again', async () => {
    const result = await syncWeather(provider, store, { today });
    expect(result.failed).toEqual([]);
    expect(result.updated).toBeGreaterThan(0);
    expect(result.updated).toBe(result.cells);
    // Settled and draft cycles' farms aren't watched; every live cycle's farms are.
    const uncovered = await one<{ n: number }>(
      `select count(*)::int as n from public.cycle_farms cf
         join public.cycles c on c.id = cf.cycle_id join public.farms f on f.id = cf.farm_id
        where c.status in ('open_for_funding', 'funded', 'in_progress', 'harvested', 'pending_approval')
          and not exists (select 1 from public.weather_cells wc
                           where wc.lat = round(extensions.st_y(f.centroid)::numeric, 1)
                             and wc.lon = round(extensions.st_x(f.centroid)::numeric, 1)
                             and wc.synced_at is not null)`,
    );
    expect(uncovered.n).toBe(0);
    expect(await store.cellsToSync()).toEqual([]);
  });

  it('keeps observations when a later forecast arrives for the same day', async () => {
    const { cell_id } = await one<{ cell_id: string }>(
      `select cell_id from public.weather_daily limit 1`,
    );
    const yesterday = addDays(today, -1);
    await store.record(
      cell_id,
      'open-meteo',
      [{ day: yesterday, rain_mm: 99, tmax_c: 30, tmin_c: 20, forecast: true }],
      null,
      null,
    );
    const row = await one<{ rain_mm: string }>(
      `select rain_mm from public.weather_daily where cell_id = $1 and day = $2`,
      [cell_id, yesterday],
    );
    expect(Number(row.rain_mm)).toBe(1);
  });

  it('shows a cycle its season, its last 30 days against normal, and what to watch', async () => {
    const [{ w }] = await as<{ w: { today: string; cells: Record<string, any>[] } }>(
      manager,
      `select public.cycle_weather($1) as w`,
      [cycleId],
    );
    expect(w.today).toBe(today);
    const cell = w.cells[0];
    expect(cell.farms).toBeGreaterThan(0);
    expect(cell.last30).toEqual({ rain_mm: 30, normal_mm: 150 });
    expect(cell.days.at(-1)).toMatchObject({ day: addDays(today, 7), forecast: true });
    expect(cell.days[0].normal_mm).toBe(5);
    expect(cell.flags.map((f: { kind: string }) => f.kind)).toEqual(['dry', 'heavy_rain', 'heat']);
    expect(cell.flags[0].message).toBe(
      'Dry spell: 30 mm of rain in the last 30 days, 20% of the usual 150 mm',
    );
    expect(cell.flags[1].message).toMatch(/^Heavy rain forecast: 60 mm on /);
  });

  it('lists live cycles with weather to watch on the overview', async () => {
    const alerts = await as<{ cycle_id: string; flags: { kind: string }[] }>(
      manager,
      `select * from public.weather_alerts()`,
    );
    expect(alerts.map((a) => a.cycle_id)).toContain(cycleId);
    expect(alerts[0].flags.map((f) => f.kind).sort()).toEqual(['dry', 'heat', 'heavy_rain']);
  });

  it('flags weather that has gone stale', async () => {
    await db.query(`update public.weather_cells set synced_at = now() - interval '3 days'`);
    const [{ w }] = await as<{ w: { cells: { flags: { kind: string }[] }[] } }>(
      manager,
      `select public.cycle_weather($1) as w`,
      [cycleId],
    );
    expect(w.cells[0].flags.map((f) => f.kind)).toContain('stale');
    expect((await store.cellsToSync()).length).toBeGreaterThan(0);
  });

  it('lets only the weather service write, and only staff read', async () => {
    const { id } = await one<{ id: string }>(`select id from public.weather_cells limit 1`);
    expect((await pgError(as(manager, `select public.record_weather($1, 'x')`, [id]))).code).toBe(
      '42501',
    );
    expect((await pgError(as(manager, `select * from public.weather_cells_to_sync()`))).code).toBe(
      '42501',
    );
    expect((await pgError(as(investor, `select public.cycle_weather($1)`, [cycleId]))).code).toBe(
      'PT403',
    );
    expect(await as(investor, `select 1 from public.weather_daily limit 1`)).toHaveLength(0);
    expect(await as(manager, `select public.may_refresh_weather() as ok`)).toEqual([{ ok: true }]);
    expect(await as(investor, `select public.may_refresh_weather() as ok`)).toEqual([
      { ok: false },
    ]);
  });
});
