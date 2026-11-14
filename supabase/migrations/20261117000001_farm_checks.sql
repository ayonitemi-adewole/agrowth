-- =============================================================================
-- Agrowth 2.0 — routine farm checks, and photos of the farmer and the farm
--
--   1. Routine farm checks. Once a cycle has begun, a field agent visits every farm
--      in it every N days (the cycle's monitoring_interval_days) to record how the
--      farm is doing. These checks are separate from milestones: they never hold
--      back or release money. farm_check_schedule shows which farm is due next.
--
--   2. Photos as evidence that the agent saw the farmer and the farm:
--        * enrolling a farmer needs a portrait of the farmer;
--        * mapping a farm needs at least one photo of the farm's condition;
--        * every field visit (routine check or milestone verification) needs a
--          portrait of the farmer and at least one photo of the farm.
--      A milestone visit without a portrait no longer passes.
--
-- Farmers and farms already in the registry keep working without photos; the
-- requirement applies to new enrolments, new farms and new visits.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Registry photos: farmer portraits and farm photos taken at enrolment
-- -----------------------------------------------------------------------------

-- Path convention: <id of the agent who took it>/<file name>. The farmer doesn't exist
-- yet when the portrait is uploaded, so the path is keyed by the agent instead.
insert into storage.buckets (id, name, public)
values ('registry-photos', 'registry-photos', false)
on conflict (id) do nothing;

create policy registry_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'registry-photos' and (select public.is_registry_reader()));
create policy registry_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'registry-photos' and (select public.is_enroller())
              and split_part(name, '/', 1) = (select auth.uid())::text);

/** A registry photo path this agent uploaded: "<their id>/<file name>". */
create function private.own_registry_photo(p_path text) returns boolean
language sql stable set search_path = '' as $$
  select p_path is not null
     and split_part(p_path, '/', 1) = auth.uid()::text
     and length(split_part(p_path, '/', 2)) > 0
     and length(p_path) <= 300
$$;

alter table public.farmers
  add column portrait_path text check (length(portrait_path) <= 300);

alter table public.farms
  add column photo_paths text[] not null default '{}';

-- farm_maps lists its columns, so it's rebuilt to include the farm photos.
create or replace view public.farm_maps with (security_invoker = true) as
select
  f.id,
  f.farmer_id,
  f.name,
  f.area_hectares,
  f.primary_crop,
  f.tenure_type,
  f.tenure_document_url,
  f.soil_notes,
  extensions.st_asgeojson(f.boundary)::jsonb as boundary,
  extensions.st_x(f.centroid) as centroid_lon,
  extensions.st_y(f.centroid) as centroid_lat,
  fr.cooperative_id,
  f.created_at,
  f.updated_at,
  f.photo_paths
from public.farms f
join public.farmers fr on fr.id = f.farmer_id;

-- -----------------------------------------------------------------------------
-- Enrolment now needs a portrait
-- -----------------------------------------------------------------------------

drop function public.register_farmer(
  text, text, text, text, text, text, text, public.gender, date, text, text, uuid);

/**
 * Enrols a farmer and returns their id. At least one national identifier is required,
 * so the registry can guarantee one record per person, and a portrait the agent took
 * (uploaded to "registry-photos" under their own id).
 * A repeat enrolment fails with HTTP 409; the error's "details" holds the existing id.
 */
create function public.register_farmer(
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_state text,
  p_lga text,
  p_nin text default null,
  p_bvn text default null,
  p_gender public.gender default null,
  p_date_of_birth date default null,
  p_ward text default null,
  p_photo_url text default null,
  p_cooperative_id uuid default null,
  p_portrait_path text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  nin text := nullif(regexp_replace(coalesce(p_nin, ''), '[\s-]', '', 'g'), '');
  bvn text := nullif(regexp_replace(coalesce(p_bvn, ''), '[\s-]', '', 'g'), '');
  nin_h text;
  bvn_h text;
  existing uuid;
  new_id uuid;
begin
  if not public.is_enroller() then
    raise exception 'Your role cannot enrol farmers' using errcode = 'PT403';
  end if;
  if nin is null and bvn is null then
    raise exception 'Provide a NIN or BVN so the farmer can be deduplicated' using errcode = 'PT400';
  end if;
  if nin is not null and nin !~ '^[0-9]{11}$' then
    raise exception 'NIN must be 11 digits' using errcode = 'PT400';
  end if;
  if bvn is not null and bvn !~ '^[0-9]{11}$' then
    raise exception 'BVN must be 11 digits' using errcode = 'PT400';
  end if;
  if nullif(trim(p_portrait_path), '') is null then
    raise exception 'Take a portrait of the farmer to enrol them' using errcode = 'PT400';
  end if;
  if not private.own_registry_photo(trim(p_portrait_path)) then
    raise exception 'The portrait must be one you uploaded' using errcode = 'PT400';
  end if;
  if p_cooperative_id is not null
     and not exists (select 1 from public.cooperatives where id = p_cooperative_id) then
    raise exception 'Cooperative not found' using errcode = 'PT404';
  end if;

  nin_h := case when nin is not null then private.hash_identifier(nin) end;
  bvn_h := case when bvn is not null then private.hash_identifier(bvn) end;

  select farmer_id into existing from private.farmer_identities
   where nin_hash = nin_h or bvn_hash = bvn_h
   limit 1;
  if existing is not null then
    raise exception 'A farmer with this NIN or BVN is already enrolled'
      using errcode = 'PT409', detail = existing::text;
  end if;

  insert into public.farmers (
    first_name, last_name, phone, gender, date_of_birth, nin_last4, bvn_last4,
    state, lga, ward, photo_url, cooperative_id, registered_by, portrait_path
  ) values (
    trim(p_first_name), trim(p_last_name), trim(p_phone), p_gender, p_date_of_birth,
    right(nin, 4), right(bvn, 4),
    trim(p_state), trim(p_lga), nullif(trim(p_ward), ''), nullif(trim(p_photo_url), ''),
    p_cooperative_id, auth.uid(), trim(p_portrait_path)
  ) returning id into new_id;

  -- If two agents enrol the same person at the same moment, the unique index decides.
  insert into private.farmer_identities (farmer_id, nin_hash, bvn_hash)
  values (new_id, nin_h, bvn_h);

  return new_id;
end $$;

revoke execute on function public.register_farmer(
  text, text, text, text, text, text, text, public.gender, date, text, text, uuid, text)
  from public, anon;
grant execute on function public.register_farmer(
  text, text, text, text, text, text, text, public.gender, date, text, text, uuid, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Mapping a farm now needs a photo of its condition
-- -----------------------------------------------------------------------------

drop function public.map_farm(uuid, jsonb, text, text, public.tenure_type, text, text);

create function public.map_farm(
  p_farmer_id uuid,
  p_boundary jsonb,
  p_name text default null,
  p_primary_crop text default null,
  p_tenure_type public.tenure_type default 'other',
  p_tenure_document_url text default null,
  p_soil_notes text default null,
  p_photo_paths text[] default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  g extensions.geometry;
  new_id uuid;
  photo text;
begin
  if not public.is_enroller() then
    raise exception 'Your role cannot map farms' using errcode = 'PT403';
  end if;
  if not exists (select 1 from public.farmers where id = p_farmer_id) then
    raise exception 'Farmer not found' using errcode = 'PT404';
  end if;
  if coalesce(cardinality(p_photo_paths), 0) = 0 then
    raise exception 'Take at least one photo of the farm''s condition' using errcode = 'PT400';
  end if;
  if cardinality(p_photo_paths) > 6 then
    raise exception 'At most 6 photos of the farm' using errcode = 'PT400';
  end if;
  foreach photo in array p_photo_paths loop
    if not private.own_registry_photo(photo) then
      raise exception 'Every farm photo must be one you uploaded' using errcode = 'PT400';
    end if;
  end loop;
  g := private.parse_farm_boundary(p_boundary);
  perform private.lock_farm_mapping();
  perform private.assert_no_overlap(g, null);

  insert into public.farms (
    farmer_id, boundary, name, primary_crop, tenure_type, tenure_document_url, soil_notes,
    photo_paths
  ) values (
    p_farmer_id, g, nullif(trim(p_name), ''), p_primary_crop, coalesce(p_tenure_type, 'other'),
    nullif(trim(p_tenure_document_url), ''), nullif(trim(p_soil_notes), ''), p_photo_paths
  ) returning id into new_id;
  return new_id;
end $$;

revoke execute on function public.map_farm(
  uuid, jsonb, text, text, public.tenure_type, text, text, text[]) from public, anon;
grant execute on function public.map_farm(
  uuid, jsonb, text, text, public.tenure_type, text, text, text[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Milestone visits now need a portrait of the farmer too
-- -----------------------------------------------------------------------------

alter table public.field_visits
  add column portrait_path text check (length(portrait_path) <= 300);

drop view public.field_visit_evidence;
create view public.field_visit_evidence with (security_invoker = true) as
select
  v.id,
  v.farm_id,
  v.milestone_id,
  v.agent_id,
  v.visited_at,
  extensions.st_x(v.location) as lon,
  extensions.st_y(v.location) as lat,
  v.gps_accuracy_m,
  v.distance_from_boundary_m,
  v.gps_ok,
  v.checklist_passed,
  v.crop_condition,
  v.notes,
  v.photo_paths,
  v.passed,
  v.created_at,
  v.portrait_path
from public.field_visits v;

revoke all on public.field_visit_evidence from anon, authenticated;
grant select on public.field_visit_evidence to authenticated;

drop function public.record_field_visit(
  uuid, uuid, float8, float8, numeric, public.crop_condition, boolean, text[], text, timestamptz, uuid);

/**
 * Records an agent's visit for a milestone. The database decides whether it passes:
 * the GPS fix must be precise and inside (or within a few metres of) the boundary,
 * the checklist must pass, the crop must not have failed, and there must be a portrait
 * of the farmer and at least one photo of the farm.
 * p_client_ref makes it safe to send the same visit again.
 */
create function public.record_field_visit(
  p_farm_id uuid,
  p_milestone_id uuid,
  p_lon float8,
  p_lat float8,
  p_gps_accuracy_m numeric,
  p_crop_condition public.crop_condition,
  p_checklist_passed boolean,
  p_photo_paths text[],
  p_notes text default null,
  p_visited_at timestamptz default now(),
  p_client_ref uuid default null,
  p_portrait_path text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.milestones;
  existing public.field_visits;
  point extensions.geometry;
  distance numeric;
  gps_ok boolean;
  passed boolean;
  portrait text := nullif(trim(p_portrait_path), '');
  new_id uuid;
  status_now public.milestone_status;
begin
  if not public.is_enroller() then
    raise exception 'Only field agents can record visits' using errcode = 'PT403';
  end if;

  -- Already received: answer as the first time, without recording it again.
  if p_client_ref is not null then
    select * into existing from public.field_visits where client_ref = p_client_ref;
    if found then
      if existing.agent_id <> auth.uid() then
        raise exception 'This visit reference belongs to another agent' using errcode = 'PT409';
      end if;
      return jsonb_build_object(
        'visit_id', existing.id, 'passed', existing.passed, 'gps_ok', existing.gps_ok,
        'distance_from_boundary_m', existing.distance_from_boundary_m,
        'milestone_status', (select status from public.milestones where id = existing.milestone_id),
        'has_portrait', existing.portrait_path is not null,
        'duplicate', true);
    end if;
  end if;

  select * into m from public.milestones where id = p_milestone_id;
  if not found then
    raise exception 'Milestone not found' using errcode = 'PT404';
  end if;
  if m.status not in ('awaiting_verification', 'blocked') then
    raise exception 'This milestone is not awaiting verification (it is %)', m.status
      using errcode = 'PT409';
  end if;
  if not exists (select 1 from public.cycle_farms where cycle_id = m.cycle_id and farm_id = p_farm_id) then
    raise exception 'This farm is not part of the milestone''s cycle' using errcode = 'PT400';
  end if;
  if p_visited_at > now() + interval '5 minutes' then
    raise exception 'A visit cannot be dated in the future' using errcode = 'PT400';
  end if;
  if p_visited_at < m.verification_requested_at then
    raise exception 'This visit happened before verification was requested' using errcode = 'PT400';
  end if;
  if p_lon is null or p_lat is null or p_lon not between -180 and 180 or p_lat not between -90 and 90 then
    raise exception 'A valid GPS position is required' using errcode = 'PT400';
  end if;
  if p_gps_accuracy_m is null or p_gps_accuracy_m < 0 then
    raise exception 'GPS accuracy is required' using errcode = 'PT400';
  end if;

  point := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326);
  select round(extensions.st_distance(f.boundary::extensions.geography, point::extensions.geography)::numeric, 1)
    into distance
    from public.farms f where f.id = p_farm_id;

  gps_ok := p_gps_accuracy_m <= private.max_checkin_metres() and distance <= private.max_checkin_metres();
  passed := gps_ok and p_checklist_passed and p_crop_condition <> 'failed'
            and coalesce(array_length(p_photo_paths, 1), 0) > 0
            and portrait is not null;

  insert into public.field_visits (
    farm_id, milestone_id, agent_id, visited_at, location, gps_accuracy_m,
    distance_from_boundary_m, gps_ok, checklist_passed, crop_condition, notes, photo_paths, passed,
    client_ref, portrait_path
  ) values (
    p_farm_id, p_milestone_id, auth.uid(), p_visited_at, point, p_gps_accuracy_m, distance, gps_ok,
    p_checklist_passed, p_crop_condition, nullif(trim(p_notes), ''), coalesce(p_photo_paths, '{}'), passed,
    p_client_ref, portrait
  ) returning id into new_id;

  status_now := private.evaluate_milestone(p_milestone_id);
  return jsonb_build_object(
    'visit_id', new_id, 'passed', passed, 'gps_ok', gps_ok,
    'distance_from_boundary_m', distance, 'milestone_status', status_now,
    'has_portrait', portrait is not null, 'duplicate', false);
end $$;

revoke execute on function public.record_field_visit(
  uuid, uuid, float8, float8, numeric, public.crop_condition, boolean, text[], text, timestamptz, uuid, text)
  from public, anon;
grant execute on function public.record_field_visit(
  uuid, uuid, float8, float8, numeric, public.crop_condition, boolean, text[], text, timestamptz, uuid, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Routine farm checks
-- -----------------------------------------------------------------------------

alter table public.cycles
  add column monitoring_interval_days smallint not null default 14
    check (monitoring_interval_days between 1 and 90);

-- Set with the rest of a draft; after approval, through set_monitoring_interval.
grant insert (monitoring_interval_days), update (monitoring_interval_days)
   on public.cycles to authenticated;

/**
 * The day routine checks start: the season's start date, or the first release if
 * money went out before it. Null while the cycle hasn't been funded.
 */
create function private.monitoring_starts_on(p_cycle_id uuid) returns date
language sql stable security definer set search_path = '' as $$
  select case when c.status in ('funded', 'in_progress', 'harvested', 'settled') then
           coalesce(
             least(c.start_date,
                   (select min(d.instructed_at at time zone 'Africa/Lagos')::date
                      from public.disbursements d
                     where d.cycle_id = c.id and d.status <> 'cancelled')),
             (c.approved_at at time zone 'Africa/Lagos')::date)
         end
    from public.cycles c
   where c.id = p_cycle_id
$$;

/** Changes how often a running cycle's farms are checked. Managers only; logged. */
create function public.set_monitoring_interval(p_cycle_id uuid, p_days int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cycles;
begin
  if not public.is_cycle_manager() then
    raise exception 'Only cycle or programme managers can set the check interval' using errcode = 'PT403';
  end if;
  select * into c from public.cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'Cycle not found' using errcode = 'PT404';
  end if;
  if c.status in ('harvested', 'settled', 'cancelled', 'refunded') then
    raise exception 'Farm checks have ended for this cycle (it is %)', c.status using errcode = 'PT409';
  end if;
  if p_days is null or p_days not between 1 and 90 then
    raise exception 'The check interval must be between 1 and 90 days' using errcode = 'PT400';
  end if;
  if p_days = c.monitoring_interval_days then
    return;
  end if;
  update public.cycles set monitoring_interval_days = p_days where id = p_cycle_id;
  perform private.log_cycle_event(p_cycle_id, 'monitoring_interval',
    format('Farm checks: every %s days (was every %s)', p_days, c.monitoring_interval_days),
    jsonb_build_object('days', p_days, 'was', c.monitoring_interval_days));
end $$;

revoke execute on function public.set_monitoring_interval(uuid, int) from public, anon;
grant execute on function public.set_monitoring_interval(uuid, int) to authenticated;

/** A routine check of a farm during a cycle. Evidence: never edited or deleted. */
create table public.farm_checks (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycles (id) on delete restrict,
  farm_id uuid not null references public.farms (id) on delete restrict,
  agent_id uuid not null references public.profiles (id) on delete restrict,
  -- When the agent was at the farm (the app may sync later, after working offline).
  visited_at timestamptz not null,
  location extensions.geometry(Point, 4326) not null,
  gps_accuracy_m numeric(8, 1) not null check (gps_accuracy_m >= 0),
  -- Computed by the database from the farm boundary.
  distance_from_boundary_m numeric(10, 1) not null,
  -- Only checks made at the farm count towards the schedule.
  gps_ok boolean not null,
  crop_condition public.crop_condition not null,
  notes text check (length(notes) <= 5000),
  -- In "field-photos", under checks/<cycle id>/<farm id>/.
  portrait_path text not null check (length(portrait_path) between 1 and 300),
  photo_paths text[] not null check (cardinality(photo_paths) between 1 and 6),
  -- The phone's id for the check, so a resend after a dropped connection counts once.
  client_ref uuid unique,
  created_at timestamptz not null default now()
);
create index farm_checks_cycle_farm_idx on public.farm_checks (cycle_id, farm_id, visited_at desc);

create trigger farm_checks_append_only before update or delete on public.farm_checks
for each row execute function private.ledger_forbid_change();

alter table public.farm_checks enable row level security;
revoke all on public.farm_checks from anon, authenticated;
grant select on public.farm_checks to authenticated;
create policy farm_checks_read on public.farm_checks for select to authenticated
  using ((select public.is_cycle_reader()));

/** Checks with the check-in as plain coordinates, for a map. Respects the farm_checks policies. */
create view public.farm_check_evidence with (security_invoker = true) as
select
  k.id,
  k.cycle_id,
  k.farm_id,
  k.agent_id,
  k.visited_at,
  extensions.st_x(k.location) as lon,
  extensions.st_y(k.location) as lat,
  k.gps_accuracy_m,
  k.distance_from_boundary_m,
  k.gps_ok,
  k.crop_condition,
  k.notes,
  k.portrait_path,
  k.photo_paths,
  k.created_at
from public.farm_checks k;

revoke all on public.farm_check_evidence from anon, authenticated;
grant select on public.farm_check_evidence to authenticated;

/**
 * Every farm in a running cycle, with when its next routine check is due:
 * the interval after its last check made at the farm, or after the checks started.
 * (The start is worked out as in private.monitoring_starts_on; a security-invoker view
 * can't call private functions.)
 */
create view public.farm_check_schedule with (security_invoker = true) as
select
  c.id as cycle_id,
  cf.farm_id,
  c.monitoring_interval_days as interval_days,
  s.starts_on,
  last.visited_at as last_check_at,
  last.crop_condition as last_condition,
  coalesce(n.checks, 0) as checks,
  d.due as next_due_on,
  greatest(t.today - d.due, 0) as days_overdue
from public.cycles c
join public.cycle_farms cf on cf.cycle_id = c.id
cross join lateral (select (now() at time zone 'Africa/Lagos')::date as today) t
cross join lateral (
  select coalesce(
           least(c.start_date,
                 (select min(x.instructed_at at time zone 'Africa/Lagos')::date
                    from public.disbursements x
                   where x.cycle_id = c.id and x.status <> 'cancelled')),
           (c.approved_at at time zone 'Africa/Lagos')::date) as starts_on
) s
left join lateral (
  select k.visited_at, k.crop_condition from public.farm_checks k
   where k.cycle_id = c.id and k.farm_id = cf.farm_id and k.gps_ok
   order by k.visited_at desc
   limit 1
) last on true
left join lateral (
  select count(*) as checks from public.farm_checks k
   where k.cycle_id = c.id and k.farm_id = cf.farm_id
) n on true
cross join lateral (
  select coalesce((last.visited_at at time zone 'Africa/Lagos')::date, s.starts_on)
         + c.monitoring_interval_days as due
) d
where c.status in ('funded', 'in_progress')
  and s.starts_on <= t.today;

revoke all on public.farm_check_schedule from anon, authenticated;
grant select on public.farm_check_schedule to authenticated;

/**
 * Records a routine check of a farm. It needs a portrait of the farmer and at least one
 * photo of the farm. The check is kept whatever the GPS says, but only one made at the
 * farm (precise fix, within a few metres of the boundary) counts towards the schedule.
 * A crop reported poor or failed is logged in the cycle's history for the manager.
 * p_client_ref makes it safe to send the same check again.
 */
create function public.record_farm_check(
  p_cycle_id uuid,
  p_farm_id uuid,
  p_lon float8,
  p_lat float8,
  p_gps_accuracy_m numeric,
  p_crop_condition public.crop_condition,
  p_portrait_path text,
  p_photo_paths text[],
  p_notes text default null,
  p_visited_at timestamptz default now(),
  p_client_ref uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.cycles;
  existing public.farm_checks;
  starts_on date;
  point extensions.geometry;
  distance numeric;
  gps_ok boolean;
  portrait text := nullif(trim(p_portrait_path), '');
  photos text[] := array(select trim(x) from unnest(coalesce(p_photo_paths, '{}')) x where trim(x) <> '');
  new_id uuid;
  farm_label text;
begin
  if not public.is_enroller() then
    raise exception 'Only field agents can record farm checks' using errcode = 'PT403';
  end if;

  if p_client_ref is not null then
    select * into existing from public.farm_checks where client_ref = p_client_ref;
    if found then
      if existing.agent_id <> auth.uid() then
        raise exception 'This check reference belongs to another agent' using errcode = 'PT409';
      end if;
      return jsonb_build_object(
        'check_id', existing.id, 'gps_ok', existing.gps_ok,
        'distance_from_boundary_m', existing.distance_from_boundary_m,
        'next_due_on', (select s.next_due_on from public.farm_check_schedule s
                         where s.cycle_id = existing.cycle_id and s.farm_id = existing.farm_id),
        'duplicate', true);
    end if;
  end if;

  select * into c from public.cycles where id = p_cycle_id;
  if not found then
    raise exception 'Cycle not found' using errcode = 'PT404';
  end if;
  if c.status not in ('funded', 'in_progress') then
    raise exception 'Farm checks run while a cycle is under way (this one is %)', c.status
      using errcode = 'PT409';
  end if;
  starts_on := private.monitoring_starts_on(p_cycle_id);
  if starts_on is null or (p_visited_at at time zone 'Africa/Lagos')::date < starts_on then
    raise exception 'Farm checks start when the season does (%)', to_char(starts_on, 'DD Mon YYYY')
      using errcode = 'PT409';
  end if;
  if not exists (select 1 from public.cycle_farms where cycle_id = p_cycle_id and farm_id = p_farm_id) then
    raise exception 'This farm is not part of the cycle' using errcode = 'PT400';
  end if;
  if p_visited_at > now() + interval '5 minutes' then
    raise exception 'A check cannot be dated in the future' using errcode = 'PT400';
  end if;
  if p_lon is null or p_lat is null or p_lon not between -180 and 180 or p_lat not between -90 and 90 then
    raise exception 'A valid GPS position is required' using errcode = 'PT400';
  end if;
  if p_gps_accuracy_m is null or p_gps_accuracy_m < 0 then
    raise exception 'GPS accuracy is required' using errcode = 'PT400';
  end if;
  if p_crop_condition is null then
    raise exception 'Record the crop''s condition' using errcode = 'PT400';
  end if;
  if portrait is null then
    raise exception 'Take a portrait of the farmer' using errcode = 'PT400';
  end if;
  if cardinality(photos) = 0 then
    raise exception 'Take at least one photo of the farm' using errcode = 'PT400';
  end if;
  if cardinality(photos) > 6 then
    raise exception 'At most 6 photos of the farm' using errcode = 'PT400';
  end if;

  point := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326);
  select round(extensions.st_distance(f.boundary::extensions.geography, point::extensions.geography)::numeric, 1),
         coalesce(f.name, 'Farm') || ' (' || fr.full_name || ')'
    into distance, farm_label
    from public.farms f join public.farmers fr on fr.id = f.farmer_id
   where f.id = p_farm_id;
  gps_ok := p_gps_accuracy_m <= private.max_checkin_metres() and distance <= private.max_checkin_metres();

  insert into public.farm_checks (
    cycle_id, farm_id, agent_id, visited_at, location, gps_accuracy_m, distance_from_boundary_m,
    gps_ok, crop_condition, notes, portrait_path, photo_paths, client_ref
  ) values (
    p_cycle_id, p_farm_id, auth.uid(), p_visited_at, point, p_gps_accuracy_m, distance,
    gps_ok, p_crop_condition, nullif(trim(p_notes), ''), portrait, photos, p_client_ref
  ) returning id into new_id;

  if p_crop_condition in ('poor', 'failed') then
    perform private.log_cycle_event(p_cycle_id, 'farm_check_alert',
      format('Farm check: %s reported %s', farm_label,
        case p_crop_condition when 'failed' then 'the crop as lost' else 'serious issues' end),
      jsonb_build_object('check_id', new_id, 'farm_id', p_farm_id, 'condition', p_crop_condition));
  end if;

  return jsonb_build_object(
    'check_id', new_id, 'gps_ok', gps_ok, 'distance_from_boundary_m', distance,
    'next_due_on', (select s.next_due_on from public.farm_check_schedule s
                     where s.cycle_id = p_cycle_id and s.farm_id = p_farm_id),
    'duplicate', false);
end $$;

revoke execute on function public.record_farm_check(
  uuid, uuid, float8, float8, numeric, public.crop_condition, text, text[], text, timestamptz, uuid)
  from public, anon;
grant execute on function public.record_farm_check(
  uuid, uuid, float8, float8, numeric, public.crop_condition, text, text[], text, timestamptz, uuid)
  to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.register_farmer(
    text, text, text, text, text, text, text, public.gender, date, text, text, uuid, text),
  public.map_farm(uuid, jsonb, text, text, public.tenure_type, text, text, text[]),
  public.record_field_visit(
    uuid, uuid, float8, float8, numeric, public.crop_condition, boolean, text[], text,
    timestamptz, uuid, text),
  public.set_monitoring_interval(uuid, int),
  public.record_farm_check(
    uuid, uuid, float8, float8, numeric, public.crop_condition, text, text[], text,
    timestamptz, uuid)
to authenticated;
