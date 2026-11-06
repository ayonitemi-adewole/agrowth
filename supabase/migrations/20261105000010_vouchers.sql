-- =============================================================================
-- Agrowth 2.0 — vendor network and input vouchers
--
-- Most of a milestone should reach farmers as inputs, not cash. Vouchers do that
-- without the platform or the cycle manager choosing which shop gets the money:
--
--   1. Vendors (agro-dealers, service providers) are registered by staff and approved
--      by compliance. Changing an approved vendor's bank details sends it back for review.
--   2. A release instruction may include an "input_voucher" line. When the trustee
--      issues it, the money is ring-fenced: Dr VOUCHER_RESERVE / Cr TRUSTEE_CASH. One
--      voucher per farm, split by farm area, each with a code for the farmer.
--   3. At the counter, an approved vendor enters the code and the last four digits of
--      the farmer's phone, then the amount and what was supplied. Wrong guesses are
--      counted, and a vendor is locked out for 15 minutes after 5 of them.
--   4. The trustee pays the vendor's registered account and confirms it:
--      Dr FARM_DEPLOYMENT / Cr VOUCHER_RESERVE.
--   5. Unused value goes back to the cycle's cash when a voucher is closed:
--      Dr TRUSTEE_CASH / Cr VOUCHER_RESERVE. The harvest can't be completed while any
--      voucher is open or any vendor is unpaid, so settlement always starts from a
--      zero reserve.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------

create function public.is_vendor() returns boolean
language sql stable set search_path = '' as $$
  select public.has_any_role(array['vendor']::public.user_role[])
$$;

/** Who registers vendors and edits their details: the same staff who manage cooperatives. */
create function public.is_vendor_editor() returns boolean
language sql stable set search_path = '' as $$
  select public.is_cooperative_editor()
$$;

-- -----------------------------------------------------------------------------
-- Vendors
-- -----------------------------------------------------------------------------

create type public.vendor_kind as enum ('agro_dealer', 'service_provider');
create type public.vendor_status as enum ('pending', 'approved', 'suspended');

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  name varchar(200) not null check (length(trim(name)) >= 2),
  kind public.vendor_kind not null default 'agro_dealer',
  -- CAC or dealer-licence number.
  registration_number varchar(60) unique,
  contact_phone varchar(20) not null check (contact_phone ~ '^\+?[0-9]{10,15}$'),
  contact_email varchar(200),
  state varchar(60) not null check (length(trim(state)) >= 2),
  lga varchar(100) not null check (length(trim(lga)) >= 2),
  address varchar(300),
  -- Where the trustee pays redemptions. Nigerian NUBAN account numbers are 10 digits.
  bank_name varchar(100) not null check (length(trim(bank_name)) >= 2),
  account_number char(10) not null check (account_number ~ '^[0-9]{10}$'),
  account_name varchar(200) not null check (length(trim(account_name)) >= 2),
  status public.vendor_status not null default 'pending',
  status_note text check (length(status_note) <= 2000),
  reviewed_by uuid references public.profiles (id) on delete restrict,
  reviewed_at timestamptz,
  -- The vendor's own sign-in, linked by an admin. One account per vendor.
  user_id uuid unique references public.profiles (id) on delete restrict,
  registered_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vendors_location_idx on public.vendors (state, lga);

create trigger vendors_touch before update on public.vendors
for each row execute function private.touch_updated_at();

/** New bank details need a fresh compliance review before any money goes there. */
create function private.vendor_bank_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.bank_name, new.account_number, new.account_name)
     is distinct from (old.bank_name, old.account_number, old.account_name)
     and old.status = 'approved' then
    new.status := 'pending';
    new.status_note := 'Bank details changed; awaiting review';
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  return new;
end $$;

create trigger vendors_bank_change before update on public.vendors
for each row execute function private.vendor_bank_change();

alter table public.vendors enable row level security;
revoke all on public.vendors from anon, authenticated;
grant select on public.vendors to authenticated;
grant insert (name, kind, registration_number, contact_phone, contact_email, state, lga, address,
              bank_name, account_number, account_name),
      update (name, kind, registration_number, contact_phone, contact_email, state, lga, address,
              bank_name, account_number, account_name)
   on public.vendors to authenticated;

create policy vendors_read on public.vendors for select to authenticated
  using ((select public.is_cycle_reader()) or user_id = (select auth.uid()));
create policy vendors_insert on public.vendors for insert to authenticated
  with check ((select public.is_vendor_editor()));
create policy vendors_update on public.vendors for update to authenticated
  using ((select public.is_vendor_editor()))
  with check ((select public.is_vendor_editor()));

/** Compliance approves or suspends a vendor. Suspension needs a reason. */
create function public.set_vendor_status(
  p_vendor_id uuid, p_status public.vendor_status, p_note text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_kyc_reviewer() then
    raise exception 'Only compliance can approve or suspend vendors' using errcode = 'PT403';
  end if;
  if p_status = 'suspended' and coalesce(trim(p_note), '') = '' then
    raise exception 'Give a reason for suspending this vendor' using errcode = 'PT400';
  end if;
  if exists (select 1 from public.vendors where id = p_vendor_id and registered_by = auth.uid())
     and p_status = 'approved' then
    raise exception 'You registered this vendor, so someone else must approve it' using errcode = 'PT403';
  end if;
  update public.vendors
     set status = p_status, status_note = nullif(trim(p_note), ''),
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_vendor_id;
  if not found then
    raise exception 'Vendor not found' using errcode = 'PT404';
  end if;
end $$;

/** An admin links a vendor to the sign-in its staff use at the counter. */
create function public.link_vendor_account(p_vendor_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  account_role public.user_role;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can link vendor accounts' using errcode = 'PT403';
  end if;
  if p_user_id is not null then
    select role into account_role from public.profiles where id = p_user_id;
    if not found then
      raise exception 'User not found' using errcode = 'PT404';
    end if;
    if account_role <> 'vendor' then
      raise exception 'Give this user the Vendor role first' using errcode = 'PT400';
    end if;
    if exists (select 1 from public.vendors where user_id = p_user_id and id <> p_vendor_id) then
      raise exception 'This account is already linked to another vendor' using errcode = 'PT409';
    end if;
  end if;
  update public.vendors set user_id = p_user_id where id = p_vendor_id;
  if not found then
    raise exception 'Vendor not found' using errcode = 'PT404';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Vouchers
-- -----------------------------------------------------------------------------

create type public.voucher_status as enum ('active', 'redeemed', 'closed');

create table public.vouchers (
  id uuid primary key default gen_random_uuid(),
  -- 12 characters from a 32-letter alphabet with no 0/O or 1/I: 60 random bits.
  code char(12) not null unique check (code ~ '^[A-HJ-NP-Z2-9]{12}$'),
  cycle_id uuid not null references public.cycles (id) on delete restrict,
  milestone_id uuid not null references public.milestones (id) on delete restrict,
  disbursement_id uuid not null references public.disbursements (id) on delete restrict,
  farm_id uuid not null references public.farms (id) on delete restrict,
  farmer_id uuid not null references public.farmers (id) on delete restrict,
  purpose varchar(300) not null,
  value_kobo bigint not null check (value_kobo > 0),
  -- Maintained by the redemption functions; never written by clients.
  redeemed_kobo bigint not null default 0 check (redeemed_kobo >= 0 and redeemed_kobo <= value_kobo),
  status public.voucher_status not null default 'active',
  expires_on date not null,
  issued_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete restrict,
  close_reason varchar(300),
  -- The entry that returned unused value to the cycle's cash, if any was left.
  close_entry_id uuid unique references public.journal_entries (id),
  unique (disbursement_id, farm_id)
);
create index vouchers_cycle_idx on public.vouchers (cycle_id);
create index vouchers_milestone_idx on public.vouchers (milestone_id);

create table public.voucher_redemptions (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.vouchers (id) on delete restrict,
  vendor_id uuid not null references public.vendors (id) on delete restrict,
  cycle_id uuid not null references public.cycles (id) on delete restrict,
  amount_kobo bigint not null check (amount_kobo > 0),
  -- What the vendor supplied, e.g. "2 bags NPK 15-15-15, 25 kg certified maize seed".
  items varchar(500) not null check (length(trim(items)) >= 3),
  redeemed_by uuid not null references public.profiles (id) on delete restrict,
  redeemed_at timestamptz not null default now(),
  -- Payment to the vendor, confirmed by the trustee.
  paid_at timestamptz,
  paid_by uuid references public.profiles (id) on delete restrict,
  trustee_reference varchar(120) unique,
  journal_entry_id uuid unique references public.journal_entries (id),
  -- An unpaid redemption can be voided (e.g. goods never handed over); its value returns to the voucher.
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete restrict,
  void_reason varchar(300),
  check (paid_at is null or voided_at is null)
);
create index voucher_redemptions_voucher_idx on public.voucher_redemptions (voucher_id);
create index voucher_redemptions_vendor_idx on public.voucher_redemptions (vendor_id, redeemed_at);
create index voucher_redemptions_unpaid_idx on public.voucher_redemptions (cycle_id)
  where paid_at is null and voided_at is null;

/** Every attempt to use a code at the counter, so guessing can be detected and throttled. */
create table private.voucher_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);
create index voucher_attempts_user_idx on private.voucher_attempts (user_id, attempted_at);

create function private.max_voucher_failures() returns int
language sql immutable set search_path = '' as $$ select 5 $$;

create function private.new_voucher_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea;
  candidate text;
begin
  loop
    bytes := extensions.gen_random_bytes(12);
    candidate := '';
    -- 256 is a multiple of 32, so every letter is equally likely.
    for i in 0..11 loop
      candidate := candidate || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.vouchers v where v.code = candidate);
  end loop;
  return candidate;
end $$;

/** Accepts codes as farmers read them out: any case, with spaces or dashes. */
create function private.normalise_voucher_code(p_code text) returns text
language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

/** The approved vendor whose account is signed in, or an error. */
create function private.current_vendor() returns public.vendors
language plpgsql stable set search_path = '' as $$
declare
  v public.vendors;
begin
  if not public.is_vendor() then
    raise exception 'Only vendor accounts can redeem vouchers' using errcode = 'PT403';
  end if;
  select * into v from public.vendors where user_id = auth.uid();
  if not found then
    raise exception 'Your account is not linked to a registered vendor yet; ask an admin'
      using errcode = 'PT403';
  end if;
  if v.status <> 'approved' then
    raise exception 'Your shop is % and cannot redeem vouchers right now', v.status
      using errcode = 'PT403';
  end if;
  return v;
end $$;

create function private.assert_not_throttled() returns void
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from private.voucher_attempts
       where user_id = auth.uid() and not succeeded
         and attempted_at > now() - interval '15 minutes') >= private.max_voucher_failures() then
    raise exception 'Too many wrong voucher codes or phone numbers. Try again in 15 minutes.'
      using errcode = 'PT429';
  end if;
end $$;

/**
 * Finds a usable voucher for this code and phone, recording the attempt. Returns null
 * when the code is unknown or the phone doesn't match, without saying which, so a
 * guesser learns nothing. The caller must not raise after a null, or the record of the
 * failed attempt is rolled back with it.
 */
create function private.match_voucher(p_code text, p_phone_last4 text) returns public.vouchers
language plpgsql set search_path = '' as $$
declare
  v public.vouchers;
  phone text;
begin
  perform private.assert_not_throttled();
  select * into v from public.vouchers where code = private.normalise_voucher_code(p_code);
  if found then
    select regexp_replace(f.phone, '[^0-9]', '', 'g') into phone
      from public.farmers f where f.id = v.farmer_id;
    if right(phone, 4) is distinct from regexp_replace(coalesce(p_phone_last4, ''), '[^0-9]', '', 'g') then
      v := null;
    end if;
  end if;
  insert into private.voucher_attempts (user_id, succeeded) values (auth.uid(), v.id is not null);
  return v;
end $$;

/** Why a matched voucher can't be used now, or null if it can. */
create function private.voucher_unusable_reason(v public.vouchers) returns text
language plpgsql stable set search_path = '' as $$
declare
  cycle_status public.cycle_status;
begin
  select status into cycle_status from public.cycles where id = v.cycle_id;
  return case
    when v.status = 'redeemed' then 'This voucher has been used in full'
    when v.status = 'closed' then 'This voucher has been closed'
    when v.expires_on < current_date then format('This voucher expired on %s', v.expires_on)
    when cycle_status not in ('funded', 'in_progress') then 'This voucher''s season has ended'
  end;
end $$;

/** What the vendor sees at the counter. Never includes the farmer's phone or full name. */
create function private.voucher_summary(v public.vouchers) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'ok', true,
    'voucher_id', v.id,
    'code', v.code,
    'farmer', f.first_name || ' ' || left(f.last_name, 1) || '.',
    'cooperative', co.name,
    'cycle_code', c.code,
    'crop', c.crop,
    'purpose', v.purpose,
    'value_kobo', v.value_kobo::text,
    'remaining_kobo', (v.value_kobo - v.redeemed_kobo)::text,
    'expires_on', v.expires_on,
    'unusable_reason', private.voucher_unusable_reason(v))
  from public.farmers f
  join public.cycles c on c.id = v.cycle_id
  left join public.cooperatives co on co.id = c.cooperative_id
  where f.id = v.farmer_id
$$;

/** Step 1 at the counter: check a code before handing anything over. */
create function public.check_voucher(p_code text, p_phone_last4 text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.vouchers;
begin
  perform private.current_vendor();
  v := private.match_voucher(p_code, p_phone_last4);
  if v.id is null then
    return jsonb_build_object('ok', false,
      'message', 'No voucher matches that code and phone number. Check both with the farmer.');
  end if;
  return private.voucher_summary(v);
end $$;

/**
 * Step 2: record what was supplied. The vendor is paid this amount by the trustee.
 * A voucher can be used across several visits or shops until its value runs out.
 */
create function public.redeem_voucher(
  p_code text, p_phone_last4 text, p_amount_kobo bigint, p_items text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  vendor public.vendors;
  v public.vouchers;
  reason text;
  new_id uuid;
begin
  vendor := private.current_vendor();
  v := private.match_voucher(p_code, p_phone_last4);
  if v.id is null then
    return jsonb_build_object('ok', false,
      'message', 'No voucher matches that code and phone number. Check both with the farmer.');
  end if;

  -- From here on the code and phone are right, so errors can be raised normally.
  select * into v from public.vouchers where id = v.id for update;
  reason := private.voucher_unusable_reason(v);
  if reason is not null then
    raise exception '%', reason using errcode = 'PT409';
  end if;
  if coalesce(p_amount_kobo, 0) <= 0 then
    raise exception 'Enter the value of what you supplied' using errcode = 'PT400';
  end if;
  if p_amount_kobo > v.value_kobo - v.redeemed_kobo then
    raise exception 'This voucher only has % left', private.format_naira(v.value_kobo - v.redeemed_kobo)
      using errcode = 'PT400';
  end if;
  if coalesce(length(trim(p_items)), 0) < 3 then
    raise exception 'List what you supplied, e.g. 2 bags NPK 15-15-15' using errcode = 'PT400';
  end if;

  insert into public.voucher_redemptions (voucher_id, vendor_id, cycle_id, amount_kobo, items, redeemed_by)
  values (v.id, vendor.id, v.cycle_id, p_amount_kobo, left(trim(p_items), 500), auth.uid())
  returning id into new_id;

  update public.vouchers
     set redeemed_kobo = redeemed_kobo + p_amount_kobo,
         status = (case when redeemed_kobo + p_amount_kobo = value_kobo then 'redeemed' else 'active' end)::public.voucher_status
   where id = v.id
   returning * into v;

  perform private.log_cycle_event(v.cycle_id, 'voucher_redeemed',
    format('%s redeemed %s of voucher %s: %s', vendor.name, private.format_naira(p_amount_kobo),
      v.code, left(trim(p_items), 200)),
    jsonb_build_object('voucher_id', v.id, 'redemption_id', new_id, 'vendor_id', vendor.id));

  return private.voucher_summary(v) || jsonb_build_object('redemption_id', new_id);
end $$;

-- -----------------------------------------------------------------------------
-- Releases: issuing vouchers, and finishing a milestone once everything is out
-- -----------------------------------------------------------------------------

/** Marks the milestone released once no instruction is still waiting for the trustee. */
create function private.finish_release_if_done(p_milestone_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  m public.milestones;
begin
  if exists (select 1 from public.disbursements
              where milestone_id = p_milestone_id and status = 'instructed') then
    return;
  end if;
  update public.milestones set status = 'released', released_at = now()
   where id = p_milestone_id and status <> 'released' returning * into m;
  if not found then
    return;
  end if;
  update public.cycles set status = 'in_progress' where id = m.cycle_id and status = 'funded';
  perform private.log_cycle_event(m.cycle_id, 'milestone_released',
    format('Milestone %s (%s) released in full', m.sequence, m.name),
    jsonb_build_object('milestone_id', m.id));
end $$;

/** The trustee confirms it has made a bank payment. Vouchers go through issue_vouchers. */
create or replace function public.confirm_disbursement(p_disbursement_id uuid, p_trustee_reference text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.disbursements;
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
  if d.payee_kind = 'input_voucher' then
    raise exception 'Input vouchers are issued, not paid; vendors are paid when farmers redeem them'
      using errcode = 'PT400';
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

  perform private.finish_release_if_done(d.milestone_id);
end $$;

/**
 * The trustee ring-fences a voucher line and issues one voucher per farm in the cycle,
 * split by farm area so each farm gets inputs for its hectares.
 */
create function public.issue_vouchers(p_disbursement_id uuid, p_expires_on date default null)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  d public.disbursements;
  m public.milestones;
  cash_account uuid;
  expires date;
  entry uuid;
  n int := 0;
  share record;
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can issue vouchers' using errcode = 'PT403';
  end if;
  select * into d from public.disbursements where id = p_disbursement_id for update;
  if not found then
    raise exception 'Payment instruction not found' using errcode = 'PT404';
  end if;
  if d.payee_kind <> 'input_voucher' then
    raise exception 'This instruction is a bank payment, not vouchers' using errcode = 'PT400';
  end if;
  if d.status <> 'instructed' then
    raise exception 'These vouchers are already %', d.status using errcode = 'PT409';
  end if;
  select * into m from public.milestones where id = d.milestone_id;
  expires := coalesce(p_expires_on, greatest(current_date, m.planned_date) + 60);
  if expires <= current_date then
    raise exception 'Vouchers must expire after today' using errcode = 'PT400';
  end if;

  perform 1 from public.cycles where id = d.cycle_id for update;
  cash_account := private.cycle_account(d.cycle_id, 'TRUSTEE_CASH');
  if private.account_balance(cash_account) < d.amount_kobo then
    raise exception 'The trustee does not hold enough of this cycle''s cash for these vouchers'
      using errcode = 'PT409';
  end if;

  entry := private.post_journal_entry(
    d.cycle_id,
    left(format('Input vouchers issued: %s', d.purpose), 300),
    auth.uid(),
    jsonb_build_array(
      jsonb_build_object('account_id', private.ensure_cycle_account(d.cycle_id, 'VOUCHER_RESERVE',
                           'Cash ring-fenced for input vouchers', 'asset'),
                         'amount_kobo', d.amount_kobo::text),
      jsonb_build_object('account_id', cash_account, 'amount_kobo', (-d.amount_kobo)::text)));

  for share in
    select f.id as farm_id, f.farmer_id, a.amount
      from private.allocate(d.amount_kobo, (
             select jsonb_agg(jsonb_build_object(
                      'key', f2.id,
                      -- Square metres, so the weights are whole numbers.
                      'weight', round(f2.area_hectares * 10000)) order by f2.id)
               from public.cycle_farms cf join public.farms f2 on f2.id = cf.farm_id
              where cf.cycle_id = d.cycle_id)) a
      join public.farms f on f.id = a.key::uuid
     where a.amount > 0
  loop
    insert into public.vouchers (code, cycle_id, milestone_id, disbursement_id, farm_id, farmer_id,
                                 purpose, value_kobo, expires_on)
    values (private.new_voucher_code(), d.cycle_id, d.milestone_id, d.id, share.farm_id,
            share.farmer_id, d.purpose, share.amount, expires);
    n := n + 1;
  end loop;
  if n = 0 then
    raise exception 'This cycle has no farms to issue vouchers to' using errcode = 'PT409';
  end if;

  update public.disbursements
     set status = 'executed', executed_by = auth.uid(), executed_at = now(), journal_entry_id = entry
   where id = d.id;

  perform private.log_cycle_event(d.cycle_id, 'vouchers_issued',
    format('%s input vouchers worth %s issued for milestone %s (%s), valid until %s',
      n, private.format_naira(d.amount_kobo), m.sequence, m.name, expires),
    jsonb_build_object('milestone_id', m.id, 'disbursement_id', d.id));
  perform private.finish_release_if_done(d.milestone_id);
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- Paying vendors, voiding redemptions, closing vouchers
-- -----------------------------------------------------------------------------

create function public.confirm_redemption_payment(p_redemption_id uuid, p_trustee_reference text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.voucher_redemptions;
  vendor public.vendors;
  entry uuid;
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can confirm payments' using errcode = 'PT403';
  end if;
  if coalesce(trim(p_trustee_reference), '') = '' then
    raise exception 'The trustee''s payment reference is required' using errcode = 'PT400';
  end if;
  select * into r from public.voucher_redemptions where id = p_redemption_id for update;
  if not found then
    raise exception 'Redemption not found' using errcode = 'PT404';
  end if;
  if r.voided_at is not null then
    raise exception 'This redemption was voided' using errcode = 'PT409';
  end if;
  if r.paid_at is not null then
    raise exception 'This vendor has already been paid for this redemption' using errcode = 'PT409';
  end if;
  select * into vendor from public.vendors where id = r.vendor_id;
  if vendor.status <> 'approved' then
    raise exception '% is %, so its payments are on hold', vendor.name, vendor.status
      using errcode = 'PT409';
  end if;
  if exists (select 1 from public.voucher_redemptions where trustee_reference = trim(p_trustee_reference)) then
    raise exception 'Reference % has already been used', trim(p_trustee_reference) using errcode = 'PT409';
  end if;

  entry := private.post_journal_entry(
    r.cycle_id,
    left(format('%s: voucher redemption, %s', vendor.name, r.items), 300),
    auth.uid(),
    jsonb_build_array(
      jsonb_build_object('account_id', private.cycle_account(r.cycle_id, 'FARM_DEPLOYMENT'),
                         'amount_kobo', r.amount_kobo::text, 'memo', 'input_voucher'),
      jsonb_build_object('account_id', private.cycle_account(r.cycle_id, 'VOUCHER_RESERVE'),
                         'amount_kobo', (-r.amount_kobo)::text, 'memo', vendor.name)),
    trim(p_trustee_reference));

  update public.voucher_redemptions
     set paid_at = now(), paid_by = auth.uid(), trustee_reference = trim(p_trustee_reference),
         journal_entry_id = entry
   where id = r.id;
end $$;

/** Cancels an unpaid redemption (goods not handed over, entered twice, fraud). */
create function public.void_redemption(p_redemption_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.voucher_redemptions;
  v public.vouchers;
begin
  if not (public.is_cycle_manager() or public.is_kyc_reviewer()) then
    raise exception 'Only cycle managers or compliance can void redemptions' using errcode = 'PT403';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason for voiding this redemption' using errcode = 'PT400';
  end if;
  select * into r from public.voucher_redemptions where id = p_redemption_id for update;
  if not found then
    raise exception 'Redemption not found' using errcode = 'PT404';
  end if;
  if r.voided_at is not null then
    raise exception 'This redemption is already voided' using errcode = 'PT409';
  end if;
  if r.paid_at is not null then
    raise exception 'The vendor has already been paid; recover the money from them instead'
      using errcode = 'PT409';
  end if;
  update public.voucher_redemptions
     set voided_at = now(), voided_by = auth.uid(), void_reason = left(trim(p_reason), 300)
   where id = r.id;
  update public.vouchers
     set redeemed_kobo = redeemed_kobo - r.amount_kobo,
         status = case when status = 'redeemed' then 'active' else status end
   where id = r.voucher_id
   returning * into v;
  perform private.log_cycle_event(r.cycle_id, 'redemption_voided',
    format('Redemption of %s on voucher %s voided: %s', private.format_naira(r.amount_kobo), v.code,
      trim(p_reason)),
    jsonb_build_object('voucher_id', v.id, 'redemption_id', r.id));
end $$;

/** Closes a voucher and returns its unused value to the cycle's cash. */
create function public.close_voucher(p_voucher_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.vouchers;
  remaining bigint;
  entry uuid;
begin
  if not public.is_cycle_manager() then
    raise exception 'Only cycle or programme managers can close vouchers' using errcode = 'PT403';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason for closing this voucher' using errcode = 'PT400';
  end if;
  select * into v from public.vouchers where id = p_voucher_id for update;
  if not found then
    raise exception 'Voucher not found' using errcode = 'PT404';
  end if;
  if v.status <> 'active' then
    raise exception 'This voucher is already %', v.status using errcode = 'PT409';
  end if;

  remaining := v.value_kobo - v.redeemed_kobo;
  if remaining > 0 then
    entry := private.post_journal_entry(
      v.cycle_id,
      left(format('Voucher %s closed, unused value returned: %s', v.code, trim(p_reason)), 300),
      auth.uid(),
      jsonb_build_array(
        jsonb_build_object('account_id', private.cycle_account(v.cycle_id, 'TRUSTEE_CASH'),
                           'amount_kobo', remaining::text),
        jsonb_build_object('account_id', private.cycle_account(v.cycle_id, 'VOUCHER_RESERVE'),
                           'amount_kobo', (-remaining)::text)));
  end if;
  update public.vouchers
     set status = 'closed', closed_at = now(), closed_by = auth.uid(),
         close_reason = left(trim(p_reason), 300), close_entry_id = entry
   where id = v.id;
  perform private.log_cycle_event(v.cycle_id, 'voucher_closed',
    format('Voucher %s closed, %s unused returned to the cycle: %s', v.code,
      private.format_naira(remaining), trim(p_reason)),
    jsonb_build_object('voucher_id', v.id));
end $$;

/** Closes every active voucher in a cycle that has passed its expiry date. */
create function public.close_expired_vouchers(p_cycle_id uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  n int := 0;
begin
  if not public.is_cycle_manager() then
    raise exception 'Only cycle or programme managers can close vouchers' using errcode = 'PT403';
  end if;
  for v_id in
    select id from public.vouchers
     where cycle_id = p_cycle_id and status = 'active' and expires_on < current_date
     order by issued_at, id
  loop
    perform public.close_voucher(v_id, 'expired');
    n := n + 1;
  end loop;
  return n;
end $$;

/** The harvest can't be completed while vouchers are open or vendors unpaid. */
create function private.vouchers_settled_before_harvest() returns trigger
language plpgsql set search_path = '' as $$
declare
  open_count int;
  unpaid_count int;
begin
  select count(*) into open_count from public.vouchers where cycle_id = new.id and status = 'active';
  if open_count > 0 then
    raise exception '% input voucher(s) are still open; close them or let farmers use them first',
      open_count using errcode = 'PT409';
  end if;
  select count(*) into unpaid_count from public.voucher_redemptions
   where cycle_id = new.id and paid_at is null and voided_at is null;
  if unpaid_count > 0 then
    raise exception '% voucher redemption(s) still need paying by the trustee', unpaid_count
      using errcode = 'PT409';
  end if;
  return new;
end $$;

create trigger cycles_vouchers_before_harvest before update of status on public.cycles
for each row when (new.status = 'harvested' and old.status is distinct from 'harvested')
execute function private.vouchers_settled_before_harvest();

-- -----------------------------------------------------------------------------
-- Access: vouchers and redemptions are written only through the functions above
-- -----------------------------------------------------------------------------

alter table public.vouchers enable row level security;
alter table public.voucher_redemptions enable row level security;
revoke all on public.vouchers, public.voucher_redemptions from anon, authenticated;
grant select on public.vouchers, public.voucher_redemptions to authenticated;

/** The vendor linked to the signed-in account, if any. */
create function public.my_vendor_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.vendors where user_id = auth.uid()
$$;

-- Staff see everything. A vendor sees its own redemptions and the vouchers behind them.
create policy voucher_redemptions_read on public.voucher_redemptions for select to authenticated
  using ((select public.is_cycle_reader()) or vendor_id = (select public.my_vendor_id()));
create policy vouchers_read on public.vouchers for select to authenticated
  using ((select public.is_cycle_reader())
         or exists (select 1 from public.voucher_redemptions r
                     where r.voucher_id = vouchers.id and r.vendor_id = (select public.my_vendor_id())));

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.is_vendor(),
  public.my_vendor_id(),
  public.is_vendor_editor(),
  public.set_vendor_status(uuid, public.vendor_status, text),
  public.link_vendor_account(uuid, uuid),
  public.check_voucher(text, text),
  public.redeem_voucher(text, text, bigint, text),
  public.confirm_disbursement(uuid, text),
  public.issue_vouchers(uuid, date),
  public.confirm_redemption_payment(uuid, text),
  public.void_redemption(uuid, text),
  public.close_voucher(uuid, text),
  public.close_expired_vouchers(uuid)
to authenticated;
