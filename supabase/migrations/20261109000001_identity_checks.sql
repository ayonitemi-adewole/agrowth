-- =============================================================================
-- Agrowth 2.0 — identity checks: BVN and NIN verified with an identity provider
--
-- Until now compliance verified farmers and investors by looking at their documents.
-- Now each NIN or BVN is looked up with an identity provider (Dojah, or a simulated
-- provider for demos), through the "identity-check" Edge Function:
--
--   1. The caller (an enroller or compliance for farmers; the investor themself or
--      compliance for investors) asks the function to check a number.
--   2. start_identity_check, run as that caller, confirms they may, and that the number
--      is the one on record (it must hash to the stored fingerprint). It opens a
--      pending check and returns the details to compare against.
--   3. The function asks the provider, compares, and records the outcome with
--      complete_identity_check. Only the service role can call that, so nobody can
--      write a result by hand.
--
-- Only the outcome is kept: match or not for each field. The provider's copy of the
-- person's details (names, photo, phone) is never stored.
--
-- Verifying KYC now needs a matching check for every identity number on record. When
-- that isn't possible (the provider is down, a phone number changed), compliance can
-- still verify, but must write down why.
-- =============================================================================

create type public.identity_subject as enum ('farmer', 'investor');
create type public.identity_number_type as enum ('nin', 'bvn');
create type public.identity_check_status as enum (
  'pending',    -- asked; the provider hasn't answered yet
  'match',      -- the provider's record matches on every field compared
  'partial',    -- some fields match, some don't (e.g. a changed phone number)
  'no_match',   -- the number belongs to someone else
  'not_found',  -- the provider has no record of this number
  'error'       -- the provider couldn't be reached or refused; try again
);

create table public.identity_checks (
  id uuid primary key default gen_random_uuid(),
  subject public.identity_subject not null,
  farmer_id uuid references public.farmers (id) on delete restrict,
  investor_id uuid references public.investor_profiles (user_id) on delete restrict,
  number_type public.identity_number_type not null,
  -- e.g. 'dojah', or 'mock' for the simulated provider.
  provider varchar(40) not null check (provider ~ '^[a-z0-9_-]{2,40}$'),
  status public.identity_check_status not null default 'pending',
  -- Per field: true (matches), false (differs) or null (not compared), e.g.
  -- {"first_name": true, "last_name": true, "date_of_birth": false, "phone": null}.
  fields jsonb check (fields is null or jsonb_typeof(fields) = 'object'),
  provider_reference varchar(120),
  error_message varchar(500),
  requested_by uuid not null references public.profiles (id) on delete restrict,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((subject = 'farmer') = (farmer_id is not null)),
  check ((subject = 'investor') = (investor_id is not null)),
  check ((status = 'pending') = (completed_at is null))
);

create index identity_checks_farmer_idx on public.identity_checks (farmer_id, requested_at desc);
create index identity_checks_investor_idx on public.identity_checks (investor_id, requested_at desc);

alter table public.identity_checks enable row level security;
revoke all on public.identity_checks from anon, authenticated;
grant select on public.identity_checks to authenticated;

create policy identity_checks_read on public.identity_checks for select to authenticated
  using (
    case subject
      when 'farmer' then (select public.is_registry_reader())
      else investor_id = (select auth.uid())
        or (select public.is_kyc_reviewer())
        or (select public.has_any_role(array['auditor']::public.user_role[]))
    end
  );

-- The KYC decision on a farmer, for the record.
alter table public.farmers
  add column kyc_note text check (length(kyc_note) <= 2000),
  add column kyc_reviewed_by uuid references public.profiles (id) on delete restrict,
  add column kyc_reviewed_at timestamptz;

-- -----------------------------------------------------------------------------
-- Checking a number
-- -----------------------------------------------------------------------------

/**
 * Opens a check of one identity number, after confirming the caller may check this
 * person and that the number is the one on record. Returns the check's id and the
 * details the provider's record is compared with.
 */
create function public.start_identity_check(
  p_subject public.identity_subject,
  p_subject_id uuid,
  p_number_type public.identity_number_type,
  p_number text,
  p_provider text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  num text := regexp_replace(coalesce(p_number, ''), '[\s-]', '', 'g');
  num_h text;
  on_record text;
  claimed jsonb;
  recent int;
  new_id uuid;
begin
  if num !~ '^[0-9]{11}$' then
    raise exception 'A % is 11 digits', upper(p_number_type::text) using errcode = 'PT400';
  end if;

  if p_subject = 'farmer' then
    if not (public.is_enroller() or public.is_kyc_reviewer()) then
      raise exception 'Your role cannot check farmers'' identities' using errcode = 'PT403';
    end if;
    select case p_number_type when 'nin' then fi.nin_hash else fi.bvn_hash end,
           jsonb_build_object(
             'first_name', f.first_name,
             'last_name', f.last_name,
             'full_name', f.full_name,
             'date_of_birth', f.date_of_birth,
             'phone', f.phone)
      into on_record, claimed
      from public.farmers f join private.farmer_identities fi on fi.farmer_id = f.id
     where f.id = p_subject_id;
    if claimed is null then
      raise exception 'Farmer not found' using errcode = 'PT404';
    end if;
  else
    if not ((public.is_investor() and p_subject_id = auth.uid()) or public.is_kyc_reviewer()) then
      raise exception 'You can only check your own identity' using errcode = 'PT403';
    end if;
    select case p_number_type when 'nin' then ip.nin_hash else ip.bvn_hash end,
           jsonb_build_object('full_name', ip.legal_name)
      into on_record, claimed
      from public.investor_profiles ip
     where ip.user_id = p_subject_id;
    if claimed is null then
      raise exception 'Submit your KYC details first' using errcode = 'PT404';
    end if;
  end if;

  if on_record is null then
    raise exception 'No % is on record for this person', upper(p_number_type::text)
      using errcode = 'PT400';
  end if;
  num_h := private.hash_identifier(num);
  if num_h <> on_record then
    raise exception 'This % is not the one on record', upper(p_number_type::text)
      using errcode = 'PT400';
  end if;

  -- Each lookup is billed by the provider, so a runaway retry loop is cut off.
  select count(*) into recent from public.identity_checks
   where coalesce(farmer_id, investor_id) = p_subject_id
     and number_type = p_number_type
     and requested_at > now() - interval '24 hours';
  if recent >= 5 then
    raise exception 'This % has been checked 5 times today. Try again tomorrow.',
      upper(p_number_type::text) using errcode = 'PT429';
  end if;

  insert into public.identity_checks (
    subject, farmer_id, investor_id, number_type, provider, requested_by
  ) values (
    p_subject,
    case when p_subject = 'farmer' then p_subject_id end,
    case when p_subject = 'investor' then p_subject_id end,
    p_number_type, lower(trim(p_provider)), auth.uid()
  ) returning id into new_id;

  return jsonb_build_object('check_id', new_id, 'claimed', claimed);
end $$;

/** Records the provider's answer. Only the identity-check function (service role) can. */
create function public.complete_identity_check(
  p_check_id uuid,
  p_status public.identity_check_status,
  p_fields jsonb default null,
  p_provider_reference text default null,
  p_error_message text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
     <> 'service_role' then
    raise exception 'Only the identity service can record a result' using errcode = 'PT403';
  end if;
  if p_status = 'pending' then
    raise exception 'A result cannot be pending' using errcode = 'PT400';
  end if;
  update public.identity_checks
     set status = p_status,
         fields = p_fields,
         provider_reference = left(nullif(trim(p_provider_reference), ''), 120),
         error_message = left(nullif(trim(p_error_message), ''), 500),
         completed_at = now()
   where id = p_check_id and status = 'pending';
  if not found then
    raise exception 'No pending check with this id' using errcode = 'PT404';
  end if;
end $$;

/**
 * True when every identity number on record has a matching check: the most recent
 * answered check of each number is a match. For investors only checks made since
 * they last submitted their details count, as they may have changed the numbers.
 */
create function private.identity_confirmed(p_subject public.identity_subject, p_subject_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  with on_record as (
    select t.number_type
      from (
        select 'nin'::public.identity_number_type as number_type, fi.nin_hash as h
          from private.farmer_identities fi
         where p_subject = 'farmer' and fi.farmer_id = p_subject_id
        union all
        select 'bvn', fi.bvn_hash
          from private.farmer_identities fi
         where p_subject = 'farmer' and fi.farmer_id = p_subject_id
        union all
        select 'nin', ip.nin_hash
          from public.investor_profiles ip
         where p_subject = 'investor' and ip.user_id = p_subject_id
        union all
        select 'bvn', ip.bvn_hash
          from public.investor_profiles ip
         where p_subject = 'investor' and ip.user_id = p_subject_id
      ) t
     where t.h is not null
  ),
  latest as (
    select distinct on (c.number_type) c.number_type, c.status
      from public.identity_checks c
     where coalesce(c.farmer_id, c.investor_id) = p_subject_id
       and c.subject = p_subject
       and c.status <> 'pending'
       and (p_subject = 'farmer' or c.requested_at >= (
              select ip.submitted_at from public.investor_profiles ip
               where ip.user_id = p_subject_id))
     order by c.number_type, c.requested_at desc
  )
  select exists (select 1 from on_record)
     and not exists (
       select 1 from on_record r left join latest l using (number_type)
        where l.status is distinct from 'match')
$$;

-- -----------------------------------------------------------------------------
-- KYC decisions now look at the checks
-- -----------------------------------------------------------------------------

drop function public.set_farmer_kyc(uuid, public.kyc_status);

create function public.set_farmer_kyc(
  p_farmer_id uuid,
  p_status public.kyc_status,
  p_note text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  note text := nullif(trim(p_note), '');
begin
  if not public.is_kyc_reviewer() then
    raise exception 'Only compliance can make KYC decisions' using errcode = 'PT403';
  end if;
  if not exists (select 1 from public.farmers where id = p_farmer_id) then
    raise exception 'Farmer not found' using errcode = 'PT404';
  end if;
  if p_status = 'verified' and note is null
     and not private.identity_confirmed('farmer', p_farmer_id) then
    raise exception 'Not every NIN or BVN on record has a matching identity check. Run the check, or note why you are verifying without one.'
      using errcode = 'PT400';
  end if;
  update public.farmers
     set kyc_status = p_status,
         kyc_note = note,
         kyc_reviewed_by = auth.uid(),
         kyc_reviewed_at = now()
   where id = p_farmer_id;
end $$;

create or replace function public.review_investor_kyc(
  p_user_id uuid,
  p_approve boolean,
  p_classification public.investor_class default null,
  p_note text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  ip public.investor_profiles;
begin
  if not public.is_kyc_reviewer() then
    raise exception 'Only compliance can review investors' using errcode = 'PT403';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot review your own KYC' using errcode = 'PT400';
  end if;
  select * into ip from public.investor_profiles where user_id = p_user_id for update;
  if not found then
    raise exception 'Investor not found' using errcode = 'PT404';
  end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then
    raise exception 'Say why the KYC is rejected, so the investor can fix it' using errcode = 'PT400';
  end if;
  if p_approve and coalesce(trim(p_note), '') = ''
     and not private.identity_confirmed('investor', p_user_id) then
    raise exception 'The NIN and BVN don''t both have a matching identity check. Run the check, or note why you are verifying without one.'
      using errcode = 'PT400';
  end if;
  update public.investor_profiles
     set kyc_status = case when p_approve then 'verified' else 'rejected' end::public.kyc_status,
         classification = case when p_approve then coalesce(p_classification, ip.declared_class) end,
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         review_note = nullif(trim(p_note), '')
   where user_id = p_user_id;
end $$;

-- -----------------------------------------------------------------------------
-- Function permissions
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function
  public.complete_identity_check(uuid, public.identity_check_status, jsonb, text, text)
from authenticated;
grant execute on function
  public.complete_identity_check(uuid, public.identity_check_status, jsonb, text, text)
to service_role;
grant execute on function
  public.start_identity_check(public.identity_subject, uuid, public.identity_number_type, text, text),
  public.set_farmer_kyc(uuid, public.kyc_status, text),
  public.review_investor_kyc(uuid, boolean, public.investor_class, text)
to authenticated;
