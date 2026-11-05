-- =============================================================================
-- Agrowth 2.0 — funding, field verification and staged disbursement
--
-- How money moves (the platform never holds it):
--   1. Funders pay the trustee. The trustee records each deposit here, which posts
--      Dr TRUSTEE_CASH / Cr FUNDER_CAPITAL. A cycle is "funded" at its target.
--      If it doesn't fill by the deadline, or is cancelled, the trustee refunds everyone.
--   2. Before each milestone, a field agent visits every farm: a GPS check-in inside
--      the mapped boundary, a checklist and photos. One failed visit blocks the release.
--   3. Once every farm passes, the cycle manager instructs the release, mostly to input
--      vendors and service providers; at most 20% may go to farmers as cash.
--   4. The trustee executes each payment and confirms it here, which posts
--      Dr FARM_DEPLOYMENT / Cr TRUSTEE_CASH. The trustee can never pay out more than it holds.
-- =============================================================================

/** At most this share of any milestone may be paid to farmers as cash. */
create function private.max_cash_share() returns numeric
language sql immutable set search_path = '' as $$ select 0.20 $$;

/** A GPS check-in must be this close to the boundary, and this precise. */
create function private.max_checkin_metres() returns numeric
language sql immutable set search_path = '' as $$ select 20 $$;

create function private.cycle_account(p_cycle_id uuid, p_code text) returns uuid
language plpgsql stable set search_path = '' as $$
declare
  account uuid;
begin
  select id into account from public.ledger_accounts where cycle_id = p_cycle_id and code = p_code;
  if account is null then
    raise exception 'Cycle % has no % account; has it been approved?', p_cycle_id, p_code;
  end if;
  return account;
end $$;

create function private.account_balance(p_account_id uuid) returns bigint
language sql stable set search_path = '' as $$
  select coalesce(sum(amount_kobo), 0)::bigint from public.journal_lines where account_id = p_account_id
$$;

-- -----------------------------------------------------------------------------
-- Funding
-- -----------------------------------------------------------------------------

create type public.funder_kind as enum ('investor', 'programme');

create table public.funding_contributions (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycles (id) on delete restrict,
  funder_name varchar(200) not null,
  funder_kind public.funder_kind not null,
  amount_kobo bigint not null check (amount_kobo > 0),
  -- The trustee's own reference for the deposit; one record per bank transaction.
  trustee_reference varchar(120) not null unique,
  received_on date not null,
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  journal_entry_id uuid not null unique references public.journal_entries (id),
  refund_entry_id uuid unique references public.journal_entries (id),
  created_at timestamptz not null default now()
);
create index funding_contributions_cycle_idx on public.funding_contributions (cycle_id);

create function public.record_funding(
  p_cycle_id uuid,
  p_funder_name text,
  p_funder_kind public.funder_kind,
  p_amount_kobo bigint,
  p_trustee_reference text,
  p_received_on date default current_date
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cycles;
  raised bigint;
  entry uuid;
  new_id uuid;
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can confirm deposits' using errcode = 'PT403';
  end if;
  select * into c from public.cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'Cycle not found' using errcode = 'PT404';
  end if;
  if c.status <> 'open_for_funding' then
    raise exception 'This cycle is not open for funding (it is %)', c.status using errcode = 'PT409';
  end if;
  if c.funding_deadline < current_date then
    raise exception 'The funding deadline has passed; refund the funders instead' using errcode = 'PT409';
  end if;
  if coalesce(p_amount_kobo, 0) <= 0 then
    raise exception 'Amount must be positive' using errcode = 'PT400';
  end if;
  if coalesce(trim(p_funder_name), '') = '' or coalesce(trim(p_trustee_reference), '') = '' then
    raise exception 'Funder name and trustee reference are required' using errcode = 'PT400';
  end if;
  if p_received_on > current_date then
    raise exception 'A deposit cannot be dated in the future' using errcode = 'PT400';
  end if;
  if (c.funding_source = 'investor' and p_funder_kind <> 'investor')
     or (c.funding_source = 'programme' and p_funder_kind <> 'programme') then
    raise exception 'This cycle only accepts % funding', c.funding_source using errcode = 'PT400';
  end if;
  if exists (select 1 from public.funding_contributions where trustee_reference = trim(p_trustee_reference)) then
    raise exception 'Trustee reference % has already been recorded', trim(p_trustee_reference)
      using errcode = 'PT409';
  end if;

  select coalesce(sum(amount_kobo), 0) into raised
    from public.funding_contributions where cycle_id = p_cycle_id;
  if raised + p_amount_kobo > c.target_amount_kobo then
    raise exception 'This deposit would take the cycle past its target; only ₦% is still needed',
      to_char((c.target_amount_kobo - raised) / 100.0, 'FM999,999,999,990.00') using errcode = 'PT400';
  end if;

  entry := private.post_journal_entry(
    p_cycle_id,
    left(format('Funding from %s', trim(p_funder_name)), 300),
    auth.uid(),
    jsonb_build_array(
      jsonb_build_object('account_id', private.cycle_account(p_cycle_id, 'TRUSTEE_CASH'),
                         'amount_kobo', p_amount_kobo::text),
      jsonb_build_object('account_id', private.cycle_account(p_cycle_id, 'FUNDER_CAPITAL'),
                         'amount_kobo', (-p_amount_kobo)::text, 'memo', trim(p_funder_name))),
    trim(p_trustee_reference));

  insert into public.funding_contributions (
    cycle_id, funder_name, funder_kind, amount_kobo, trustee_reference, received_on, recorded_by,
    journal_entry_id
  ) values (
    p_cycle_id, trim(p_funder_name), p_funder_kind, p_amount_kobo, trim(p_trustee_reference),
    p_received_on, auth.uid(), entry
  ) returning id into new_id;

  perform private.log_cycle_event(p_cycle_id, 'funding_received',
    format('₦%s received from %s', to_char(p_amount_kobo / 100.0, 'FM999,999,999,990.00'), trim(p_funder_name)),
    jsonb_build_object('contribution_id', new_id));

  if raised + p_amount_kobo = c.target_amount_kobo then
    update public.cycles set status = 'funded' where id = p_cycle_id;
    perform private.log_cycle_event(p_cycle_id, 'funded', 'Fully funded');
  end if;
  return new_id;
end $$;

/**
 * Refund every funder in full. Allowed when the funding deadline has passed without
 * the cycle filling, or after the cycle was cancelled.
 */
create function public.refund_cycle(p_cycle_id uuid, p_reason text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  c public.cycles;
  contribution public.funding_contributions;
  refunded int := 0;
  entry uuid;
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can refund funders' using errcode = 'PT403';
  end if;
  select * into c from public.cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'Cycle not found' using errcode = 'PT404';
  end if;
  if not (c.status = 'cancelled'
          or (c.status = 'open_for_funding' and c.funding_deadline < current_date)) then
    raise exception 'Refunds are only for cancelled cycles or ones that missed their funding deadline'
      using errcode = 'PT409';
  end if;

  for contribution in
    select * from public.funding_contributions
     where cycle_id = p_cycle_id and refund_entry_id is null
     order by created_at
  loop
    entry := private.reverse_journal_entry(contribution.journal_entry_id, auth.uid(),
      coalesce(nullif(trim(p_reason), ''), 'cycle refunded'));
    update public.funding_contributions set refund_entry_id = entry where id = contribution.id;
    refunded := refunded + 1;
  end loop;

  update public.cycles set status = 'refunded' where id = p_cycle_id;
  perform private.log_cycle_event(p_cycle_id, 'refunded',
    format('%s funder(s) refunded in full', refunded));
  return refunded;
end $$;

-- -----------------------------------------------------------------------------
-- Field verification
-- -----------------------------------------------------------------------------

create type public.crop_condition as enum ('good', 'fair', 'poor', 'failed');

create table public.field_visits (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id) on delete restrict,
  milestone_id uuid not null references public.milestones (id) on delete restrict,
  agent_id uuid not null references public.profiles (id) on delete restrict,
  -- When the agent was at the farm (the app may sync later, after working offline).
  visited_at timestamptz not null,
  location extensions.geometry(Point, 4326) not null,
  gps_accuracy_m numeric(8, 1) not null check (gps_accuracy_m >= 0),
  -- Computed by the database from the farm boundary.
  distance_from_boundary_m numeric(10, 1) not null,
  gps_ok boolean not null,
  checklist_passed boolean not null,
  crop_condition public.crop_condition not null,
  notes text check (length(notes) <= 5000),
  photo_paths text[] not null default '{}',
  passed boolean not null,
  created_at timestamptz not null default now()
);
create index field_visits_milestone_idx on public.field_visits (milestone_id, farm_id, visited_at);

-- Visits are evidence: they are never edited or deleted. A new visit supersedes an old one.
create trigger field_visits_append_only before update or delete on public.field_visits
for each row execute function private.ledger_forbid_change();

/**
 * Recomputes a milestone's status from its farms' latest visits:
 * any farm whose latest visit failed → blocked; every farm passed → verified.
 */
create function private.evaluate_milestone(p_milestone_id uuid) returns public.milestone_status
language plpgsql set search_path = '' as $$
declare
  m public.milestones;
  n_farms int;
  n_passed int;
  n_failed int;
  next_status public.milestone_status;
begin
  select * into m from public.milestones where id = p_milestone_id for update;
  if m.status not in ('awaiting_verification', 'blocked', 'verified') then
    return m.status;
  end if;

  select count(*),
         count(*) filter (where latest.passed),
         count(*) filter (where not latest.passed)
    into n_farms, n_passed, n_failed
    from public.cycle_farms cf
    left join lateral (
      select v.passed from public.field_visits v
       where v.milestone_id = p_milestone_id and v.farm_id = cf.farm_id
         and v.visited_at >= m.verification_requested_at
       order by v.visited_at desc, v.created_at desc
       limit 1
    ) latest on true
   where cf.cycle_id = m.cycle_id;

  next_status := case
    when n_failed > 0 then 'blocked'
    when n_passed = n_farms and n_farms > 0 then 'verified'
    else 'awaiting_verification'
  end;

  if next_status is distinct from m.status then
    update public.milestones
       set status = next_status,
           verified_at = case when next_status = 'verified' then now() end
     where id = p_milestone_id;
    perform private.log_cycle_event(m.cycle_id, 'milestone_' || next_status,
      format('Milestone %s (%s): %s', m.sequence, m.name,
        case next_status
          when 'verified' then 'every farm passed verification'
          when 'blocked' then 'a farm failed verification, so the release is on hold'
          else 'awaiting the remaining farm visits' end),
      jsonb_build_object('milestone_id', m.id));
  end if;
  return next_status;
end $$;

create function public.request_milestone_verification(p_milestone_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.milestones;
  c public.cycles;
begin
  if not public.is_cycle_manager() then
    raise exception 'Only cycle or programme managers can start verification' using errcode = 'PT403';
  end if;
  select * into m from public.milestones where id = p_milestone_id for update;
  if not found then
    raise exception 'Milestone not found' using errcode = 'PT404';
  end if;
  select * into c from public.cycles where id = m.cycle_id;
  if c.status not in ('funded', 'in_progress') then
    raise exception 'Verification starts once the cycle is funded (it is %)', c.status
      using errcode = 'PT409';
  end if;
  if m.status <> 'pending' then
    raise exception 'This milestone is already %', m.status using errcode = 'PT409';
  end if;
  if exists (select 1 from public.milestones
              where cycle_id = m.cycle_id and sequence < m.sequence and status <> 'released') then
    raise exception 'Earlier milestones must be released first' using errcode = 'PT409';
  end if;
  update public.milestones
     set status = 'awaiting_verification', verification_requested_at = now()
   where id = p_milestone_id;
  perform private.log_cycle_event(m.cycle_id, 'verification_requested',
    format('Field verification requested for milestone %s (%s)', m.sequence, m.name),
    jsonb_build_object('milestone_id', m.id));
end $$;

/**
 * Records an agent's visit. The database decides whether it passes:
 * the GPS fix must be precise and inside (or within a few metres of) the boundary,
 * the checklist must pass, the crop must not have failed, and there must be a photo.
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
  p_visited_at timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.milestones;
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
    distance_from_boundary_m, gps_ok, checklist_passed, crop_condition, notes, photo_paths, passed
  ) values (
    p_farm_id, p_milestone_id, auth.uid(), p_visited_at, point, p_gps_accuracy_m, distance, gps_ok,
    p_checklist_passed, p_crop_condition, nullif(trim(p_notes), ''), coalesce(p_photo_paths, '{}'), passed
  ) returning id into new_id;

  status_now := private.evaluate_milestone(p_milestone_id);
  return jsonb_build_object(
    'visit_id', new_id, 'passed', passed, 'gps_ok', gps_ok,
    'distance_from_boundary_m', distance, 'milestone_status', status_now);
end $$;

-- Field photos. Path convention: <milestone id>/<farm id>/<file name>.
insert into storage.buckets (id, name, public)
values ('field-photos', 'field-photos', false)
on conflict (id) do nothing;

create policy field_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'field-photos' and (select public.is_cycle_reader()));
create policy field_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'field-photos' and (select public.is_enroller()));

-- -----------------------------------------------------------------------------
-- Disbursement
-- -----------------------------------------------------------------------------

create type public.payee_kind as enum ('input_vendor', 'service_provider', 'farmer_cash');
create type public.disbursement_status as enum ('instructed', 'executed', 'cancelled');

/** A release instruction to the trustee: pay this payee this amount for this milestone. */
create table public.disbursements (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycles (id) on delete restrict,
  milestone_id uuid not null references public.milestones (id) on delete restrict,
  payee_kind public.payee_kind not null,
  payee_name varchar(200) not null,
  payee_account varchar(200) not null,
  purpose varchar(300) not null,
  amount_kobo bigint not null check (amount_kobo > 0),
  status public.disbursement_status not null default 'instructed',
  instructed_by uuid not null references public.profiles (id) on delete restrict,
  instructed_at timestamptz not null default now(),
  executed_by uuid references public.profiles (id) on delete restrict,
  executed_at timestamptz,
  trustee_reference varchar(120) unique,
  journal_entry_id uuid unique references public.journal_entries (id)
);
create index disbursements_milestone_idx on public.disbursements (milestone_id);

/**
 * Turns a verified milestone into payment instructions. p_lines is a JSON array of
 * { payee_kind, payee_name, payee_account, purpose, amount_kobo } that must add up
 * exactly to the milestone amount.
 */
create function public.instruct_milestone_release(p_milestone_id uuid, p_lines jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  m public.milestones;
  line jsonb;
  total bigint := 0;
  cash bigint := 0;
  amount bigint;
  n int := 0;
begin
  if not public.is_cycle_manager() then
    raise exception 'Only cycle or programme managers can instruct releases' using errcode = 'PT403';
  end if;
  select * into m from public.milestones where id = p_milestone_id for update;
  if not found then
    raise exception 'Milestone not found' using errcode = 'PT404';
  end if;
  if m.status <> 'verified' then
    raise exception 'Only a verified milestone can be released (this one is %)', m.status
      using errcode = 'PT409';
  end if;
  if exists (select 1 from public.disbursements where milestone_id = p_milestone_id and status <> 'cancelled') then
    raise exception 'Release instructions for this milestone already exist' using errcode = 'PT409';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one payee' using errcode = 'PT400';
  end if;

  for line in select * from jsonb_array_elements(p_lines) loop
    if (line ->> 'amount_kobo') !~ '^[0-9]+$' or (line ->> 'amount_kobo')::bigint = 0 then
      raise exception 'Each payment must be a positive whole number of kobo' using errcode = 'PT400';
    end if;
    if coalesce(trim(line ->> 'payee_name'), '') = '' or coalesce(trim(line ->> 'payee_account'), '') = ''
       or coalesce(trim(line ->> 'purpose'), '') = '' then
      raise exception 'Each payment needs a payee, their account and a purpose' using errcode = 'PT400';
    end if;
    amount := (line ->> 'amount_kobo')::bigint;
    total := total + amount;
    if line ->> 'payee_kind' = 'farmer_cash' then
      cash := cash + amount;
    end if;
    insert into public.disbursements (
      cycle_id, milestone_id, payee_kind, payee_name, payee_account, purpose, amount_kobo, instructed_by
    ) values (
      m.cycle_id, m.id, (line ->> 'payee_kind')::public.payee_kind, trim(line ->> 'payee_name'),
      trim(line ->> 'payee_account'), trim(line ->> 'purpose'), amount, auth.uid()
    );
    n := n + 1;
  end loop;

  if total <> m.amount_kobo then
    raise exception 'Payments add up to ₦% but the milestone is ₦%',
      to_char(total / 100.0, 'FM999,999,999,990.00'), to_char(m.amount_kobo / 100.0, 'FM999,999,999,990.00')
      using errcode = 'PT400';
  end if;
  if cash > m.amount_kobo * private.max_cash_share() then
    raise exception 'Cash to farmers is limited to % of a milestone; pay inputs to vendors instead',
      to_char(private.max_cash_share() * 100, 'FM990') || '%' using errcode = 'PT400';
  end if;

  perform private.log_cycle_event(m.cycle_id, 'release_instructed',
    format('Release of ₦%s instructed for milestone %s (%s) to %s payee(s)',
      to_char(total / 100.0, 'FM999,999,999,990.00'), m.sequence, m.name, n),
    jsonb_build_object('milestone_id', m.id));
  return n;
end $$;

/** The trustee confirms it has made a payment. Posts it to the ledger. */
create function public.confirm_disbursement(p_disbursement_id uuid, p_trustee_reference text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.disbursements;
  m public.milestones;
  cash_account uuid;
  entry uuid;
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can confirm payments' using errcode = 'PT403';
  end if;
  if coalesce(trim(p_trustee_reference), '') = '' then
    raise exception 'The trustee''s payment reference is required' using errcode = 'PT400';
  end if;
  select * into d from public.disbursements where id = p_disbursement_id for update;
  if not found then
    raise exception 'Payment instruction not found' using errcode = 'PT404';
  end if;
  if d.status <> 'instructed' then
    raise exception 'This payment is already %', d.status using errcode = 'PT409';
  end if;
  -- Lock the cycle so two confirmations can't both spend the same cash.
  perform 1 from public.cycles where id = d.cycle_id for update;

  cash_account := private.cycle_account(d.cycle_id, 'TRUSTEE_CASH');
  if private.account_balance(cash_account) < d.amount_kobo then
    raise exception 'The trustee does not hold enough of this cycle''s cash for this payment'
      using errcode = 'PT409';
  end if;

  entry := private.post_journal_entry(
    d.cycle_id,
    left(format('%s: %s', d.payee_name, d.purpose), 300),
    auth.uid(),
    jsonb_build_array(
      jsonb_build_object('account_id', private.cycle_account(d.cycle_id, 'FARM_DEPLOYMENT'),
                         'amount_kobo', d.amount_kobo::text, 'memo', d.payee_kind::text),
      jsonb_build_object('account_id', cash_account, 'amount_kobo', (-d.amount_kobo)::text)),
    trim(p_trustee_reference));

  update public.disbursements
     set status = 'executed', executed_by = auth.uid(), executed_at = now(),
         trustee_reference = trim(p_trustee_reference), journal_entry_id = entry
   where id = d.id;

  if not exists (select 1 from public.disbursements
                  where milestone_id = d.milestone_id and status = 'instructed') then
    update public.milestones set status = 'released', released_at = now()
     where id = d.milestone_id returning * into m;
    update public.cycles set status = 'in_progress' where id = d.cycle_id and status = 'funded';
    perform private.log_cycle_event(d.cycle_id, 'milestone_released',
      format('Milestone %s (%s) released in full', m.sequence, m.name),
      jsonb_build_object('milestone_id', m.id));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Access: all of these are written only through the functions above
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['funding_contributions', 'field_visits', 'disbursements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.is_cycle_reader()))',
      t || '_read', t);
  end loop;
end $$;

/** Funding progress per cycle. */
create view public.cycle_funding with (security_invoker = true) as
select c.id as cycle_id,
       c.target_amount_kobo,
       coalesce(sum(fc.amount_kobo) filter (where fc.refund_entry_id is null), 0)::bigint as raised_kobo,
       count(fc.id) filter (where fc.refund_entry_id is null) as contributions
  from public.cycles c
  left join public.funding_contributions fc on fc.cycle_id = c.id
 group by c.id;

revoke all on public.cycle_funding from anon, authenticated;
grant select on public.cycle_funding to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.record_funding(uuid, text, public.funder_kind, bigint, text, date),
  public.refund_cycle(uuid, text),
  public.request_milestone_verification(uuid),
  public.record_field_visit(uuid, uuid, float8, float8, numeric, public.crop_condition, boolean, text[], text, timestamptz),
  public.instruct_milestone_release(uuid, jsonb),
  public.confirm_disbursement(uuid, text)
to authenticated;
