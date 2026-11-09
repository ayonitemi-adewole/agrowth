-- =============================================================================
-- Agrowth 2.0 — weather per farm
--
-- Rainfall and temperatures for every farm in a live cycle, from a weather provider
-- (Open-Meteo), so cycle managers, compliance and insurers can see how the season is going
-- between field visits, and a claim has objective weather behind it.
--
--   * Farms are grouped into weather cells: 0.1° grid squares (about 11 km), the scale
--     the weather models work at. Farms in the same cell share its weather.
--   * The weather-sync Edge Function (daily, and on demand) asks the provider for each
--     cell's last three months and coming week, and once for its normals: the average
--     rainfall of each day of the year over the past ten years.
--   * Only the service role writes weather. Everyone who can read cycles can read it.
--   * Flags are worked out here, from the stored data: a dry spell or a very wet month
--     against the normal, heavy rain or heat in the forecast, and data gone stale.
--
-- Readings are kept, not overwritten once observed, so the record of a season stays.
-- =============================================================================

create table public.weather_cells (
  id uuid primary key default gen_random_uuid(),
  lat numeric(4, 1) not null check (lat between -90 and 90),
  lon numeric(4, 1) not null check (lon between -180 and 180),
  provider varchar(40),
  synced_at timestamptz,
  normals_years int,
  last_error varchar(300),
  created_at timestamptz not null default now(),
  unique (lat, lon)
);

create table public.weather_daily (
  cell_id uuid not null references public.weather_cells (id) on delete cascade,
  day date not null,
  rain_mm numeric(6, 1) check (rain_mm >= 0),
  tmax_c numeric(4, 1),
  tmin_c numeric(4, 1),
  is_forecast boolean not null,
  fetched_at timestamptz not null default now(),
  primary key (cell_id, day)
);

create table public.weather_normals (
  cell_id uuid not null references public.weather_cells (id) on delete cascade,
  month_day char(5) not null check (month_day ~ '^[01][0-9]-[0-3][0-9]$'),
  rain_mm numeric(6, 2) not null check (rain_mm >= 0),
  primary key (cell_id, month_day)
);

do $$
declare
  t text;
begin
  foreach t in array array['weather_cells', 'weather_daily', 'weather_normals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated
                      using ((select public.is_cycle_reader()))', t || '_read', t);
  end loop;
end $$;

/** The weather cell a point falls in: its coordinates rounded to 0.1°. */
create function private.cell_key(p_point extensions.geometry) returns table (lat numeric, lon numeric)
language sql immutable set search_path = '' as $$
  select round(extensions.st_y(p_point)::numeric, 1), round(extensions.st_x(p_point)::numeric, 1)
$$;

/** Cycles whose farms are worth watching the weather for. */
create function private.weather_live(p_status public.cycle_status) returns boolean
language sql immutable set search_path = '' as $$
  select p_status in ('pending_approval', 'open_for_funding', 'funded', 'in_progress', 'harvested')
$$;

/** Is the caller the service role (the weather-sync function, or a scheduled job)? */
create function private.is_service() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
         = 'service_role'
$$;

-- -----------------------------------------------------------------------------
-- Syncing (service role only)
-- -----------------------------------------------------------------------------

/** Who may ask for a refresh: the scheduled job, and staff who read cycles. */
create function public.may_refresh_weather() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_service() or public.is_cycle_reader()
$$;

/**
 * The cells to refresh: every cell with a farm in a live cycle (created as needed) not
 * refreshed in the last p_stale. needs_normals is true until its normals are stored.
 */
create function public.weather_cells_to_sync(p_stale interval default interval '3 hours')
returns table (id uuid, lat numeric, lon numeric, needs_normals boolean)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then
    raise exception 'Only the weather service can do this' using errcode = 'PT403';
  end if;
  insert into public.weather_cells (lat, lon)
  select distinct k.lat, k.lon
    from public.farms f
    join public.cycle_farms cf on cf.farm_id = f.id
    join public.cycles c on c.id = cf.cycle_id
    cross join lateral private.cell_key(f.centroid) k
   where private.weather_live(c.status)
  on conflict do nothing;

  return query
    select wc.id, wc.lat, wc.lon, wc.normals_years is null
      from public.weather_cells wc
     where exists (
             select 1 from public.farms f
               join public.cycle_farms cf on cf.farm_id = f.id
               join public.cycles c on c.id = cf.cycle_id
               cross join lateral private.cell_key(f.centroid) k
              where k.lat = wc.lat and k.lon = wc.lon and private.weather_live(c.status))
       and (wc.synced_at is null or wc.synced_at < now() - p_stale)
     order by wc.synced_at nulls first;
end $$;

/**
 * Stores what the provider returned for a cell. p_days is a JSON array of
 * { day, rain_mm, tmax_c, tmin_c, forecast }; p_normals is { rain_mm: { "MM-DD": mm }, years }.
 * A forecast never replaces an observation. With p_error, only the error is noted.
 */
create function public.record_weather(
  p_cell_id uuid,
  p_provider text,
  p_days jsonb default null,
  p_normals jsonb default null,
  p_error text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then
    raise exception 'Only the weather service can record weather' using errcode = 'PT403';
  end if;
  if not exists (select 1 from public.weather_cells where id = p_cell_id) then
    raise exception 'Weather cell not found' using errcode = 'PT404';
  end if;
  if p_error is not null then
    update public.weather_cells set last_error = left(p_error, 300) where id = p_cell_id;
    return;
  end if;

  insert into public.weather_daily as w (cell_id, day, rain_mm, tmax_c, tmin_c, is_forecast)
  select p_cell_id, (d ->> 'day')::date,
         round((d ->> 'rain_mm')::numeric, 1), round((d ->> 'tmax_c')::numeric, 1),
         round((d ->> 'tmin_c')::numeric, 1), coalesce((d ->> 'forecast')::boolean, false)
    from jsonb_array_elements(coalesce(p_days, '[]')) d
  on conflict (cell_id, day) do update set
    rain_mm = excluded.rain_mm, tmax_c = excluded.tmax_c, tmin_c = excluded.tmin_c,
    is_forecast = excluded.is_forecast, fetched_at = now()
  where w.is_forecast or not excluded.is_forecast;

  if p_normals is not null then
    delete from public.weather_normals where cell_id = p_cell_id;
    insert into public.weather_normals (cell_id, month_day, rain_mm)
    select p_cell_id, e.key, round(e.value::numeric, 2)
      from jsonb_each_text(p_normals -> 'rain_mm') e;
    update public.weather_cells set normals_years = (p_normals ->> 'years')::int
     where id = p_cell_id;
  end if;

  update public.weather_cells
     set provider = left(p_provider, 40), synced_at = now(), last_error = null
   where id = p_cell_id;
end $$;

-- -----------------------------------------------------------------------------
-- Reading: a cycle's weather, and the flags
-- -----------------------------------------------------------------------------

/** Normal rainfall over a run of days. Null when the cell has no normals yet. */
create function private.normal_rain(p_cell_id uuid, p_from date, p_to date) returns numeric
language sql stable set search_path = '' as $$
  select case when exists (select 1 from public.weather_normals where cell_id = p_cell_id)
    then (select coalesce(sum(n.rain_mm), 0)
            from generate_series(p_from, p_to, interval '1 day') g
            join public.weather_normals n
              on n.cell_id = p_cell_id and n.month_day = to_char(g, 'MM-DD'))
  end
$$;

/** Nigerian date today. */
create function private.lagos_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Africa/Lagos')::date
$$;

/**
 * What to watch in a cell's weather, as [{ kind, message }]:
 *   dry        last 30 days under half the normal (where the normal is at least 30 mm)
 *   wet        last 30 days at least double the normal and at least 150 mm
 *   heavy_rain a forecast day of 50 mm or more
 *   heat       a forecast high of 40 °C or more
 *   stale      not refreshed for more than two days
 */
create function private.weather_flags(p_cell_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  today date := private.lagos_today();
  rain numeric;
  normal numeric;
  observed int;
  flags jsonb := '[]';
  r record;
  synced timestamptz;
begin
  select coalesce(sum(rain_mm), 0), count(*) into rain, observed
    from public.weather_daily
   where cell_id = p_cell_id and not is_forecast and day between today - 30 and today - 1;
  normal := private.normal_rain(p_cell_id, today - 30, today - 1);
  if observed >= 25 and normal is not null then
    if normal >= 30 and rain < normal * 0.5 then
      flags := flags || jsonb_build_object('kind', 'dry', 'message',
        format('Dry spell: %s mm of rain in the last 30 days, %s%% of the usual %s mm',
               round(rain), round(rain * 100 / normal), round(normal)));
    elsif rain >= greatest(normal * 2, 150) then
      flags := flags || jsonb_build_object('kind', 'wet', 'message',
        format('Very wet: %s mm of rain in the last 30 days, against a usual %s mm',
               round(rain), round(normal)));
    end if;
  end if;

  select day, rain_mm into r from public.weather_daily
   where cell_id = p_cell_id and is_forecast and day >= today and rain_mm >= 50
   order by rain_mm desc limit 1;
  if found then
    flags := flags || jsonb_build_object('kind', 'heavy_rain', 'message',
      format('Heavy rain forecast: %s mm on %s', round(r.rain_mm), to_char(r.day, 'Dy DD Mon')));
  end if;
  select day, tmax_c into r from public.weather_daily
   where cell_id = p_cell_id and is_forecast and day >= today and tmax_c >= 40
   order by tmax_c desc limit 1;
  if found then
    flags := flags || jsonb_build_object('kind', 'heat', 'message',
      format('Heat: up to %s °C forecast on %s', round(r.tmax_c), to_char(r.day, 'Dy DD Mon')));
  end if;

  select synced_at into synced from public.weather_cells where id = p_cell_id;
  if synced is not null and synced < now() - interval '2 days' then
    flags := flags || jsonb_build_object('kind', 'stale', 'message',
      format('Weather last updated %s days ago', extract(day from now() - synced)::int));
  end if;
  return flags;
end $$;

/**
 * A cycle's weather, by cell: its farms, the season so far and the last 30 days against
 * normal, the last 60 days and the coming week day by day, and the flags. Cells with no
 * data yet are listed with empty days, so the page can say so.
 */
create function public.cycle_weather(p_cycle_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.cycles;
  today date := private.lagos_today();
  season_from date;
  season_to date;
  result jsonb := '[]';
  cell record;
begin
  if not public.is_cycle_reader() then
    raise exception 'Your role cannot see cycles' using errcode = 'PT403';
  end if;
  select * into c from public.cycles where id = p_cycle_id;
  if not found then
    raise exception 'Cycle not found' using errcode = 'PT404';
  end if;
  season_from := c.start_date;
  season_to := least(today - 1, coalesce(c.expected_harvest_date, today - 1));

  for cell in
    select k.lat, k.lon, wc.id, wc.synced_at, wc.provider, wc.normals_years, wc.last_error,
           count(*) as farms, sum(f.area_hectares) as hectares
      from public.cycle_farms cf
      join public.farms f on f.id = cf.farm_id
      cross join lateral private.cell_key(f.centroid) k
      left join public.weather_cells wc on wc.lat = k.lat and wc.lon = k.lon
     where cf.cycle_id = p_cycle_id
     group by k.lat, k.lon, wc.id
     order by count(*) desc
  loop
    result := result || jsonb_build_object(
      'lat', cell.lat, 'lon', cell.lon, 'farms', cell.farms, 'hectares', cell.hectares,
      'synced_at', cell.synced_at, 'provider', cell.provider,
      'normals_years', cell.normals_years, 'last_error', cell.last_error,
      'season', case when cell.id is not null and season_from is not null
                          and season_from <= season_to then jsonb_build_object(
        'from', season_from, 'to', season_to,
        'rain_mm', (select coalesce(sum(rain_mm), 0) from public.weather_daily
                     where cell_id = cell.id and not is_forecast
                       and day between season_from and season_to),
        'days_with_data', (select count(*) from public.weather_daily
                            where cell_id = cell.id and not is_forecast
                              and day between season_from and season_to),
        'normal_mm', private.normal_rain(cell.id, season_from, season_to)) end,
      'last30', case when cell.id is not null then jsonb_build_object(
        'rain_mm', (select coalesce(sum(rain_mm), 0) from public.weather_daily
                     where cell_id = cell.id and not is_forecast
                       and day between today - 30 and today - 1),
        'normal_mm', private.normal_rain(cell.id, today - 30, today - 1)) end,
      'days', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'day', w.day, 'rain_mm', w.rain_mm, 'tmax_c', w.tmax_c, 'tmin_c', w.tmin_c,
                 'forecast', w.is_forecast,
                 'normal_mm', (select n.rain_mm from public.weather_normals n
                                where n.cell_id = cell.id and n.month_day = to_char(w.day, 'MM-DD')))
                 order by w.day)
          from public.weather_daily w
         where w.cell_id = cell.id and w.day between today - 60 and today + 7), '[]'),
      'flags', case when cell.id is not null then private.weather_flags(cell.id) else '[]' end);
  end loop;

  return jsonb_build_object('today', today, 'cells', result);
end $$;

/** Live cycles with a weather flag on any of their farms, for the overview. */
create function public.weather_alerts()
returns table (cycle_id uuid, code text, crop text, status public.cycle_status, flags jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_cycle_reader() then
    raise exception 'Your role cannot see cycles' using errcode = 'PT403';
  end if;
  return query
    with cells as (
      select distinct c.id as cycle_id, wc.id as cell_id
        from public.cycles c
        join public.cycle_farms cf on cf.cycle_id = c.id
        join public.farms f on f.id = cf.farm_id
        cross join lateral private.cell_key(f.centroid) k
        join public.weather_cells wc on wc.lat = k.lat and wc.lon = k.lon
       where private.weather_live(c.status)
    ),
    flagged as (
      select x.cycle_id, fl
        from cells x
        cross join lateral jsonb_array_elements(private.weather_flags(x.cell_id)) fl
       where fl ->> 'kind' <> 'stale'
    )
    select c.id, c.code::text, c.crop::text, c.status,
           (select jsonb_agg(distinct f.fl) from flagged f where f.cycle_id = c.id)
      from public.cycles c
     where exists (select 1 from flagged f where f.cycle_id = c.id)
     order by c.code;
end $$;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function
  public.weather_cells_to_sync(interval),
  public.record_weather(uuid, text, jsonb, jsonb, text)
from authenticated;
grant execute on function
  public.weather_cells_to_sync(interval),
  public.record_weather(uuid, text, jsonb, jsonb, text)
to service_role;
grant execute on function
  public.may_refresh_weather(),
  public.cycle_weather(uuid),
  public.weather_alerts()
to authenticated;
