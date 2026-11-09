-- =============================================================================
-- Agrowth 2.0 — insurance claims
--
-- Until now an insurance payout was just money the trustee recorded against a cycle's
-- policy. Now a claim runs its course, on the record:
--
--   1. Reported: the cycle manager or a field agent reports a loss: the cause, when it
--      started, the farms hit and how badly. The weather over the loss period (against
--      the 10-year normal) and the farms' latest field visits are copied into the claim
--      as evidence, so it shows what was known when it was made.
--   2. Notified: the insurer has been told, and its claim number is noted. Policies set
--      a notice period; notice more than 14 days after the loss began is flagged.
--   3. Assessed: the insurer's loss assessor's findings, and the amount it approves,
--      never more than the cover left on the policy.
--   4. Paid: the trustee records the insurer's payment against the claim. It goes to the
--      cycle's cash like any receipt, and into the settlement waterfall.
--   Or rejected (the insurer declines) or withdrawn (no claim after all), with a reason.
--
-- An insurance payout can now only be recorded through its claim.
-- =============================================================================

create type public.claim_cause as enum (
  'drought', 'flood', 'storm', 'pests', 'disease', 'fire', 'theft', 'other'
);
create type public.claim_status as enum (
  'reported', 'notified', 'assessed', 'paid', 'rejected', 'withdrawn'
);

create table public.insurance_claims (
  id uuid primary key default gen_random_uuid(),
  -- CLM- and 8 characters, e.g. CLM-7KQ2MX4P.
  reference varchar(20) not null unique,
  cycle_id uuid not null references public.cycles (id) on delete restrict,
  policy_id uuid not null references public.insurance_policies (id) on delete restrict,
  cause public.claim_cause not null,
  loss_from date not null,
  -- Null while the loss is still going on.
  loss_to date,
  description text not null check (length(trim(description)) between 20 and 3000),
  -- The operator's own estimate when reporting, before any assessment.
  estimated_loss_kobo bigint check (estimated_loss_kobo > 0),
  status public.claim_status not null default 'reported',
  reported_by uuid not null references public.profiles (id) on delete restrict,
  reported_at timestamptz not null default now(),
  -- Copied in when reported, and never changed.
  weather_evidence jsonb not null default '[]',
  visit_evidence jsonb not null default '[]',
  notified_on date,
  insurer_claim_number varchar(100),
  notified_by uuid references public.profiles (id) on delete restrict,
  assessed_on date,
  assessor varchar(200),
  assessed_loss_kobo bigint check (assessed_loss_kobo >= 0),
  approved_kobo bigint check (approved_kobo > 0),
  assessment_notes text check (length(assessment_notes) <= 3000),
  assessed_by uuid references public.profiles (id) on delete restrict,
  paid_kobo bigint check (paid_kobo > 0),
  closed_reason text check (length(closed_reason) <= 1000),
  closed_by uuid references public.profiles (id) on delete restrict,
  closed_at timestamptz,
  -- Photos, the assessor's report and correspondence, in the "claim-documents" bucket.
  document_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (loss_to is null or loss_to >= loss_from),
  check ((status in ('notified', 'assessed', 'paid')) <= (notified_on is not null)),
  check ((status in ('assessed', 'paid')) = (approved_kobo is not null)),
  check ((status = 'paid') = (paid_kobo is not null)),
  check ((status in ('rejected', 'withdrawn')) = (closed_at is not null))
);
create index insurance_claims_cycle_idx on public.insurance_claims (cycle_id, reported_at);
create index insurance_claims_open_idx on public.insurance_claims (status)
  where status in ('reported', 'notified', 'assessed');

create trigger insurance_claims_touch before update on public.insurance_claims
for each row execute function private.touch_updated_at();

/** The farms a claim covers, and the share of each one's crop thought lost. */
create table public.insurance_claim_farms (
  claim_id uuid not null references public.insurance_claims (id) on delete restrict,
  farm_id uuid not null references public.farms (id) on delete restrict,
  estimated_loss_pct int not null check (estimated_loss_pct between 1 and 100),
  primary key (claim_id, farm_id)
);

do $$
declare
  t text;
begin
  foreach t in array array['insurance_claims', 'insurance_claim_farms'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated
                      using ((select public.is_cycle_reader()))', t || '_read', t);
  end loop;
end $$;

-- An insurance payout is recorded through its claim; the receipt points back to it.
alter table public.cycle_receipts
  add column insurance_claim_id uuid unique references public.insurance_claims (id) on delete restrict;

-- -----------------------------------------------------------------------------
-- Evidence, copied into a claim when it's reported
-- -----------------------------------------------------------------------------

/**
 * The weather at the claim's farms over the loss period: for each weather cell, the days
 * on record, rain against the normal, the longest run of dry days (under 1 mm) and the
 * hottest day. The period ends yesterday if the loss is still going on.
 */
create function private.claim_weather_evidence(p_farm_ids uuid[], p_from date, p_to date)
returns jsonb
language sql stable set search_path = '' as $$
  with cells as (
    select wc.id, wc.lat, wc.lon, count(*) as farms
      from public.farms f
      cross join lateral private.cell_key(f.centroid) k
      join public.weather_cells wc on wc.lat = k.lat and wc.lon = k.lon
     where f.id = any (p_farm_ids)
     group by wc.id
  ),
  days as (
    select w.cell_id, w.day, w.rain_mm, w.tmax_c,
           w.day - (row_number() over (partition by w.cell_id, w.rain_mm < 1 order by w.day))::int as run
      from public.weather_daily w
      join cells c on c.id = w.cell_id
     where not w.is_forecast and w.day between p_from and p_to
  ),
  dry_runs as (
    select cell_id, max(n) as longest
      from (select cell_id, run, count(*) as n from days where rain_mm < 1 group by cell_id, run) r
     group by cell_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'lat', c.lat, 'lon', c.lon, 'farms', c.farms,
           'from', p_from, 'to', p_to,
           'days_with_data', (select count(*) from days d where d.cell_id = c.id),
           'rain_mm', (select coalesce(sum(rain_mm), 0) from days d where d.cell_id = c.id),
           'normal_mm', private.normal_rain(c.id, p_from, p_to),
           'longest_dry_run_days', coalesce((select longest from dry_runs r where r.cell_id = c.id), 0),
           'max_tmax_c', (select max(tmax_c) from days d where d.cell_id = c.id))
         order by c.farms desc), '[]')
    from cells c
$$;

/** The latest field visit to each of the claim's farms, from 30 days before the loss on. */
create function private.claim_visit_evidence(p_farm_ids uuid[], p_from date) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(v order by v ->> 'visited_at'), '[]')
    from (
      select distinct on (fv.farm_id) jsonb_build_object(
               'farm_id', fv.farm_id,
               'farm', coalesce(f.name, 'Farm'),
               'farmer', fr.full_name,
               'visit_id', fv.id,
               'visited_at', fv.visited_at,
               'crop_condition', fv.crop_condition,
               'passed', fv.passed,
               'photos', cardinality(fv.photo_paths),
               'notes', left(fv.notes, 300)) as v
        from public.field_visits fv
        join public.farms f on f.id = fv.farm_id
        join public.farmers fr on fr.id = f.farmer_id
       where fv.farm_id = any (p_farm_ids) and fv.visited_at >= p_from - 30
       order by fv.farm_id, fv.visited_at desc
    ) latest
$$;

-- -----------------------------------------------------------------------------
-- The claim's steps
-- -----------------------------------------------------------------------------

/** Who reports losses: cycle managers, and the field agents who see the farms. */
create function public.can_report_claim() returns boolean
language sql stable set search_path = '' as $$
  select public.is_cycle_manager() or public.is_enroller()
$$;

create function private.new_claim_reference() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea;
  ref text;
begin
  loop
    bytes := extensions.gen_random_bytes(8);
    ref := 'CLM-';
    for i in 0..7 loop
      ref := ref || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.insurance_claims where reference = ref);
  end loop;
  return ref;
end $$;

/**
 * Reports a loss on a cycle. p_farms is a JSON array of { farm_id, loss_pct }. The policy
 * is the cycle's one whose cover includes the day the loss began. Returns the claim's id.
 */
create function public.report_insurance_claim(
  p_cycle_id uuid,
  p_cause public.claim_cause,
  p_loss_from date,
  p_description text,
  p_farms jsonb,
  p_loss_to date default null,
  p_estimated_loss_kobo bigint default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cycles;
  policy public.insurance_policies;
  today date := private.lagos_today();
  farm jsonb;
  farm_ids uuid[] := '{}';
  new_id uuid;
begin
  if not public.can_report_claim() then
    raise exception 'Your role cannot report losses' using errcode = 'PT403';
  end if;
  select * into c from public.cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'Cycle not found' using errcode = 'PT404';
  end if;
  if c.status not in ('funded', 'in_progress', 'harvested') then
    raise exception 'Losses can be claimed while a cycle is funded, under way or harvested (this one is %)',
      c.status using errcode = 'PT409';
  end if;
  if p_loss_from is null or p_loss_from > today then
    raise exception 'When did the loss begin? It can''t be in the future' using errcode = 'PT400';
  end if;
  if p_loss_to is not null and (p_loss_to < p_loss_from or p_loss_to > today) then
    raise exception 'The loss must end after it began, and not in the future' using errcode = 'PT400';
  end if;
  if length(trim(coalesce(p_description, ''))) < 20 then
    raise exception 'Describe what happened in a sentence or two' using errcode = 'PT400';
  end if;
  select * into policy from public.insurance_policies
   where cycle_id = p_cycle_id and p_loss_from between cover_start and cover_end
   order by cover_start limit 1;
  if not found then
    raise exception 'No insurance policy on this cycle covers %', to_char(p_loss_from, 'DD Mon YYYY')
      using errcode = 'PT400';
  end if;
  if jsonb_typeof(p_farms) <> 'array' or jsonb_array_length(p_farms) = 0 then
    raise exception 'Choose the farms hit' using errcode = 'PT400';
  end if;

  insert into public.insurance_claims (
    reference, cycle_id, policy_id, cause, loss_from, loss_to, description,
    estimated_loss_kobo, reported_by
  ) values (
    private.new_claim_reference(), p_cycle_id, policy.id, p_cause, p_loss_from, p_loss_to,
    trim(p_description), p_estimated_loss_kobo, auth.uid()
  ) returning id into new_id;

  for farm in select * from jsonb_array_elements(p_farms) loop
    if not exists (select 1 from public.cycle_farms
                    where cycle_id = p_cycle_id and farm_id = (farm ->> 'farm_id')::uuid) then
      raise exception 'A farm chosen is not in this cycle' using errcode = 'PT400';
    end if;
    if coalesce(farm ->> 'loss_pct', '') !~ '^[0-9]+$'
       or (farm ->> 'loss_pct')::int not between 1 and 100 then
      raise exception 'Give each farm''s estimated loss as 1 to 100%%' using errcode = 'PT400';
    end if;
    insert into public.insurance_claim_farms (claim_id, farm_id, estimated_loss_pct)
    values (new_id, (farm ->> 'farm_id')::uuid, (farm ->> 'loss_pct')::int);
    farm_ids := farm_ids || (farm ->> 'farm_id')::uuid;
  end loop;

  update public.insurance_claims
     set weather_evidence = private.claim_weather_evidence(
           farm_ids, p_loss_from, coalesce(p_loss_to, greatest(p_loss_from, today - 1))),
         visit_evidence = private.claim_visit_evidence(farm_ids, p_loss_from)
   where id = new_id;

  perform private.log_cycle_event(p_cycle_id, 'claim_reported',
    format('Loss reported (%s) on %s farm(s), from %s', p_cause, cardinality(farm_ids),
           to_char(p_loss_from, 'DD Mon YYYY')),
    jsonb_build_object('claim_id', new_id));
  return new_id;
end $$;

create function private.claim_for_update(p_claim_id uuid) returns public.insurance_claims
language plpgsql set search_path = '' as $$
declare
  cl public.insurance_claims;
begin
  select * into cl from public.insurance_claims where id = p_claim_id for update;
  if not found then
    raise exception 'Claim not found' using errcode = 'PT404';
  end if;
  return cl;
end $$;

/** The insurer has been told. Returns a warning if the notice was late, else null. */
create function public.notify_insurance_claim(
  p_claim_id uuid,
  p_notified_on date,
  p_insurer_claim_number text default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  cl public.insurance_claims;
  late text;
begin
  if not public.is_cycle_manager() then
    raise exception 'Only cycle managers deal with the insurer' using errcode = 'PT403';
  end if;
  cl := private.claim_for_update(p_claim_id);
  if cl.status <> 'reported' then
    raise exception 'This claim is already %', cl.status using errcode = 'PT409';
  end if;
  if p_notified_on is null or p_notified_on < cl.loss_from or p_notified_on > private.lagos_today() then
    raise exception 'The insurer is told on or after the day the loss began, and not in the future'
      using errcode = 'PT400';
  end if;
  if p_notified_on - cl.loss_from > 14 then
    late := format('Notice given %s days after the loss began. Most policies ask for notice within 14 days; the insurer may refuse a late claim.',
                   p_notified_on - cl.loss_from);
  end if;
  update public.insurance_claims
     set status = 'notified', notified_on = p_notified_on,
         insurer_claim_number = nullif(trim(p_insurer_claim_number), ''), notified_by = auth.uid()
   where id = cl.id;
  perform private.log_cycle_event(cl.cycle_id, 'claim_notified',
    format('Insurer notified of claim %s%s', cl.reference,
           coalesce(' (insurer''s number ' || nullif(trim(p_insurer_claim_number), '') || ')', '')),
    jsonb_build_object('claim_id', cl.id));
  return late;
end $$;

/** What the insurer's assessor found, and what the insurer approves. */
create function public.record_claim_assessment(
  p_claim_id uuid,
  p_assessed_on date,
  p_assessor text,
  p_approved_kobo bigint,
  p_assessed_loss_kobo bigint default null,
  p_notes text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  cl public.insurance_claims;
  policy public.insurance_policies;
  committed bigint;
begin
  if not public.is_cycle_manager() then
    raise exception 'Only cycle managers deal with the insurer' using errcode = 'PT403';
  end if;
  cl := private.claim_for_update(p_claim_id);
  if cl.status <> 'notified' then
    raise exception 'Only a claim the insurer has been told about can be assessed (this one is %)',
      cl.status using errcode = 'PT409';
  end if;
  if p_assessed_on is null or p_assessed_on < cl.notified_on or p_assessed_on > private.lagos_today() then
    raise exception 'The assessment is dated on or after the insurer was told, and not in the future'
      using errcode = 'PT400';
  end if;
  if coalesce(trim(p_assessor), '') = '' then
    raise exception 'Name the loss assessor' using errcode = 'PT400';
  end if;
  if coalesce(p_approved_kobo, 0) <= 0 then
    raise exception 'Enter the amount the insurer approves; if it approves nothing, record the claim as rejected'
      using errcode = 'PT400';
  end if;
  select * into policy from public.insurance_policies where id = cl.policy_id;
  select coalesce(sum(coalesce(paid_kobo, approved_kobo)), 0) into committed
    from public.insurance_claims
   where policy_id = cl.policy_id and id <> cl.id and status in ('assessed', 'paid');
  if committed + p_approved_kobo > policy.sum_insured_kobo then
    raise exception 'That is more than the cover left on the policy: % of % is already approved',
      private.format_naira(committed), private.format_naira(policy.sum_insured_kobo)
      using errcode = 'PT400';
  end if;
  update public.insurance_claims
     set status = 'assessed', assessed_on = p_assessed_on, assessor = trim(p_assessor),
         approved_kobo = p_approved_kobo, assessed_loss_kobo = p_assessed_loss_kobo,
         assessment_notes = nullif(trim(p_notes), ''), assessed_by = auth.uid()
   where id = cl.id;
  perform private.log_cycle_event(cl.cycle_id, 'claim_assessed',
    format('Claim %s assessed: the insurer approves %s', cl.reference,
           private.format_naira(p_approved_kobo)),
    jsonb_build_object('claim_id', cl.id));
end $$;

/** The insurer declined the claim, or the operator withdrew it. */
create function public.close_insurance_claim(
  p_claim_id uuid,
  p_outcome public.claim_status,
  p_reason text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  cl public.insurance_claims;
begin
  if not public.is_cycle_manager() then
    raise exception 'Only cycle managers deal with the insurer' using errcode = 'PT403';
  end if;
  if p_outcome not in ('rejected', 'withdrawn') then
    raise exception 'A claim is closed as rejected or withdrawn' using errcode = 'PT400';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give the reason, for the record' using errcode = 'PT400';
  end if;
  cl := private.claim_for_update(p_claim_id);
  if p_outcome = 'rejected' and cl.status not in ('notified', 'assessed') then
    raise exception 'Only the insurer can reject a claim, once it has been told' using errcode = 'PT409';
  end if;
  if p_outcome = 'withdrawn' and cl.status not in ('reported', 'notified') then
    raise exception 'A claim can be withdrawn before it is assessed' using errcode = 'PT409';
  end if;
  update public.insurance_claims
     set status = p_outcome, approved_kobo = null, closed_reason = trim(p_reason),
         closed_by = auth.uid(), closed_at = now()
   where id = cl.id;
  perform private.log_cycle_event(cl.cycle_id, 'claim_closed',
    format('Claim %s %s: %s', cl.reference, p_outcome, trim(p_reason)),
    jsonb_build_object('claim_id', cl.id));
end $$;

/**
 * The trustee records the insurer's payment of an assessed claim: a receipt to the cycle,
 * posted to the ledger like any other. At most the approved amount.
 */
create function public.record_claim_payout(
  p_claim_id uuid,
  p_amount_kobo bigint,
  p_trustee_reference text,
  p_received_on date default current_date
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  cl public.insurance_claims;
  receipt uuid;
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can record money received' using errcode = 'PT403';
  end if;
  cl := private.claim_for_update(p_claim_id);
  if cl.status <> 'assessed' then
    raise exception 'Only an assessed claim can be paid (this one is %)', cl.status using errcode = 'PT409';
  end if;
  if coalesce(p_amount_kobo, 0) <= 0 or p_amount_kobo > cl.approved_kobo then
    raise exception 'The payment must be more than nothing and no more than the % approved',
      private.format_naira(cl.approved_kobo) using errcode = 'PT400';
  end if;
  if p_received_on < cl.assessed_on then
    raise exception 'The payment can''t be dated before the assessment' using errcode = 'PT400';
  end if;

  perform set_config('agrowth.claim_id', cl.id::text, true);
  receipt := public.record_cycle_receipt(cl.cycle_id, 'insurance_payout', cl.policy_id,
    p_amount_kobo, p_trustee_reference, p_received_on,
    format('Claim %s%s', cl.reference, coalesce(', insurer''s claim ' || cl.insurer_claim_number, '')));
  perform set_config('agrowth.claim_id', '', true);

  update public.insurance_claims set status = 'paid', paid_kobo = p_amount_kobo where id = cl.id;
  perform private.log_cycle_event(cl.cycle_id, 'claim_paid',
    format('Claim %s paid: %s received from the insurer', cl.reference,
           private.format_naira(p_amount_kobo)),
    jsonb_build_object('claim_id', cl.id, 'receipt_id', receipt));
  return receipt;
end $$;

/** Insurance payouts only through record_claim_payout, which sets the claim. */
create function private.insurance_payout_needs_claim() returns trigger
language plpgsql set search_path = '' as $$
declare
  claim uuid := nullif(current_setting('agrowth.claim_id', true), '')::uuid;
begin
  if new.kind = 'insurance_payout' then
    if claim is null then
      raise exception 'Insurance payouts are recorded against their claim: open the claim and record the payment there'
        using errcode = 'PT400';
    end if;
    new.insurance_claim_id := claim;
  end if;
  return new;
end $$;

create trigger cycle_receipts_insurance_claim before insert on public.cycle_receipts
for each row execute function private.insurance_payout_needs_claim();

-- -----------------------------------------------------------------------------
-- Documents: photos, the assessor's report, letters
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('claim-documents', 'claim-documents', false)
on conflict (id) do nothing;

/** Uploads go in a folder named after an open claim: <claim id>/<file name>. */
create function public.can_upload_claim_document(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  folder text := split_part(p_name, '/', 1);
begin
  if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.can_report_claim()
     and exists (select 1 from public.insurance_claims
                  where id = folder::uuid and status in ('reported', 'notified', 'assessed'));
end $$;

create policy claim_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'claim-documents' and (select public.is_cycle_reader()));
create policy claim_documents_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'claim-documents' and public.can_upload_claim_document(name));

/** Adds an uploaded file to the claim's documents. */
create function public.add_claim_document(p_claim_id uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  cl public.insurance_claims;
begin
  if not public.can_upload_claim_document(coalesce(p_path, '')) then
    raise exception 'You can''t add documents to this claim' using errcode = 'PT403';
  end if;
  cl := private.claim_for_update(p_claim_id);
  if split_part(p_path, '/', 1) <> cl.id::text then
    raise exception 'That file belongs to another claim' using errcode = 'PT400';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'claim-documents' and name = p_path) then
    raise exception 'Upload the file first' using errcode = 'PT400';
  end if;
  update public.insurance_claims
     set document_paths = array_append(document_paths, p_path)
   where id = cl.id and not (p_path = any (document_paths));
end $$;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.can_report_claim(),
  public.report_insurance_claim(uuid, public.claim_cause, date, text, jsonb, date, bigint),
  public.notify_insurance_claim(uuid, date, text),
  public.record_claim_assessment(uuid, date, text, bigint, bigint, text),
  public.close_insurance_claim(uuid, public.claim_status, text),
  public.record_claim_payout(uuid, bigint, text, date),
  public.can_upload_claim_document(text),
  public.add_claim_document(uuid, text)
to authenticated;
