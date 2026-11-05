-- =============================================================================
-- Agrowth 2.0 — registry: cooperatives, farmers and mapped farms
--
-- Rules enforced here:
--   * One farmer, one record: enrolment needs a NIN or BVN, and a repeat is refused.
--   * One piece of land, one farm: a boundary that overlaps a registered farm by
--     more than 5% of the smaller farm is refused (the "ghost farm" check).
--   * Farm area and centroid are computed from the boundary, never sent by clients.
--   * A farm's boundary is locked while it is in a live cycle.
--
-- Errors use PostgREST's PTxxx codes, so the API answers with that HTTP status.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Cooperatives
-- -----------------------------------------------------------------------------

create table public.cooperatives (
  id uuid primary key default gen_random_uuid(),
  name varchar(200) not null check (length(trim(name)) >= 2),
  registration_number varchar(60) unique,
  state varchar(60) not null check (length(trim(state)) >= 2),
  lga varchar(100) not null check (length(trim(lga)) >= 2),
  ward varchar(100),
  contact_phone varchar(20) check (contact_phone ~ '^\+?[0-9]{10,15}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger cooperatives_touch before update on public.cooperatives
for each row execute function private.touch_updated_at();

alter table public.cooperatives enable row level security;
revoke all on public.cooperatives from anon, authenticated;
grant select on public.cooperatives to authenticated;
grant insert (name, registration_number, state, lga, ward, contact_phone),
      update (name, registration_number, state, lga, ward, contact_phone)
   on public.cooperatives to authenticated;

create policy cooperatives_read on public.cooperatives for select to authenticated
  using ((select public.is_registry_reader()));
create policy cooperatives_insert on public.cooperatives for insert to authenticated
  with check ((select public.is_cooperative_editor()));
create policy cooperatives_update on public.cooperatives for update to authenticated
  using ((select public.is_cooperative_editor()))
  with check ((select public.is_cooperative_editor()));

-- -----------------------------------------------------------------------------
-- Farmers
-- -----------------------------------------------------------------------------

create type public.gender as enum ('female', 'male', 'other');
create type public.kyc_status as enum ('pending', 'verified', 'rejected');

create table public.farmers (
  id uuid primary key default gen_random_uuid(),
  first_name varchar(100) not null check (length(trim(first_name)) >= 1),
  last_name varchar(100) not null check (length(trim(last_name)) >= 1),
  full_name text generated always as (first_name || ' ' || last_name) stored,
  phone varchar(20) not null check (phone ~ '^\+?[0-9]{10,15}$'),
  gender public.gender,
  date_of_birth date check (date_of_birth > '1900-01-01' and date_of_birth < current_date),
  -- Only the last four digits are kept, for display. The hashes are in private.farmer_identities.
  nin_last4 char(4) check (nin_last4 ~ '^[0-9]{4}$'),
  bvn_last4 char(4) check (bvn_last4 ~ '^[0-9]{4}$'),
  kyc_status public.kyc_status not null default 'pending',
  state varchar(60) not null,
  lga varchar(100) not null,
  ward varchar(100),
  photo_url varchar(500) check (photo_url ~ '^https://'),
  cooperative_id uuid references public.cooperatives (id) on delete restrict,
  -- The field agent who enrolled this farmer, for audit.
  registered_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index farmers_phone_idx on public.farmers (phone);
create index farmers_cooperative_idx on public.farmers (cooperative_id);
create index farmers_location_idx on public.farmers (state, lga);

create trigger farmers_touch before update on public.farmers
for each row execute function private.touch_updated_at();

/** Keyed hashes of identity numbers. Not reachable through the API at all. */
create table private.farmer_identities (
  farmer_id uuid primary key references public.farmers (id) on delete restrict,
  nin_hash char(64) unique,
  bvn_hash char(64) unique,
  check (nin_hash is not null or bvn_hash is not null)
);

alter table public.farmers enable row level security;
revoke all on public.farmers from anon, authenticated;
grant select on public.farmers to authenticated;
-- Name and identity numbers can't be edited after enrolment; a wrong record is re-registered.
grant update (phone, gender, date_of_birth, ward, photo_url, cooperative_id)
   on public.farmers to authenticated;

create policy farmers_read on public.farmers for select to authenticated
  using ((select public.is_registry_reader()));
create policy farmers_update on public.farmers for update to authenticated
  using ((select public.is_enroller()))
  with check ((select public.is_enroller()));

/**
 * Enrols a farmer and returns their id. At least one national identifier is required,
 * so the registry can guarantee one record per person.
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
  p_cooperative_id uuid default null
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
    state, lga, ward, photo_url, cooperative_id, registered_by
  ) values (
    trim(p_first_name), trim(p_last_name), trim(p_phone), p_gender, p_date_of_birth,
    right(nin, 4), right(bvn, 4),
    trim(p_state), trim(p_lga), nullif(trim(p_ward), ''), nullif(trim(p_photo_url), ''),
    p_cooperative_id, auth.uid()
  ) returning id into new_id;

  -- If two agents enrol the same person at the same moment, the unique index decides.
  insert into private.farmer_identities (farmer_id, nin_hash, bvn_hash)
  values (new_id, nin_h, bvn_h);

  return new_id;
end $$;

create function public.set_farmer_kyc(p_farmer_id uuid, p_status public.kyc_status) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_kyc_reviewer() then
    raise exception 'Only compliance can make KYC decisions' using errcode = 'PT403';
  end if;
  update public.farmers set kyc_status = p_status where id = p_farmer_id;
  if not found then
    raise exception 'Farmer not found' using errcode = 'PT404';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Farms
-- -----------------------------------------------------------------------------

create type public.tenure_type as enum ('owned', 'leased', 'communal', 'family', 'other');

create table public.farms (
  id uuid primary key default gen_random_uuid(),
  farmer_id uuid not null references public.farmers (id) on delete restrict,
  name varchar(120),
  -- WGS84 longitude/latitude, captured by GPS walk or traced on satellite imagery.
  boundary extensions.geometry(Polygon, 4326) not null,
  -- Computed from the boundary by farm_compute_geometry().
  area_hectares numeric(12, 4) not null,
  centroid extensions.geometry(Point, 4326) not null,
  primary_crop varchar(60),
  tenure_type public.tenure_type not null default 'other',
  tenure_document_url varchar(500) check (tenure_document_url ~ '^https://'),
  soil_notes text check (length(soil_notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index farms_boundary_idx on public.farms using gist (boundary);
create index farms_farmer_idx on public.farms (farmer_id);

create function private.farm_compute_geometry() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not extensions.st_isvalid(new.boundary) then
    raise exception 'Farm boundary is not a valid polygon: %', extensions.st_isvalidreason(new.boundary)
      using errcode = 'PT400';
  end if;
  new.area_hectares := round(
    (extensions.st_area(new.boundary::extensions.geography) / 10000)::numeric, 4);
  new.centroid := extensions.st_centroid(new.boundary);
  return new;
end $$;

create trigger farms_compute_geometry before insert or update of boundary on public.farms
for each row execute function private.farm_compute_geometry();

create function private.farm_normalise() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.primary_crop := nullif(lower(trim(new.primary_crop)), '');
  return new;
end $$;

create trigger farms_normalise before insert or update on public.farms
for each row execute function private.farm_normalise();

create trigger farms_touch before update on public.farms
for each row execute function private.touch_updated_at();

alter table public.farms enable row level security;
revoke all on public.farms from anon, authenticated;
grant select on public.farms to authenticated;
-- The boundary changes only through map_farm / update_farm_boundary, which run the checks.
grant update (name, primary_crop, tenure_type, tenure_document_url, soil_notes)
   on public.farms to authenticated;

create policy farms_read on public.farms for select to authenticated
  using ((select public.is_registry_reader()));
create policy farms_update on public.farms for update to authenticated
  using ((select public.is_enroller()))
  with check ((select public.is_enroller()));

/** Farms with the boundary as GeoJSON, ready for a map. Respects the farms policies. */
create view public.farm_maps with (security_invoker = true) as
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
  f.updated_at
from public.farms f
join public.farmers fr on fr.id = f.farmer_id;

revoke all on public.farm_maps from anon, authenticated;
grant select on public.farm_maps to authenticated;

/** Turns client GeoJSON into a checked 2D polygon, or raises a clear 400 error. */
create function private.parse_farm_boundary(p_boundary jsonb) returns extensions.geometry
language plpgsql immutable set search_path = '' as $$
declare
  g extensions.geometry;
begin
  if p_boundary is null or jsonb_typeof(p_boundary) <> 'object'
     or p_boundary ->> 'type' is distinct from 'Polygon' then
    raise exception 'Boundary must be a GeoJSON Polygon' using errcode = 'PT400';
  end if;
  begin
    g := extensions.st_setsrid(
      extensions.st_force2d(extensions.st_geomfromgeojson(p_boundary::text)), 4326);
  exception when others then
    raise exception 'Boundary is not valid GeoJSON: %', sqlerrm using errcode = 'PT400';
  end;
  if extensions.st_npoints(g) > 20000 then
    raise exception 'Boundary has too many points' using errcode = 'PT400';
  end if;
  if extensions.st_xmin(g::extensions.box3d) < -180 or extensions.st_xmax(g::extensions.box3d) > 180
     or extensions.st_ymin(g::extensions.box3d) < -90 or extensions.st_ymax(g::extensions.box3d) > 90 then
    raise exception 'Boundary coordinates must be [longitude, latitude] in degrees'
      using errcode = 'PT400';
  end if;
  if not extensions.st_isvalid(g) then
    raise exception 'Farm boundary is not a valid polygon: %', extensions.st_isvalidreason(g)
      using errcode = 'PT400';
  end if;
  return g;
end $$;

/**
 * Two farms may touch or overlap slightly (GPS error along a shared edge). An overlap
 * of more than 5% of the smaller farm means the same land is being registered twice.
 * The error's "details" lists the clashing farms as JSON.
 */
create function private.assert_no_overlap(g extensions.geometry, p_exclude_farm uuid)
returns void
language plpgsql stable set search_path = '' as $$
declare
  clashes jsonb;
begin
  select jsonb_agg(jsonb_build_object(
           'farm_id', o.id,
           'farmer_id', o.farmer_id,
           'overlap_hectares', round(o.overlap_ha::numeric, 4)))
    into clashes
    from (
      select f.id, f.farmer_id,
             extensions.st_area(extensions.st_intersection(f.boundary, g)::extensions.geography)
               / 10000 as overlap_ha,
             least(f.area_hectares::float8,
                   extensions.st_area(g::extensions.geography) / 10000) as smaller_ha
        from public.farms f
       where extensions.st_intersects(f.boundary, g)
         and (p_exclude_farm is null or f.id <> p_exclude_farm)
    ) o
   where o.overlap_ha > 0.05 * o.smaller_ha;

  if clashes is not null then
    raise exception 'This boundary overlaps land that is already registered'
      using errcode = 'PT409', detail = clashes::text;
  end if;
end $$;

/**
 * Farm writes are serialised so two agents can't map the same land at the same moment
 * and both pass the overlap check. Registry writes are low-volume, so this is cheap.
 */
create function private.lock_farm_mapping() returns void
language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtext('agrowth.farm_mapping'))
$$;

create function public.map_farm(
  p_farmer_id uuid,
  p_boundary jsonb,
  p_name text default null,
  p_primary_crop text default null,
  p_tenure_type public.tenure_type default 'other',
  p_tenure_document_url text default null,
  p_soil_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  g extensions.geometry;
  new_id uuid;
begin
  if not public.is_enroller() then
    raise exception 'Your role cannot map farms' using errcode = 'PT403';
  end if;
  if not exists (select 1 from public.farmers where id = p_farmer_id) then
    raise exception 'Farmer not found' using errcode = 'PT404';
  end if;
  g := private.parse_farm_boundary(p_boundary);
  perform private.lock_farm_mapping();
  perform private.assert_no_overlap(g, null);

  insert into public.farms (
    farmer_id, boundary, name, primary_crop, tenure_type, tenure_document_url, soil_notes
  ) values (
    p_farmer_id, g, nullif(trim(p_name), ''), p_primary_crop, coalesce(p_tenure_type, 'other'),
    nullif(trim(p_tenure_document_url), ''), nullif(trim(p_soil_notes), '')
  ) returning id into new_id;
  return new_id;
end $$;

create function public.update_farm_boundary(p_farm_id uuid, p_boundary jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g extensions.geometry;
  live record;
begin
  if not public.is_enroller() then
    raise exception 'Your role cannot map farms' using errcode = 'PT403';
  end if;
  if not exists (select 1 from public.farms where id = p_farm_id) then
    raise exception 'Farm not found' using errcode = 'PT404';
  end if;

  -- While a cycle is live, the boundary is what investors and the programme funded.
  select c.code, c.status into live
    from public.cycle_farms cf join public.cycles c on c.id = cf.cycle_id
   where cf.farm_id = p_farm_id
     and c.status in ('pending_approval', 'open_for_funding', 'funded', 'in_progress', 'harvested')
   limit 1;
  if found then
    raise exception 'The boundary is locked while the farm is in active cycle % (%)',
      live.code, live.status using errcode = 'PT409';
  end if;

  g := private.parse_farm_boundary(p_boundary);
  perform private.lock_farm_mapping();
  perform private.assert_no_overlap(g, p_farm_id);
  update public.farms set boundary = g where id = p_farm_id;
end $$;

/**
 * Is a GPS position inside the mapped farm? Used for field-agent check-ins.
 * Returns no row if the farm doesn't exist or the caller can't see it.
 */
create function public.farm_contains_point(p_farm_id uuid, p_lon float8, p_lat float8)
returns table (inside boolean, distance_metres float8)
language sql stable security invoker set search_path = '' as $$
  select extensions.st_covers(f.boundary, p.g),
         round(extensions.st_distance(f.boundary::extensions.geography,
                                      p.g::extensions.geography)::numeric, 1)::float8
    from public.farms f,
         (select extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326) as g) p
   where f.id = p_farm_id
$$;

-- -----------------------------------------------------------------------------
-- Function permissions
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.register_farmer(text, text, text, text, text, text, text, public.gender, date, text, text, uuid),
  public.set_farmer_kyc(uuid, public.kyc_status),
  public.map_farm(uuid, jsonb, text, text, public.tenure_type, text, text),
  public.update_farm_boundary(uuid, jsonb),
  public.farm_contains_point(uuid, float8, float8)
to authenticated;
