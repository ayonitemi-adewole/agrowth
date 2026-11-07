-- =============================================================================
-- Agrowth 2.0 — Investor Edition: investor KYC, caps, disclosures and pledges
--
-- Investors fund cycles themselves instead of the trustee keying in every deposit:
--
--   1. An investor submits KYC: legal name, NIN and BVN (stored only as keyed hashes),
--      an ID document, declared annual income, crowdfunding done elsewhere, the bank
--      account for payouts, and whether they claim to be retail, high-net-worth or
--      institutional. Compliance verifies it and sets the classification.
--   2. Retail investors are capped (SEC crowdfunding rules: 10% of net annual income
--      across all crowdfunding in 12 months). The cap counts what they declared
--      elsewhere plus everything pledged or paid here. HNW and institutional: no cap.
--   3. To invest, the investor must acknowledge the current risk disclosure. The pledge
--      records which version they saw; a stale version is refused.
--   4. A pledge reserves its share of the cycle and gets a payment reference. The
--      investor pays the trustee's escrow account with that reference.
--   5. Cooling-off: for the first hours after pledging the trustee cannot add the money
--      to the cycle, so a withdrawal never needs a ledger reversal. The investor can
--      withdraw at any time until the trustee confirms the payment.
--   6. The trustee confirms the payment, which posts it exactly as a recorded deposit
--      does (Dr TRUSTEE_CASH / Cr FUNDER_CAPITAL) and links it to the investor, so
--      their settlement payout and statement trace back to them.
--
-- Investors never get table access to cycles, farms or visits. They read curated
-- listings through the functions at the end of this file: no farmer names, no
-- account numbers, no other investors' names.
-- =============================================================================

create function public.is_investor() returns boolean
language sql stable set search_path = '' as $$
  select public.has_any_role(array['investor']::public.user_role[])
$$;

-- -----------------------------------------------------------------------------
-- Operator settings (one row): caps, cooling-off, payment window, escrow account,
-- and the risk disclosure investors must acknowledge.
-- -----------------------------------------------------------------------------

create table public.investor_settings (
  id boolean primary key default true check (id),
  retail_cap_bps integer not null default 1000 check (retail_cap_bps between 1 and 10000),
  cooling_off_hours integer not null default 48 check (cooling_off_hours between 0 and 720),
  payment_window_days integer not null default 7 check (payment_window_days between 1 and 60),
  min_pledge_kobo bigint not null default 1000000 check (min_pledge_kobo > 0),
  escrow_bank_name varchar(120) not null default 'Trustee escrow bank',
  escrow_account_name varchar(200) not null default 'Trustee escrow account',
  escrow_account_number varchar(10) not null default '0000000000'
    check (escrow_account_number ~ '^[0-9]{10}$'),
  risk_disclosure text not null check (length(trim(risk_disclosure)) >= 50),
  -- Goes up by one whenever the disclosure text changes; set by the trigger below.
  disclosure_version integer not null default 1,
  updated_at timestamptz not null default now()
);

insert into public.investor_settings (risk_disclosure) values (
$disclosure$Farming is risky, and you can lose some or all of the money you invest.

- Returns are not guaranteed. You receive a share of what the harvest actually sells for, after costs and fees. The low, expected and high figures are estimates from past yields and prices, not promises.
- Weather, pests, disease, theft and price falls can cut the harvest or its value. Insurance covers some of these losses, not all of them, and claims can take months.
- Your money is locked in until the cycle is settled after harvest, usually 4 to 9 months. There is no way to sell your position early.
- If the cycle does not fill by its funding deadline, or is cancelled, the trustee refunds you in full. Once it is funded, refunds are no longer possible.
- Your money is held by the trustee, not by the platform, and is released in stages only after field checks pass. This reduces the risk of misuse; it does not remove the risk of loss.
- Only invest money you can afford to lose. Retail investors may invest at most 10% of their net annual income in crowdfunding each year.$disclosure$
);

create function private.investor_settings_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.disclosure_version := case
    when new.risk_disclosure is distinct from old.risk_disclosure then old.disclosure_version + 1
    else old.disclosure_version end;
  new.updated_at := now();
  return new;
end $$;

create trigger investor_settings_version before update on public.investor_settings
for each row execute function private.investor_settings_version();

alter table public.investor_settings enable row level security;
revoke all on public.investor_settings from anon, authenticated;
grant select on public.investor_settings to authenticated;
grant update (retail_cap_bps, cooling_off_hours, payment_window_days, min_pledge_kobo,
              escrow_bank_name, escrow_account_name, escrow_account_number, risk_disclosure)
   on public.investor_settings to authenticated;
create policy investor_settings_read on public.investor_settings for select to authenticated
  using (true);
create policy investor_settings_update on public.investor_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create function private.settings() returns public.investor_settings
language sql stable set search_path = '' as $$
  select * from public.investor_settings where id
$$;

-- -----------------------------------------------------------------------------
-- Investor KYC
-- -----------------------------------------------------------------------------

create type public.investor_class as enum ('retail', 'high_net_worth', 'institutional');

create table public.investor_profiles (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  legal_name varchar(200) not null check (length(trim(legal_name)) >= 2),
  declared_class public.investor_class not null,
  -- Set by compliance when it verifies the investor; null until then.
  classification public.investor_class,
  kyc_status public.kyc_status not null default 'pending',
  nin_hash text not null unique,
  bvn_hash text not null unique,
  annual_income_kobo bigint not null check (annual_income_kobo >= 0),
  -- Crowdfunding investments made on other platforms in the last 12 months.
  other_crowdfunding_kobo bigint not null default 0 check (other_crowdfunding_kobo >= 0),
  -- Path in the "investor-documents" bucket: <user id>/<file name>.
  id_document_path text not null,
  bank_name varchar(120) not null check (length(trim(bank_name)) >= 2),
  account_number varchar(10) not null check (account_number ~ '^[0-9]{10}$'),
  account_name varchar(200) not null check (length(trim(account_name)) >= 2),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete restrict,
  review_note text check (length(review_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kyc_status = 'verified') = (classification is not null))
);

create trigger investor_profiles_touch before update on public.investor_profiles
for each row execute function private.touch_updated_at();

alter table public.investor_profiles enable row level security;
revoke all on public.investor_profiles from anon, authenticated;
grant select on public.investor_profiles to authenticated;
-- Compliance reviews investors; the trustee needs payout accounts; auditors read everything.
create policy investor_profiles_read on public.investor_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_ledger_reader()));

/**
 * Submit (or resubmit) the signed-in investor's KYC. Resubmitting after verification —
 * to change bank details, say — sends the profile back to compliance; until it is
 * verified again the investor can't make new pledges.
 */
create function public.submit_investor_kyc(
  p_legal_name text,
  p_declared_class public.investor_class,
  p_nin text,
  p_bvn text,
  p_annual_income_kobo bigint,
  p_other_crowdfunding_kobo bigint,
  p_id_document_path text,
  p_bank_name text,
  p_account_number text,
  p_account_name text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  nin_h text;
  bvn_h text;
begin
  if not public.is_investor() then
    raise exception 'Only investor accounts can submit investor KYC' using errcode = 'PT403';
  end if;
  if coalesce(regexp_replace(p_nin, '[\s-]', '', 'g'), '') !~ '^[0-9]{11}$' then
    raise exception 'A NIN is 11 digits' using errcode = 'PT400';
  end if;
  if coalesce(regexp_replace(p_bvn, '[\s-]', '', 'g'), '') !~ '^[0-9]{11}$' then
    raise exception 'A BVN is 11 digits' using errcode = 'PT400';
  end if;
  if p_annual_income_kobo is null or p_annual_income_kobo < 0
     or coalesce(p_other_crowdfunding_kobo, 0) < 0 then
    raise exception 'Income and other investments must be zero or more' using errcode = 'PT400';
  end if;
  if coalesce(p_id_document_path, '') not like auth.uid()::text || '/%' then
    raise exception 'Upload an ID document first' using errcode = 'PT400';
  end if;

  nin_h := private.hash_identifier(p_nin);
  bvn_h := private.hash_identifier(p_bvn);
  if exists (select 1 from public.investor_profiles
              where user_id <> auth.uid() and (nin_hash = nin_h or bvn_hash = bvn_h)) then
    raise exception 'This NIN or BVN is already registered to another investor account'
      using errcode = 'PT409';
  end if;

  insert into public.investor_profiles as ip (
    user_id, legal_name, declared_class, nin_hash, bvn_hash, annual_income_kobo,
    other_crowdfunding_kobo, id_document_path, bank_name, account_number, account_name
  ) values (
    auth.uid(), trim(p_legal_name), p_declared_class, nin_h, bvn_h, p_annual_income_kobo,
    coalesce(p_other_crowdfunding_kobo, 0), p_id_document_path, trim(p_bank_name),
    trim(p_account_number), trim(p_account_name)
  )
  on conflict (user_id) do update set
    legal_name = excluded.legal_name,
    declared_class = excluded.declared_class,
    classification = null,
    kyc_status = 'pending',
    nin_hash = excluded.nin_hash,
    bvn_hash = excluded.bvn_hash,
    annual_income_kobo = excluded.annual_income_kobo,
    other_crowdfunding_kobo = excluded.other_crowdfunding_kobo,
    id_document_path = excluded.id_document_path,
    bank_name = excluded.bank_name,
    account_number = excluded.account_number,
    account_name = excluded.account_name,
    submitted_at = now(),
    reviewed_at = null,
    reviewed_by = null,
    review_note = null;
end $$;

/** Compliance verifies or rejects an investor, and sets their classification. */
create function public.review_investor_kyc(
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
  update public.investor_profiles
     set kyc_status = case when p_approve then 'verified' else 'rejected' end::public.kyc_status,
         classification = case when p_approve then coalesce(p_classification, ip.declared_class) end,
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         review_note = nullif(trim(p_note), '')
   where user_id = p_user_id;
end $$;

-- ID documents. Path convention: <user id>/<file name>.
insert into storage.buckets (id, name, public)
values ('investor-documents', 'investor-documents', false)
on conflict (id) do nothing;

create policy investor_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'investor-documents'
         and (split_part(name, '/', 1) = (select auth.uid())::text
              or (select public.is_kyc_reviewer())
              or (select public.has_any_role(array['auditor']::public.user_role[]))));
create policy investor_documents_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'investor-documents'
              and (select public.is_investor())
              and split_part(name, '/', 1) = (select auth.uid())::text);

-- -----------------------------------------------------------------------------
-- Pledges
-- -----------------------------------------------------------------------------

create type public.pledge_status as enum ('pending', 'paid', 'withdrawn', 'lapsed');

create table public.investment_pledges (
  id uuid primary key default gen_random_uuid(),
  -- Quoted on the bank transfer so the trustee can match the payment, e.g. AGR-7KQ2MX4P.
  reference varchar(20) not null unique,
  cycle_id uuid not null references public.cycles (id) on delete restrict,
  investor_id uuid not null references public.investor_profiles (user_id) on delete restrict,
  amount_kobo bigint not null check (amount_kobo > 0),
  status public.pledge_status not null default 'pending',
  -- The risk disclosure the investor acknowledged, and when.
  disclosure_version integer not null,
  disclosure_acknowledged_at timestamptz not null,
  pledged_at timestamptz not null default now(),
  cooling_off_ends_at timestamptz not null,
  -- The last day a payment can be received for this pledge.
  pay_by date not null,
  contribution_id uuid unique references public.funding_contributions (id) on delete restrict,
  closed_at timestamptz,
  check ((status = 'paid') = (contribution_id is not null))
);
create index investment_pledges_cycle_idx on public.investment_pledges (cycle_id, status);
create index investment_pledges_investor_idx on public.investment_pledges (investor_id, pledged_at);

alter table public.investment_pledges enable row level security;
revoke all on public.investment_pledges from anon, authenticated;
grant select on public.investment_pledges to authenticated;
create policy investment_pledges_read on public.investment_pledges for select to authenticated
  using (investor_id = (select auth.uid()) or (select public.is_cycle_reader()));

-- Deposits made through a pledge point back at the investor.
alter table public.funding_contributions
  add column investor_id uuid references public.investor_profiles (user_id) on delete restrict;
create index funding_contributions_investor_idx on public.funding_contributions (investor_id);

/** Pending pledges past their payment day, or on a cycle no longer taking money, lapse. */
create function private.lapse_pledges(p_cycle_id uuid) returns void
language sql set search_path = '' as $$
  update public.investment_pledges p
     set status = 'lapsed', closed_at = now()
    from public.cycles c
   where c.id = p.cycle_id and p.cycle_id = p_cycle_id and p.status = 'pending'
     and (p.pay_by < current_date or c.status <> 'open_for_funding')
$$;

/** Money still being waited for on pending pledges, optionally leaving one out. */
create function private.reserved_kobo(p_cycle_id uuid, p_except uuid default null) returns bigint
language sql stable set search_path = '' as $$
  select coalesce(sum(amount_kobo), 0)::bigint from public.investment_pledges
   where cycle_id = p_cycle_id and status = 'pending' and pay_by >= current_date
     and id is distinct from p_except
$$;

create function private.raised_kobo(p_cycle_id uuid) returns bigint
language sql stable set search_path = '' as $$
  select coalesce(sum(amount_kobo), 0)::bigint from public.funding_contributions
   where cycle_id = p_cycle_id and refund_entry_id is null
$$;

/**
 * Where an investor stands against their cap. Counts the last 12 months: pending pledges
 * still within their payment window, paid pledges not refunded, and what they declared
 * investing elsewhere. Amounts in kobo as strings; cap and remaining are null when uncapped.
 */
create function private.investor_cap(p_user_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  ip public.investor_profiles;
  s public.investor_settings := private.settings();
  here bigint;
  cap bigint;
begin
  select * into ip from public.investor_profiles where user_id = p_user_id;
  if not found then
    return jsonb_build_object('kyc_status', null);
  end if;
  select coalesce(sum(p.amount_kobo), 0) into here
    from public.investment_pledges p
    left join public.funding_contributions fc on fc.id = p.contribution_id
   where p.investor_id = p_user_id
     and p.pledged_at > now() - interval '12 months'
     and ((p.status = 'pending' and p.pay_by >= current_date)
          or (p.status = 'paid' and fc.refund_entry_id is null));
  if ip.classification = 'retail' then
    cap := floor(ip.annual_income_kobo * s.retail_cap_bps / 10000.0)::bigint;
  end if;
  return jsonb_build_object(
    'kyc_status', ip.kyc_status,
    'classification', ip.classification,
    'capped', ip.classification = 'retail',
    'cap_kobo', cap::text,
    'used_here_kobo', here::text,
    'used_elsewhere_kobo', ip.other_crowdfunding_kobo::text,
    'remaining_kobo', case when cap is not null
                        then greatest(cap - here - ip.other_crowdfunding_kobo, 0)::text end);
end $$;

create function public.my_investment_cap() returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.investor_cap(auth.uid())
$$;

create function private.new_pledge_reference() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea;
  ref text;
begin
  loop
    bytes := extensions.gen_random_bytes(8);
    ref := 'AGR-';
    for i in 0..7 loop
      ref := ref || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.investment_pledges where reference = ref);
  end loop;
  return ref;
end $$;

/**
 * Adds a deposit to a cycle and posts it to the ledger. Shared by the trustee's
 * record_funding and confirm_pledge_payment. The caller checks permissions.
 * Pending pledges keep their reserved share: a deposit can't take it from them.
 */
create function private.add_contribution(
  p_cycle_id uuid,
  p_funder_name text,
  p_funder_kind public.funder_kind,
  p_amount_kobo bigint,
  p_trustee_reference text,
  p_received_on date,
  p_investor_id uuid default null,
  p_pledge_id uuid default null
) returns uuid
language plpgsql set search_path = '' as $$
declare
  c public.cycles;
  raised bigint;
  reserved bigint;
  entry uuid;
  new_id uuid;
begin
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
  if p_received_on is null or p_received_on > current_date then
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

  perform private.lapse_pledges(p_cycle_id);
  raised := private.raised_kobo(p_cycle_id);
  reserved := private.reserved_kobo(p_cycle_id, p_pledge_id);
  if raised + reserved + p_amount_kobo > c.target_amount_kobo then
    raise exception 'This deposit would take the cycle past its target; only % is still open%',
      private.format_naira(greatest(c.target_amount_kobo - raised - reserved, 0)),
      case when reserved > 0
        then format(' (%s is reserved for investors'' pledges)', private.format_naira(reserved))
        else '' end
      using errcode = 'PT400';
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
    journal_entry_id, investor_id
  ) values (
    p_cycle_id, trim(p_funder_name), p_funder_kind, p_amount_kobo, trim(p_trustee_reference),
    p_received_on, auth.uid(), entry, p_investor_id
  ) returning id into new_id;

  perform private.log_cycle_event(p_cycle_id, 'funding_received',
    format('%s received from %s', private.format_naira(p_amount_kobo), trim(p_funder_name)),
    jsonb_build_object('contribution_id', new_id));

  if raised + p_amount_kobo = c.target_amount_kobo then
    update public.cycles set status = 'funded' where id = p_cycle_id;
    perform private.log_cycle_event(p_cycle_id, 'funded', 'Fully funded');
    -- Nothing can be outstanding once the target is met, but close any stragglers.
    perform private.lapse_pledges(p_cycle_id);
  end if;
  return new_id;
end $$;

-- The trustee's direct deposit (for funders outside the portal) now respects pledges.
create or replace function public.record_funding(
  p_cycle_id uuid,
  p_funder_name text,
  p_funder_kind public.funder_kind,
  p_amount_kobo bigint,
  p_trustee_reference text,
  p_received_on date default current_date
) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can confirm deposits' using errcode = 'PT403';
  end if;
  return private.add_contribution(p_cycle_id, p_funder_name, p_funder_kind, p_amount_kobo,
    p_trustee_reference, p_received_on);
end $$;

/**
 * The signed-in investor pledges to a cycle. They must be KYC-verified, within their cap,
 * and must have acknowledged the current risk disclosure (p_disclosure_version).
 * Returns the pledge and how to pay.
 */
create function public.pledge_investment(
  p_cycle_id uuid,
  p_amount_kobo bigint,
  p_disclosure_version integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.investor_settings := private.settings();
  ip public.investor_profiles;
  c public.cycles;
  open_kobo bigint;
  cap jsonb;
  p public.investment_pledges;
begin
  if not public.is_investor() then
    raise exception 'Only investor accounts can invest' using errcode = 'PT403';
  end if;
  -- Locked so two pledges at once (to different cycles) can't both fit under the cap.
  select * into ip from public.investor_profiles where user_id = auth.uid() for update;
  if not found or ip.kyc_status <> 'verified' then
    raise exception 'Your KYC must be verified before you can invest' using errcode = 'PT403';
  end if;
  if p_disclosure_version is distinct from s.disclosure_version then
    raise exception 'The risk disclosure has changed since you read it; please read it again'
      using errcode = 'PT409';
  end if;

  select * into c from public.cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'Cycle not found' using errcode = 'PT404';
  end if;
  if c.status <> 'open_for_funding' or c.funding_deadline < current_date then
    raise exception 'This cycle is not open for investment' using errcode = 'PT409';
  end if;
  if c.funding_source = 'programme' then
    raise exception 'This cycle is funded by a programme, not investors' using errcode = 'PT409';
  end if;

  perform private.lapse_pledges(p_cycle_id);
  open_kobo := c.target_amount_kobo - private.raised_kobo(p_cycle_id) - private.reserved_kobo(p_cycle_id);
  if coalesce(p_amount_kobo, 0) <= 0 then
    raise exception 'Enter an amount to invest' using errcode = 'PT400';
  end if;
  if open_kobo <= 0 then
    raise exception 'This cycle is fully subscribed' using errcode = 'PT409';
  end if;
  if p_amount_kobo > open_kobo then
    raise exception 'Only % of this cycle is still open', private.format_naira(open_kobo)
      using errcode = 'PT400';
  end if;
  -- The minimum gives way when less than it is left, so the cycle can always fill.
  if p_amount_kobo < least(s.min_pledge_kobo, open_kobo) then
    raise exception 'The minimum investment is %', private.format_naira(least(s.min_pledge_kobo, open_kobo))
      using errcode = 'PT400';
  end if;

  cap := private.investor_cap(auth.uid());
  if (cap ->> 'capped')::boolean and p_amount_kobo > (cap ->> 'remaining_kobo')::bigint then
    raise exception 'This is over your investment limit: you can invest up to % more in the next 12 months',
      private.format_naira((cap ->> 'remaining_kobo')::bigint) using errcode = 'PT400';
  end if;

  insert into public.investment_pledges (
    reference, cycle_id, investor_id, amount_kobo, disclosure_version, disclosure_acknowledged_at,
    cooling_off_ends_at, pay_by
  ) values (
    private.new_pledge_reference(), p_cycle_id, auth.uid(), p_amount_kobo, s.disclosure_version, now(),
    now() + make_interval(hours => s.cooling_off_hours),
    least(c.funding_deadline, current_date + s.payment_window_days)
  ) returning * into p;

  perform private.log_cycle_event(p_cycle_id, 'pledge_made',
    format('%s pledged by %s (%s)', private.format_naira(p_amount_kobo), ip.legal_name, p.reference),
    jsonb_build_object('pledge_id', p.id));

  return jsonb_build_object(
    'id', p.id,
    'reference', p.reference,
    'amount_kobo', p.amount_kobo::text,
    'pay_by', p.pay_by,
    'cooling_off_ends_at', p.cooling_off_ends_at,
    'escrow_bank_name', s.escrow_bank_name,
    'escrow_account_name', s.escrow_account_name,
    'escrow_account_number', s.escrow_account_number);
end $$;

/** The investor withdraws a pledge the trustee hasn't confirmed payment for. */
create function public.withdraw_pledge(p_pledge_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.investment_pledges;
begin
  select * into p from public.investment_pledges where id = p_pledge_id for update;
  if not found or p.investor_id <> auth.uid() then
    raise exception 'Pledge not found' using errcode = 'PT404';
  end if;
  if p.status <> 'pending' then
    raise exception 'This pledge is already %', p.status using errcode = 'PT409';
  end if;
  update public.investment_pledges set status = 'withdrawn', closed_at = now() where id = p.id;
  perform private.log_cycle_event(p.cycle_id, 'pledge_withdrawn',
    format('Pledge %s (%s) withdrawn by the investor', p.reference, private.format_naira(p.amount_kobo)),
    jsonb_build_object('pledge_id', p.id));
end $$;

/** The trustee confirms an investor's payment against their pledge. Posts it to the ledger. */
create function public.confirm_pledge_payment(
  p_pledge_id uuid,
  p_trustee_reference text,
  p_received_on date default current_date
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  p public.investment_pledges;
  ip public.investor_profiles;
  contribution uuid;
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can confirm payments' using errcode = 'PT403';
  end if;
  select * into p from public.investment_pledges where id = p_pledge_id for update;
  if not found then
    raise exception 'Pledge not found' using errcode = 'PT404';
  end if;
  if p.status <> 'pending' then
    raise exception 'This pledge is already %', p.status using errcode = 'PT409';
  end if;
  if now() < p.cooling_off_ends_at then
    raise exception 'The investor''s cooling-off period runs until %; the payment can be added after that',
      to_char(p.cooling_off_ends_at at time zone 'Africa/Lagos', 'DD Mon YYYY HH24:MI') || ' WAT'
      using errcode = 'PT409';
  end if;
  if p_received_on > p.pay_by then
    raise exception 'This pledge had to be paid by %; it has lapsed', to_char(p.pay_by, 'DD Mon YYYY')
      using errcode = 'PT409';
  end if;
  if p_received_on < p.pledged_at::date then
    raise exception 'The payment cannot be dated before the pledge was made' using errcode = 'PT400';
  end if;
  select * into ip from public.investor_profiles where user_id = p.investor_id;

  contribution := private.add_contribution(p.cycle_id, ip.legal_name, 'investor', p.amount_kobo,
    p_trustee_reference, p_received_on, p.investor_id, p.id);
  update public.investment_pledges
     set status = 'paid', contribution_id = contribution, closed_at = now()
   where id = p.id;
  return contribution;
end $$;

-- Investors see the field photos of cycles they have money in.
create function private.investor_in_cycle(p_cycle_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.investment_pledges
     where cycle_id = p_cycle_id and investor_id = auth.uid() and status = 'paid')
$$;

create function public.can_read_field_photo(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  milestone uuid;
begin
  if not public.is_investor() then
    return false;
  end if;
  begin
    milestone := split_part(p_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return private.investor_in_cycle((select cycle_id from public.milestones where id = milestone));
end $$;

create policy field_photos_read_investor on storage.objects for select to authenticated
  using (bucket_id = 'field-photos' and public.can_read_field_photo(name));

-- -----------------------------------------------------------------------------
-- What investors can read: curated listings, never the underlying tables
-- -----------------------------------------------------------------------------

/** A cycle as a listing card: terms, progress and assumptions. Amounts as strings. */
create function private.listing_summary(p_cycle_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id,
    'code', c.code,
    'crop', c.crop,
    'season', c.season,
    'status', c.status,
    'funding_source', c.funding_source,
    'description', c.description,
    'target_kobo', c.target_amount_kobo::text,
    'raised_kobo', private.raised_kobo(c.id)::text,
    'reserved_kobo', private.reserved_kobo(c.id)::text,
    'funders', (select count(*) from public.funding_contributions
                 where cycle_id = c.id and refund_entry_id is null),
    'funding_deadline', c.funding_deadline,
    'start_date', c.start_date,
    'expected_harvest_date', c.expected_harvest_date,
    'farm_count', coalesce(fa.n, 0),
    'hectares', coalesce(fa.hectares, 0),
    'yield_low', c.yield_low_t_per_ha,
    'yield_expected', c.yield_expected_t_per_ha,
    'yield_high', c.yield_high_t_per_ha,
    'price_low_kobo', c.price_low_per_tonne_kobo::text,
    'price_expected_kobo', c.price_expected_per_tonne_kobo::text,
    'price_high_kobo', c.price_high_per_tonne_kobo::text,
    'management_fee_bps', c.management_fee_bps,
    'funder_profit_share_bps', c.funder_profit_share_bps,
    'cooperative', case when co.id is not null then
      jsonb_build_object('name', co.name, 'state', co.state, 'lga', co.lga) end,
    'sum_insured_kobo', coalesce(ins.sum_insured, 0)::text,
    'insurers', coalesce(ins.names, '[]'::jsonb),
    'offtakers', coalesce(oc.names, '[]'::jsonb),
    'offtake_volume_t', coalesce(oc.volume, 0),
    'offtake_price_terms', coalesce(oc.terms, '[]'::jsonb),
    'offtake_floor_kobo', oc.floor_kobo::text)
  from public.cycles c
  left join public.cooperatives co on co.id = c.cooperative_id
  left join lateral (
    select count(*) as n, sum(f.area_hectares) as hectares
      from public.cycle_farms cf join public.farms f on f.id = cf.farm_id
     where cf.cycle_id = c.id
  ) fa on true
  left join lateral (
    select sum(sum_insured_kobo) as sum_insured, jsonb_agg(distinct insurer_name) as names
      from public.insurance_policies where cycle_id = c.id
  ) ins on true
  left join lateral (
    select jsonb_agg(distinct buyer_name) as names, sum(volume_tonnes) as volume,
           jsonb_agg(distinct price_terms) as terms,
           -- The lowest guaranteed price: a fixed price or a floor.
           min(coalesce(price_per_tonne_kobo, price_floor_per_tonne_kobo)) as floor_kobo
      from public.offtake_contracts
     where cycle_id = c.id and status in ('signed', 'approved', 'fulfilled')
  ) oc on true
  where c.id = p_cycle_id
$$;

/** Can the signed-in user see this cycle's listing? */
create function private.can_view_listing(c public.cycles) returns boolean
language sql stable set search_path = '' as $$
  select public.is_cycle_reader()
      or (public.is_investor() and c.funding_source <> 'programme'
          and c.status not in ('draft', 'pending_approval')
          and (c.status = 'open_for_funding'
               or exists (select 1 from public.investment_pledges
                           where cycle_id = c.id and investor_id = auth.uid()
                             and status in ('pending', 'paid'))))
$$;

/** Cycles open to investors now, newest deadline last. */
create function public.investor_marketplace() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_investor() or public.is_cycle_reader()) then
    raise exception 'Your role cannot see the marketplace' using errcode = 'PT403';
  end if;
  return coalesce((
    select jsonb_agg(private.listing_summary(c.id) order by c.funding_deadline, c.code)
      from public.cycles c
     where c.status = 'open_for_funding' and c.funding_source <> 'programme'
       and c.funding_deadline >= current_date), '[]');
end $$;

/**
 * One cycle as an investor sees it: the listing, the farms on a map (no farmer names),
 * the milestone plan and its progress, field checks, money released by kind, harvest
 * progress, the public history, and the caller's own pledges in it.
 */
create function public.investor_listing(p_cycle_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.cycles;
  invested boolean;
begin
  select * into c from public.cycles where id = p_cycle_id;
  if not found or not private.can_view_listing(c) then
    raise exception 'Cycle not found' using errcode = 'PT404';
  end if;
  invested := private.investor_in_cycle(p_cycle_id) or public.is_cycle_reader();

  return private.listing_summary(p_cycle_id) || jsonb_build_object(
    'farms', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', f.id, 'name', coalesce(f.name, 'Farm ' || f.rn), 'area_hectares', f.area_hectares,
               'primary_crop', f.primary_crop, 'boundary', extensions.st_asgeojson(f.boundary)::jsonb,
               'centroid_lon', extensions.st_x(f.centroid), 'centroid_lat', extensions.st_y(f.centroid))
             order by f.rn), '[]')
        from (select f.*, row_number() over (order by f.created_at, f.id) as rn
                from public.cycle_farms cf join public.farms f on f.id = cf.farm_id
               where cf.cycle_id = p_cycle_id) f),
    'milestones', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id, 'sequence', m.sequence, 'name', m.name, 'description', m.description,
               'planned_date', m.planned_date, 'amount_kobo', m.amount_kobo::text, 'status', m.status,
               'verified_at', m.verified_at, 'released_at', m.released_at,
               'released', (select coalesce(jsonb_object_agg(kind::text, total), '{}') from (
                  select d.payee_kind as kind, sum(d.amount_kobo)::text as total
                    from public.disbursements d
                   where d.milestone_id = m.id and d.status = 'executed'
                   group by d.payee_kind) r))
             order by m.sequence), '[]')
        from public.milestones m where m.cycle_id = p_cycle_id),
    'offtake', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'buyer_name', o.buyer_name, 'commodity', o.commodity, 'volume_tonnes', o.volume_tonnes,
               'price_terms', o.price_terms, 'price_kobo', o.price_per_tonne_kobo::text,
               'floor_kobo', o.price_floor_per_tonne_kobo::text, 'formula', o.price_formula,
               'delivery_window_start', o.delivery_window_start,
               'delivery_window_end', o.delivery_window_end, 'signed_on', o.signed_on,
               'status', o.status) order by o.created_at), '[]')
        from public.offtake_contracts o where o.cycle_id = p_cycle_id),
    'insurance', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'insurer_name', i.insurer_name, 'cover_type', i.cover_type,
               'sum_insured_kobo', i.sum_insured_kobo::text, 'loss_payee', i.loss_payee,
               'cover_start', i.cover_start, 'cover_end', i.cover_end) order by i.created_at), '[]')
        from public.insurance_policies i where i.cycle_id = p_cycle_id),
    -- Field checks: when, whether they passed, the crop's condition; photos only for funders.
    'visits', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'milestone_id', v.milestone_id, 'farm_id', v.farm_id, 'visited_at', v.visited_at,
               'passed', v.passed, 'gps_ok', v.gps_ok, 'crop_condition', v.crop_condition,
               'photo_paths', case when invested then to_jsonb(v.photo_paths) else '[]'::jsonb end)
             order by v.visited_at desc), '[]')
        from public.field_visits v
        join public.milestones m on m.id = v.milestone_id
       where m.cycle_id = p_cycle_id),
    'harvest', (
      select jsonb_build_object(
               'accepted_kg', coalesce(sum(weight_kg) filter (where grade <> 'rejected'), 0),
               'rejected_kg', coalesce(sum(weight_kg) filter (where grade = 'rejected'), 0),
               'deliveries', count(*))
        from public.harvest_deliveries where cycle_id = p_cycle_id and voided_at is null),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', e.kind, 'message', e.message, 'created_at', e.created_at)
             order by e.created_at desc), '[]')
        from public.cycle_events e
       where e.cycle_id = p_cycle_id
         and e.kind in ('approved', 'funded', 'verification_requested', 'milestone_verified',
                        'milestone_blocked', 'milestone_awaiting_verification', 'release_instructed',
                        'milestone_released', 'harvested', 'receipt', 'settlement_started',
                        'settled', 'refunded', 'cancelled')),
    'my_pledges', (
      select coalesce(jsonb_agg(private.pledge_json(p) order by p.pledged_at), '[]')
        from public.investment_pledges p
       where p.cycle_id = p_cycle_id and p.investor_id = auth.uid()));
end $$;

/** A pledge with its payment, refund and payouts, for the investor's own views. */
create function private.pledge_json(p public.investment_pledges) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id,
    'reference', p.reference,
    'cycle_id', p.cycle_id,
    'amount_kobo', p.amount_kobo::text,
    'status', case when p.status = 'pending'
                     and (p.pay_by < current_date or c.status <> 'open_for_funding')
                   then 'lapsed' else p.status end,
    'pledged_at', p.pledged_at,
    'cooling_off_ends_at', p.cooling_off_ends_at,
    'pay_by', p.pay_by,
    'disclosure_version', p.disclosure_version,
    'disclosure_acknowledged_at', p.disclosure_acknowledged_at,
    'received_on', fc.received_on,
    'trustee_reference', fc.trustee_reference,
    'refunded', fc.refund_entry_id is not null,
    'refunded_at', (select posted_at from public.journal_entries where id = fc.refund_entry_id),
    'payouts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'amount_kobo', sp.amount_kobo::text, 'capital_kobo', sp.capital_kobo::text,
               'status', sp.status, 'paid_at', sp.paid_at, 'created_at', sp.created_at)
             order by sp.created_at), '[]')
        from public.settlement_payouts sp where sp.contribution_id = p.contribution_id))
  from public.cycles c
  left join public.funding_contributions fc on fc.id = p.contribution_id
  where c.id = p.cycle_id
$$;

/** Everything the signed-in investor has pledged, with each cycle's card and their cap. */
create function public.my_investments() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.investor_settings := private.settings();
begin
  if not public.is_investor() then
    raise exception 'Only investor accounts have investments' using errcode = 'PT403';
  end if;
  return jsonb_build_object(
    'cap', private.investor_cap(auth.uid()),
    'escrow', jsonb_build_object('bank_name', s.escrow_bank_name,
                                 'account_name', s.escrow_account_name,
                                 'account_number', s.escrow_account_number),
    'pledges', (
      select coalesce(jsonb_agg(private.pledge_json(p)
                                || jsonb_build_object('cycle', private.listing_summary(p.cycle_id))
                                order by p.pledged_at desc), '[]')
        from public.investment_pledges p where p.investor_id = auth.uid()));
end $$;

-- -----------------------------------------------------------------------------
-- Function permissions
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.is_investor(),
  public.submit_investor_kyc(text, public.investor_class, text, text, bigint, bigint, text, text, text, text),
  public.review_investor_kyc(uuid, boolean, public.investor_class, text),
  public.my_investment_cap(),
  public.record_funding(uuid, text, public.funder_kind, bigint, text, date),
  public.pledge_investment(uuid, bigint, integer),
  public.withdraw_pledge(uuid),
  public.confirm_pledge_payment(uuid, text, date),
  public.can_read_field_photo(text),
  public.investor_marketplace(),
  public.investor_listing(uuid),
  public.my_investments()
to authenticated;
