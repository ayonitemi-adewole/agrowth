-- =============================================================================
-- Agrowth 2.0 — field visits recorded offline
--
-- The agent app saves a visit on the phone when there's no signal and sends it when
-- coverage returns. Two things change:
--
--   1. Each visit carries the phone's own id for it (client_ref). Sending the same visit
--      twice, e.g. when the connection drops after the database saved it but before the
--      phone heard back, returns the first result instead of recording a second visit.
--   2. Nothing else changes in how a visit is judged: the database still checks the GPS
--      fix against the boundary, using the time the agent was at the farm (visited_at).
--      created_at shows when it arrived, so a late sync is visible in the evidence.
-- =============================================================================

alter table public.field_visits
  add column client_ref uuid unique;

drop function public.record_field_visit(
  uuid, uuid, float8, float8, numeric, public.crop_condition, boolean, text[], text, timestamptz);

/**
 * Records an agent's visit. The database decides whether it passes:
 * the GPS fix must be precise and inside (or within a few metres of) the boundary,
 * the checklist must pass, the crop must not have failed, and there must be a photo.
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
  p_client_ref uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.milestones;
  existing public.field_visits;
  point extensions.geometry;
  distance numeric;
  gps_ok boolean;
  passed boolean;
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
            and coalesce(array_length(p_photo_paths, 1), 0) > 0;

  insert into public.field_visits (
    farm_id, milestone_id, agent_id, visited_at, location, gps_accuracy_m,
    distance_from_boundary_m, gps_ok, checklist_passed, crop_condition, notes, photo_paths, passed,
    client_ref
  ) values (
    p_farm_id, p_milestone_id, auth.uid(), p_visited_at, point, p_gps_accuracy_m, distance, gps_ok,
    p_checklist_passed, p_crop_condition, nullif(trim(p_notes), ''), coalesce(p_photo_paths, '{}'), passed,
    p_client_ref
  ) returning id into new_id;

  status_now := private.evaluate_milestone(p_milestone_id);
  return jsonb_build_object(
    'visit_id', new_id, 'passed', passed, 'gps_ok', gps_ok,
    'distance_from_boundary_m', distance, 'milestone_status', status_now, 'duplicate', false);
end $$;

revoke execute on function public.record_field_visit(
  uuid, uuid, float8, float8, numeric, public.crop_condition, boolean, text[], text, timestamptz, uuid)
  from public, anon;
grant execute on function public.record_field_visit(
  uuid, uuid, float8, float8, numeric, public.crop_condition, boolean, text[], text, timestamptz, uuid)
  to authenticated;
