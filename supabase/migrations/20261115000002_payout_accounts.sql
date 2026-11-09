-- =============================================================================
-- Agrowth 2.0 — payout accounts for farmers, outside funders and the operator
--
-- Settlement payouts to farmers, to funders who didn't come through the portal, and the
-- platform's fee had no bank account on file, so they could only be paid by hand. Now
-- each can have one, and then be paid from a payment file or through the gateway like
-- any other payment.
--
--   * Farmers: set by field agents or compliance. Because it decides where a farmer's
--     money goes, the account holder's name must carry the farmer's own first and last
--     names; and the gateway checks the bank holds the account in that name before it
--     pays. Who set it, and when, is kept.
--   * Outside funders: set by the trustee on their deposit.
--   * The operator's fee account: set by an admin.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Farmers
-- -----------------------------------------------------------------------------

alter table public.farmers
  add column bank_name varchar(120),
  add column account_number char(10) check (account_number ~ '^[0-9]{10}$'),
  add column account_name varchar(200),
  add column bank_updated_by uuid references public.profiles (id) on delete restrict,
  add column bank_updated_at timestamptz,
  add constraint farmers_bank_complete check (
    (bank_name is null) = (account_number is null) and (account_number is null) = (account_name is null));

/** The words of a name, for comparing: lower case, letters only. */
create function private.name_words(p_name text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(w), '{}')
    from regexp_split_to_table(lower(regexp_replace(coalesce(p_name, ''), '[^A-Za-z ]', ' ', 'g')), '\s+') w
   where length(w) > 1
$$;

/**
 * Sets (or, with nulls, removes) a farmer's payout account. The account holder's name
 * must include the farmer's first and last names, in any order.
 */
create function public.set_farmer_bank_account(
  p_farmer_id uuid,
  p_bank_name text,
  p_account_number text,
  p_account_name text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.farmers;
  holder text[] := private.name_words(p_account_name);
begin
  if not (public.is_enroller() or public.is_kyc_reviewer()) then
    raise exception 'Your role cannot change farmers'' payout accounts' using errcode = 'PT403';
  end if;
  select * into f from public.farmers where id = p_farmer_id for update;
  if not found then
    raise exception 'Farmer not found' using errcode = 'PT404';
  end if;

  if p_account_number is null then
    update public.farmers
       set bank_name = null, account_number = null, account_name = null,
           bank_updated_by = auth.uid(), bank_updated_at = now()
     where id = f.id;
    return;
  end if;
  if coalesce(length(trim(p_bank_name)), 0) < 2 then
    raise exception 'Choose the bank' using errcode = 'PT400';
  end if;
  if regexp_replace(p_account_number, '\s', '', 'g') !~ '^[0-9]{10}$' then
    raise exception 'An account number is 10 digits' using errcode = 'PT400';
  end if;
  if not (private.name_words(f.first_name) <@ holder and private.name_words(f.last_name) <@ holder) then
    raise exception 'The account must be in the farmer''s own name (%): the money is theirs', f.full_name
      using errcode = 'PT400';
  end if;
  update public.farmers
     set bank_name = trim(p_bank_name),
         account_number = regexp_replace(p_account_number, '\s', '', 'g'),
         account_name = trim(p_account_name),
         bank_updated_by = auth.uid(), bank_updated_at = now()
   where id = f.id;
end $$;

-- -----------------------------------------------------------------------------
-- Funders outside the portal
-- -----------------------------------------------------------------------------

alter table public.funding_contributions
  add column payout_bank_name varchar(120),
  add column payout_account_number char(10) check (payout_account_number ~ '^[0-9]{10}$'),
  add column payout_account_name varchar(200),
  add constraint funding_payout_complete check (
    (payout_bank_name is null) = (payout_account_number is null)
    and (payout_account_number is null) = (payout_account_name is null));

/** The trustee sets where a funder outside the portal is paid back. */
create function public.set_contribution_payout_account(
  p_contribution_id uuid,
  p_bank_name text,
  p_account_number text,
  p_account_name text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  fc public.funding_contributions;
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can set where funders are paid' using errcode = 'PT403';
  end if;
  select * into fc from public.funding_contributions where id = p_contribution_id for update;
  if not found then
    raise exception 'Deposit not found' using errcode = 'PT404';
  end if;
  if fc.investor_id is not null then
    raise exception 'Portal investors are paid to the account in their own profile' using errcode = 'PT400';
  end if;
  if p_account_number is not null then
    if coalesce(length(trim(p_bank_name)), 0) < 2 or coalesce(length(trim(p_account_name)), 0) < 2 then
      raise exception 'Give the bank and the account name' using errcode = 'PT400';
    end if;
    if regexp_replace(p_account_number, '\s', '', 'g') !~ '^[0-9]{10}$' then
      raise exception 'An account number is 10 digits' using errcode = 'PT400';
    end if;
  end if;
  update public.funding_contributions
     set payout_bank_name = nullif(trim(p_bank_name), ''),
         payout_account_number = nullif(regexp_replace(coalesce(p_account_number, ''), '\s', '', 'g'), ''),
         payout_account_name = nullif(trim(p_account_name), '')
   where id = fc.id;
end $$;

-- -----------------------------------------------------------------------------
-- The operator's fee account
-- -----------------------------------------------------------------------------

create table public.operator_settings (
  id boolean primary key default true check (id),
  fee_bank_name varchar(120),
  fee_account_number char(10) check (fee_account_number ~ '^[0-9]{10}$'),
  fee_account_name varchar(200),
  updated_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  check ((fee_bank_name is null) = (fee_account_number is null)
         and (fee_account_number is null) = (fee_account_name is null))
);
insert into public.operator_settings default values;

alter table public.operator_settings enable row level security;
revoke all on public.operator_settings from anon, authenticated;
grant select on public.operator_settings to authenticated;
create policy operator_settings_read on public.operator_settings for select to authenticated
  using ((select public.is_ledger_reader()));

/** The admin sets the account the platform's management fee is paid to. */
create function public.set_operator_fee_account(
  p_bank_name text,
  p_account_number text,
  p_account_name text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can set the operator''s account' using errcode = 'PT403';
  end if;
  if p_account_number is not null then
    if coalesce(length(trim(p_bank_name)), 0) < 2 or coalesce(length(trim(p_account_name)), 0) < 2 then
      raise exception 'Give the bank and the account name' using errcode = 'PT400';
    end if;
    if regexp_replace(p_account_number, '\s', '', 'g') !~ '^[0-9]{10}$' then
      raise exception 'An account number is 10 digits' using errcode = 'PT400';
    end if;
  end if;
  update public.operator_settings
     set fee_bank_name = nullif(trim(p_bank_name), ''),
         fee_account_number = nullif(regexp_replace(coalesce(p_account_number, ''), '\s', '', 'g'), ''),
         fee_account_name = nullif(trim(p_account_name), ''),
         updated_by = auth.uid(), updated_at = now();
end $$;

-- -----------------------------------------------------------------------------
-- The payments the trustee makes, now with these accounts
-- -----------------------------------------------------------------------------

create or replace function private.outbound_payments()
returns table (
  kind public.payment_item_kind,
  item_id uuid,
  cycle_id uuid,
  reference text,
  payee_name text,
  bank_name text,
  account_number text,
  account_name text,
  amount_kobo bigint,
  narration text,
  paid boolean,
  trustee_reference text,
  problem text,
  created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select 'disbursement'::public.payment_item_kind, d.id, d.cycle_id,
         private.payment_reference(d.id), d.payee_name::text,
         nullif(trim(regexp_replace(d.payee_account, '[0-9]{10}', '')), ''),
         substring(d.payee_account from '[0-9]{10}'),
         d.payee_name::text, d.amount_kobo,
         left(private.payment_reference(d.id) || ' ' || d.purpose, 60),
         d.status = 'executed', d.trustee_reference::text,
         case when substring(d.payee_account from '[0-9]{10}') is null
              then 'The payee details have no 10-digit account number' end,
         d.instructed_at
    from public.disbursements d
   where d.payee_kind <> 'input_voucher' and d.status <> 'cancelled'
  union all
  select 'vendor_payment', r.id, r.cycle_id, private.payment_reference(r.id), v.name::text,
         v.bank_name::text, v.account_number::text, v.account_name::text, r.amount_kobo,
         left(private.payment_reference(r.id) || ' Voucher inputs ' || r.items, 60),
         r.paid_at is not null, r.trustee_reference::text,
         case when v.status <> 'approved'
              then format('%s is %s, so its payments are on hold', v.name, v.status) end,
         r.redeemed_at
    from public.voucher_redemptions r
    join public.vendors v on v.id = r.vendor_id
   where r.voided_at is null
  union all
  select 'settlement_payout', p.id, p.cycle_id, private.payment_reference(p.id), p.payee_name::text,
         acct.bank::text, acct.number::text, acct.holder::text, p.amount_kobo,
         left(private.payment_reference(p.id) || ' ' || case p.kind
           when 'funder' then 'Settlement payout'
           when 'farmer' then 'Harvest surplus'
           else 'Management fee' end, 60),
         p.status = 'executed', p.trustee_reference::text,
         case when acct.number is null then case p.kind
           when 'farmer' then 'No bank account on file for this farmer: add it on their page, or pay directly and confirm it on the cycle'
           when 'platform_fee' then 'No fee account set for the operator: an admin sets it on Bank files, or pay directly and confirm it on the cycle'
           else 'No bank account on file for this funder: add it on the cycle''s Funding tab, or pay directly and confirm it on the cycle' end end,
         p.created_at
    from public.settlement_payouts p
    left join public.funding_contributions fc on fc.id = p.contribution_id
    left join public.investor_profiles ip on ip.user_id = fc.investor_id
    left join public.farmers fr on fr.id = p.farmer_id
    cross join public.operator_settings os
    cross join lateral (
      select case p.kind
               when 'funder' then coalesce(ip.bank_name, fc.payout_bank_name)
               when 'farmer' then fr.bank_name
               else os.fee_bank_name end as bank,
             case p.kind
               when 'funder' then coalesce(ip.account_number, fc.payout_account_number)
               when 'farmer' then fr.account_number
               else os.fee_account_number end as number,
             case p.kind
               when 'funder' then coalesce(ip.account_name, fc.payout_account_name)
               when 'farmer' then fr.account_name
               else os.fee_account_name end as holder
    ) acct
   where p.status <> 'cancelled'
$$;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.set_farmer_bank_account(uuid, text, text, text),
  public.set_contribution_payout_account(uuid, text, text, text),
  public.set_operator_fee_account(text, text, text)
to authenticated;
