-- =============================================================================
-- Visit evidence: where each field visit was checked in, as plain coordinates,
-- so the app can show the check-in against the farm boundary on a map.
-- Respects the field_visits policies (security invoker).
-- =============================================================================

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
  v.created_at
from public.field_visits v;

revoke all on public.field_visit_evidence from anon, authenticated;
grant select on public.field_visit_evidence to authenticated;
