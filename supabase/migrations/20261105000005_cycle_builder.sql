-- =============================================================================
-- Agrowth 2.0 — cycle builder and approval
--
-- A cycle is built as a draft by a cycle or programme manager: crop, budget,
-- yield and price assumptions, farms, a milestone schedule, an offtake contract
-- and an insurance policy. It can only be submitted when every rule below holds,
-- and only compliance (never the cycle's own manager) can approve it.
--
--   * Offtake first: a signed offtake agreement covering at least the low-yield harvest.
--   * Insured downside: a bound policy whose sum insured covers the cycle's budget.
--   * Verified farmers: every farmer in the cycle has passed KYC.
--   * One cycle per farm at a time.
--   * Milestones add up exactly to the target; the target fits the per-hectare budget.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------

create function public.is_cycle_manager() returns boolean
language sql stable set search_path = '' as $$
  select public.has_any_role(array['admin', 'cycle_manager', 'programme_manager']::public.user_role[])
$$;

create function public.is_cycle_reviewer() returns boolean
language sql stable set search_path = '' as $$
  select public.has_any_role(array['admin', 'compliance_officer']::public.user_role[])
$$;

create function public.is_trustee() returns boolean
language sql stable set search_path = '' as $$
  select public.has_any_role(array['trustee']::public.user_role[])
$$;

/** Staff who can see cycles: registry readers plus the trustee. */
create function public.is_cycle_reader() returns boolean
language sql stable set search_path = '' as $$
  select public.is_registry_reader() or public.is_trustee()
$$;

-- The trustee also reads the ledger: it is their money movements being recorded.
create or replace function public.is_ledger_reader() returns boolean
language sql stable set search_path = '' as $$
  select public.has_any_role(array['admin', 'auditor', 'compliance_officer', 'trustee']::public.user_role[])
$$;

-- -----------------------------------------------------------------------------
-- Cycles: extra fields
-- -----------------------------------------------------------------------------

alter table public.cycles
  add column description text check (length(description) <= 5000),
  -- Farm-gate price assumptions per tonne, shown as a range — never a promise.
  add column price_low_per_tonne_kobo bigint check (price_low_per_tonne_kobo > 0),
  add column price_expected_per_tonne_kobo bigint check (price_expected_per_tonne_kobo > 0),
  add column price_high_per_tonne_kobo bigint check (price_high_per_tonne_kobo > 0),
  add column submitted_at timestamptz,
  add column approved_at timestamptz,
  add column approved_by uuid references public.profiles (id) on delete restrict,
  add column review_note text,
  add constraint cycles_code_format check (code ~ '^[A-Z0-9][A-Z0-9-]{2,39}$'),
  add constraint cycles_price_order check (
    price_low_per_tonne_kobo <= price_expected_per_tonne_kobo
    and price_expected_per_tonne_kobo <= price_high_per_tonne_kobo),
  add constraint cycles_dates_order check (
    expected_harvest_date > start_date and funding_deadline <= start_date);

alter table public.cycles alter column manager_id set default auth.uid();

alter table public.milestones
  add column description text check (length(description) <= 2000),
  add column verification_requested_at timestamptz,
  add constraint milestones_sequence_positive check (sequence > 0);

alter table public.offtake_contracts
  drop column document_url,
  -- Path of the signed agreement in the "cycle-documents" storage bucket.
  add column document_path text,
  add column signed_on date,
  add constraint offtake_price_terms check (
    (price_terms = 'fixed' and price_per_tonne_kobo is not null)
    or (price_terms = 'floor' and price_floor_per_tonne_kobo is not null)
    or (price_terms = 'formula' and length(trim(price_formula)) > 0));

create type public.insurance_cover as enum ('area_yield', 'weather_index', 'multi_peril');

create table public.insurance_policies (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycles (id) on delete cascade,
  insurer_name varchar(200) not null,
  policy_number varchar(100) not null,
  cover_type public.insurance_cover not null,
  sum_insured_kobo bigint not null check (sum_insured_kobo > 0),
  premium_kobo bigint not null check (premium_kobo >= 0),
  -- Who the insurer pays on a claim: the trustee on behalf of the funders.
  loss_payee varchar(200) not null,
  cover_start date not null,
  cover_end date not null,
  document_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cover_end > cover_start)
);

create trigger insurance_policies_touch before update on public.insurance_policies
for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Cycle history: an append-only log of everything that happens to a cycle
-- -----------------------------------------------------------------------------

create table public.cycle_events (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycles (id) on delete cascade,
  kind varchar(40) not null,
  message text not null,
  actor_id uuid references public.profiles (id) on delete restrict,
  data jsonb,
  created_at timestamptz not null default now()
);
create index cycle_events_cycle_idx on public.cycle_events (cycle_id, created_at);

create trigger cycle_events_append_only before update or delete on public.cycle_events
for each row execute function private.ledger_forbid_change();

create function private.log_cycle_event(
  p_cycle_id uuid, p_kind text, p_message text, p_data jsonb default null
) returns void
language sql set search_path = '' as $$
  insert into public.cycle_events (cycle_id, kind, message, actor_id, data)
  values (p_cycle_id, p_kind, p_message, auth.uid(), p_data)
$$;

-- -----------------------------------------------------------------------------
-- Editing drafts
-- -----------------------------------------------------------------------------

/** Can the signed-in user change this cycle's draft? */
create function public.can_edit_cycle(p_cycle_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_cycle_manager()
     and exists (select 1 from public.cycles where id = p_cycle_id and status = 'draft')
$$;

-- Cycles: managers create and edit drafts. Status only changes through functions.
grant insert (code, crop, season, funding_source, target_amount_kobo, budget_per_hectare_kobo,
              yield_low_t_per_ha, yield_expected_t_per_ha, yield_high_t_per_ha,
              price_low_per_tonne_kobo, price_expected_per_tonne_kobo, price_high_per_tonne_kobo,
              funding_deadline, start_date, expected_harvest_date, cooperative_id, description),
      update (code, crop, season, funding_source, target_amount_kobo, budget_per_hectare_kobo,
              yield_low_t_per_ha, yield_expected_t_per_ha, yield_high_t_per_ha,
              price_low_per_tonne_kobo, price_expected_per_tonne_kobo, price_high_per_tonne_kobo,
              funding_deadline, start_date, expected_harvest_date, cooperative_id, description)
   on public.cycles to authenticated;

create policy cycles_insert on public.cycles for insert to authenticated
  with check ((select public.is_cycle_manager()) and manager_id = (select auth.uid()) and status = 'draft');
create policy cycles_update on public.cycles for update to authenticated
  using ((select public.is_cycle_manager()) and status = 'draft')
  with check (status = 'draft');

-- Readers now include the trustee.
alter policy cycles_read on public.cycles using ((select public.is_cycle_reader()));
alter policy cycle_farms_read on public.cycle_farms using ((select public.is_cycle_reader()));
alter policy milestones_read on public.milestones using ((select public.is_cycle_reader()));
alter policy offtake_contracts_read on public.offtake_contracts using ((select public.is_cycle_reader()));

grant insert, delete on public.cycle_farms to authenticated;
create policy cycle_farms_insert on public.cycle_farms for insert to authenticated
  with check (public.can_edit_cycle(cycle_id));
create policy cycle_farms_delete on public.cycle_farms for delete to authenticated
  using (public.can_edit_cycle(cycle_id));

grant insert (cycle_id, sequence, name, planned_date, amount_kobo, description),
      update (sequence, name, planned_date, amount_kobo, description),
      delete
   on public.milestones to authenticated;
create policy milestones_insert on public.milestones for insert to authenticated
  with check (public.can_edit_cycle(cycle_id));
create policy milestones_update on public.milestones for update to authenticated
  using (public.can_edit_cycle(cycle_id)) with check (public.can_edit_cycle(cycle_id));
create policy milestones_delete on public.milestones for delete to authenticated
  using (public.can_edit_cycle(cycle_id));

grant insert (cycle_id, buyer_name, buyer_contact, commodity, volume_tonnes, price_terms,
              price_per_tonne_kobo, price_floor_per_tonne_kobo, price_formula,
              delivery_window_start, delivery_window_end, document_path, signed_on),
      update (buyer_name, buyer_contact, commodity, volume_tonnes, price_terms,
              price_per_tonne_kobo, price_floor_per_tonne_kobo, price_formula,
              delivery_window_start, delivery_window_end, document_path, signed_on),
      delete
   on public.offtake_contracts to authenticated;
create policy offtake_insert on public.offtake_contracts for insert to authenticated
  with check (public.can_edit_cycle(cycle_id));
create policy offtake_update on public.offtake_contracts for update to authenticated
  using (public.can_edit_cycle(cycle_id)) with check (public.can_edit_cycle(cycle_id));
create policy offtake_delete on public.offtake_contracts for delete to authenticated
  using (public.can_edit_cycle(cycle_id));

alter table public.insurance_policies enable row level security;
revoke all on public.insurance_policies from anon, authenticated;
grant select on public.insurance_policies to authenticated;
grant insert (cycle_id, insurer_name, policy_number, cover_type, sum_insured_kobo, premium_kobo,
              loss_payee, cover_start, cover_end, document_path),
      update (insurer_name, policy_number, cover_type, sum_insured_kobo, premium_kobo,
              loss_payee, cover_start, cover_end, document_path),
      delete
   on public.insurance_policies to authenticated;
create policy insurance_read on public.insurance_policies for select to authenticated
  using ((select public.is_cycle_reader()));
create policy insurance_insert on public.insurance_policies for insert to authenticated
  with check (public.can_edit_cycle(cycle_id));
create policy insurance_update on public.insurance_policies for update to authenticated
  using (public.can_edit_cycle(cycle_id)) with check (public.can_edit_cycle(cycle_id));
create policy insurance_delete on public.insurance_policies for delete to authenticated
  using (public.can_edit_cycle(cycle_id));

alter table public.cycle_events enable row level security;
revoke all on public.cycle_events from anon, authenticated;
grant select on public.cycle_events to authenticated;
create policy cycle_events_read on public.cycle_events for select to authenticated
  using ((select public.is_cycle_reader()));

-- -----------------------------------------------------------------------------
-- Summary view: hectares, milestone total and farmer count per cycle
-- -----------------------------------------------------------------------------

create view public.cycle_summaries with (security_invoker = true) as
select
  c.id,
  c.code,
  c.crop,
  c.season,
  c.status,
  c.funding_source,
  c.target_amount_kobo,
  c.funding_deadline,
  c.start_date,
  c.expected_harvest_date,
  c.cooperative_id,
  c.manager_id,
  c.created_at,
  coalesce(fa.farm_count, 0) as farm_count,
  coalesce(fa.hectares, 0) as hectares,
  coalesce(m.milestone_total, 0) as milestone_total_kobo
from public.cycles c
left join lateral (
  select count(*) as farm_count, sum(f.area_hectares) as hectares
    from public.cycle_farms cf join public.farms f on f.id = cf.farm_id
   where cf.cycle_id = c.id
) fa on true
left join lateral (
  select sum(amount_kobo) as milestone_total from public.milestones where cycle_id = c.id
) m on true;

revoke all on public.cycle_summaries from anon, authenticated;
grant select on public.cycle_summaries to authenticated;

-- -----------------------------------------------------------------------------
-- Readiness: the checklist a cycle must pass before it can be submitted
-- -----------------------------------------------------------------------------

/**
 * Returns [{ "key", "label", "ok", "detail" }]. The app shows it as a live checklist;
 * submit_cycle and review_cycle refuse to proceed unless every item is ok.
 */
create function public.cycle_readiness(p_cycle_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.cycles;
  checks jsonb := '[]'::jsonb;
  ha numeric;
  n_farms int;
  n_unverified int;
  n_busy int;
  busy_code text;
  n_milestones int;
  ms_total bigint;
  contracted numeric;
  min_volume numeric;
  n_signed int;
  best_sum_insured bigint;
  n_insured int;
  covers_period boolean;
begin
  if not public.is_cycle_reader() then
    raise exception 'Your role cannot see cycles' using errcode = 'PT403';
  end if;
  select * into c from public.cycles where id = p_cycle_id;
  if not found then
    raise exception 'Cycle not found' using errcode = 'PT404';
  end if;

  select count(*), coalesce(sum(f.area_hectares), 0),
         count(*) filter (where fr.kyc_status <> 'verified')
    into n_farms, ha, n_unverified
    from public.cycle_farms cf
    join public.farms f on f.id = cf.farm_id
    join public.farmers fr on fr.id = f.farmer_id
   where cf.cycle_id = p_cycle_id;

  select count(*), min(oc.code) into n_busy, busy_code
    from public.cycle_farms cf
    join public.cycle_farms other on other.farm_id = cf.farm_id and other.cycle_id <> cf.cycle_id
    join public.cycles oc on oc.id = other.cycle_id
   where cf.cycle_id = p_cycle_id
     and oc.status in ('pending_approval', 'open_for_funding', 'funded', 'in_progress', 'harvested');

  select count(*), coalesce(sum(amount_kobo), 0) into n_milestones, ms_total
    from public.milestones where cycle_id = p_cycle_id;

  select count(*), coalesce(sum(volume_tonnes), 0) into n_signed, contracted
    from public.offtake_contracts
   where cycle_id = p_cycle_id and document_path is not null and signed_on is not null;
  min_volume := round(c.yield_low_t_per_ha * ha, 3);

  select count(*), coalesce(max(sum_insured_kobo), 0),
         coalesce(bool_or(cover_start <= c.start_date and cover_end >= c.expected_harvest_date), false)
    into n_insured, best_sum_insured, covers_period
    from public.insurance_policies
   where cycle_id = p_cycle_id and document_path is not null;

  checks := jsonb_build_array(
    jsonb_build_object('key', 'farms', 'label', 'At least one mapped farm',
      'ok', n_farms > 0,
      'detail', format('%s farms, %s ha', n_farms, round(ha, 2))),
    jsonb_build_object('key', 'kyc', 'label', 'Every farmer has passed KYC',
      'ok', n_farms > 0 and n_unverified = 0,
      'detail', case when n_unverified > 0 then format('%s farmer(s) not yet verified', n_unverified) end),
    jsonb_build_object('key', 'one_cycle_per_farm', 'label', 'No farm is already in another live cycle',
      'ok', n_busy = 0,
      'detail', case when n_busy > 0 then format('%s farm(s) are in cycle %s', n_busy, busy_code) end),
    jsonb_build_object('key', 'budget', 'label', 'Target fits the per-hectare budget',
      'ok', n_farms > 0 and c.target_amount_kobo <= ceil(c.budget_per_hectare_kobo * ha),
      'detail', format('Budget allows up to ₦%s', to_char(ceil(c.budget_per_hectare_kobo * ha) / 100, 'FM999,999,999,990'))),
    jsonb_build_object('key', 'milestones', 'label', 'Milestones add up to the target',
      'ok', n_milestones > 0 and ms_total = c.target_amount_kobo,
      'detail', format('%s milestones totalling ₦%s', n_milestones, to_char(ms_total / 100.0, 'FM999,999,999,990.00'))),
    jsonb_build_object('key', 'dates', 'label', 'Funding deadline, start and harvest dates set, deadline in the future',
      'ok', c.funding_deadline is not null and c.start_date is not null
            and c.expected_harvest_date is not null and c.funding_deadline >= current_date,
      'detail', null),
    jsonb_build_object('key', 'prices', 'label', 'Low, expected and high price assumptions set',
      'ok', c.price_low_per_tonne_kobo is not null and c.price_expected_per_tonne_kobo is not null
            and c.price_high_per_tonne_kobo is not null,
      'detail', null),
    jsonb_build_object('key', 'offtake', 'label', 'Signed offtake covers at least the low-yield harvest',
      'ok', n_signed > 0 and contracted >= min_volume and ha > 0,
      'detail', format('%s t contracted; low-yield harvest is %s t', contracted, min_volume)),
    jsonb_build_object('key', 'insurance', 'label', 'Insurance covers the budget for the whole season',
      'ok', n_insured > 0 and best_sum_insured >= c.target_amount_kobo and covers_period,
      'detail', case when n_insured = 0 then 'No policy document uploaded'
                     when not covers_period then 'Cover dates must run from start to expected harvest' end)
  );
  return checks;
end $$;

create function private.assert_ready(p_cycle_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  failing jsonb;
begin
  select jsonb_agg(item) into failing
    from jsonb_array_elements(public.cycle_readiness(p_cycle_id)) item
   where not (item ->> 'ok')::boolean;
  if failing is not null then
    raise exception 'This cycle is not ready: % check(s) failing', jsonb_array_length(failing)
      using errcode = 'PT400', detail = failing::text;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Workflow
-- -----------------------------------------------------------------------------

create function public.submit_cycle(p_cycle_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cycles;
begin
  if not public.is_cycle_manager() then
    raise exception 'Only cycle or programme managers can submit cycles' using errcode = 'PT403';
  end if;
  select * into c from public.cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'Cycle not found' using errcode = 'PT404';
  end if;
  if c.status <> 'draft' then
    raise exception 'Only a draft can be submitted (this cycle is %)', c.status using errcode = 'PT409';
  end if;
  perform private.assert_ready(p_cycle_id);
  update public.cycles set status = 'pending_approval', submitted_at = now(), review_note = null
   where id = p_cycle_id;
  perform private.log_cycle_event(p_cycle_id, 'submitted', 'Submitted for compliance approval');
end $$;

/**
 * Compliance decision. Approval opens the cycle for funding and creates its ledger
 * accounts; rejection returns it to draft with the reviewer's note.
 */
create function public.review_cycle(p_cycle_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cycles;
begin
  if not public.is_cycle_reviewer() then
    raise exception 'Only compliance can approve or reject cycles' using errcode = 'PT403';
  end if;
  select * into c from public.cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'Cycle not found' using errcode = 'PT404';
  end if;
  if c.status <> 'pending_approval' then
    raise exception 'Only a cycle awaiting approval can be reviewed (this cycle is %)', c.status
      using errcode = 'PT409';
  end if;
  if c.manager_id = auth.uid() then
    raise exception 'You manage this cycle, so someone else must review it' using errcode = 'PT403';
  end if;

  if not p_approve then
    if coalesce(trim(p_note), '') = '' then
      raise exception 'Give a reason when rejecting a cycle' using errcode = 'PT400';
    end if;
    update public.cycles set status = 'draft', review_note = trim(p_note) where id = p_cycle_id;
    perform private.log_cycle_event(p_cycle_id, 'rejected', trim(p_note));
    return;
  end if;

  -- Things can change between submission and review (e.g. a KYC decision), so check again.
  perform private.assert_ready(p_cycle_id);

  update public.cycles
     set status = 'open_for_funding', approved_at = now(), approved_by = auth.uid(),
         review_note = nullif(trim(p_note), '')
   where id = p_cycle_id;
  update public.offtake_contracts set status = 'approved'
   where cycle_id = p_cycle_id and document_path is not null and signed_on is not null;

  insert into public.ledger_accounts (code, name, type, cycle_id) values
    ('TRUSTEE_CASH', 'Cash held by the trustee', 'asset', p_cycle_id),
    ('FUNDER_CAPITAL', 'Capital owed to funders', 'liability', p_cycle_id),
    ('FARM_DEPLOYMENT', 'Inputs and services deployed to farms', 'asset', p_cycle_id)
  on conflict do nothing;

  perform private.log_cycle_event(p_cycle_id, 'approved',
    coalesce('Approved: ' || nullif(trim(p_note), ''), 'Approved and opened for funding'));
end $$;

/** Cancel a cycle that hasn't started. Any funds received are then refunded by the trustee. */
create function public.cancel_cycle(p_cycle_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cycles;
begin
  if not public.is_cycle_manager() then
    raise exception 'Only cycle or programme managers can cancel cycles' using errcode = 'PT403';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason for cancelling' using errcode = 'PT400';
  end if;
  select * into c from public.cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'Cycle not found' using errcode = 'PT404';
  end if;
  if c.status not in ('draft', 'pending_approval', 'open_for_funding') then
    raise exception 'A % cycle can no longer be cancelled', c.status using errcode = 'PT409';
  end if;
  update public.cycles set status = 'cancelled' where id = p_cycle_id;
  perform private.log_cycle_event(p_cycle_id, 'cancelled', trim(p_reason));
end $$;

-- -----------------------------------------------------------------------------
-- Document storage (signed offtake agreements, insurance policies)
-- Path convention: <cycle id>/<file name>. Documents can't be replaced or deleted.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('cycle-documents', 'cycle-documents', false)
on conflict (id) do nothing;

create function public.can_upload_cycle_document(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  folder text := split_part(p_name, '/', 1);
begin
  if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.can_edit_cycle(folder::uuid);
end $$;

create policy cycle_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'cycle-documents' and (select public.is_cycle_reader()));
create policy cycle_documents_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'cycle-documents' and public.can_upload_cycle_document(name));

-- -----------------------------------------------------------------------------
-- Function permissions
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.is_cycle_manager(),
  public.is_cycle_reviewer(),
  public.is_trustee(),
  public.is_cycle_reader(),
  public.is_ledger_reader(),
  public.can_edit_cycle(uuid),
  public.can_upload_cycle_document(text),
  public.cycle_readiness(uuid),
  public.submit_cycle(uuid),
  public.review_cycle(uuid, boolean, text),
  public.cancel_cycle(uuid, text)
to authenticated;
