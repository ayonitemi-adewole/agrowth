-- =============================================================================
-- Agrowth 2.0 — online payments: investors pay pledges through a payment gateway
--
-- Until now an investor paid a pledge by bank transfer, quoting its reference, and the
-- trustee confirmed it (by hand or from the bank statement). Now they can also pay online
-- (card, bank transfer, USSD) through a gateway such as Paystack:
--
--   1. Once the pledge's cooling-off is over, the investor starts a payment. The
--      payments Edge Function opens a payment attempt here (start_online_payment, as the
--      investor) and a checkout at the gateway. The gateway's fee is added on top, so
--      the trustee receives the pledge in full.
--   2. The gateway reports the outcome, to the function's webhook and when the investor
--      returns. The function records it with complete_online_payment, which only the
--      service role can call. Reports after the first are ignored.
--   3. A successful payment confirms the pledge exactly as the trustee would: a deposit
--      to the cycle, posted to the ledger under the gateway's transaction reference.
--      If the pledge can no longer take money (withdrawn, lapsed, the cycle closed) or the
--      amount is wrong, the payment is marked for the trustee to refund or review.
--
-- The gateway settles into the trustee's escrow account, so custody doesn't change: the
-- platform never holds the money. Payouts are unaffected (the trustee's bank files).
--
-- The simulated gateway's payments are refused unless an admin allows them, so a
-- production system can't be paid with play money even if it's misconfigured.
-- =============================================================================

alter table public.investor_settings
  add column allow_simulated_payments boolean not null default false;
grant update (allow_simulated_payments) on public.investor_settings to authenticated;

create type public.online_payment_status as enum (
  'initiated',     -- checkout opened; no answer from the gateway yet
  'succeeded',     -- paid, and the pledge confirmed
  'failed',        -- declined or abandoned at the gateway
  'needs_refund',  -- paid, but the pledge could no longer take it: the trustee refunds it
  'needs_review',  -- paid, but not the amount expected
  'resolved'       -- a refund or review the trustee has dealt with, noted
);

create table public.online_payments (
  id uuid primary key default gen_random_uuid(),
  -- Ours, sent to the gateway: AGC- and 12 characters.
  reference varchar(20) not null unique,
  pledge_id uuid not null references public.investment_pledges (id) on delete restrict,
  investor_id uuid not null references public.investor_profiles (user_id) on delete restrict,
  cycle_id uuid not null references public.cycles (id) on delete restrict,
  provider varchar(40) not null check (provider ~ '^[a-z0-9_-]{2,40}$'),
  amount_kobo bigint not null check (amount_kobo > 0),
  -- The gateway's fee, paid by the investor on top of the pledge.
  fee_kobo bigint not null check (fee_kobo >= 0),
  charge_kobo bigint not null,
  status public.online_payment_status not null default 'initiated',
  -- From the gateway: its transaction id, how it was paid, how much, when.
  provider_reference varchar(120),
  channel varchar(40),
  paid_kobo bigint,
  paid_at timestamptz,
  note varchar(500),
  contribution_id uuid unique references public.funding_contributions (id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (charge_kobo = amount_kobo + fee_kobo),
  check ((status = 'initiated') = (completed_at is null)),
  check ((status = 'succeeded') = (contribution_id is not null))
);
create index online_payments_pledge_idx on public.online_payments (pledge_id);
create index online_payments_open_idx on public.online_payments (status)
  where status in ('needs_refund', 'needs_review');

alter table public.online_payments enable row level security;
revoke all on public.online_payments from anon, authenticated;
grant select on public.online_payments to authenticated;
create policy online_payments_read on public.online_payments for select to authenticated
  using (investor_id = (select auth.uid()) or (select public.is_ledger_reader()));

/**
 * The signed-in investor starts paying a pledge online. Returns the attempt's reference
 * and what to charge, for the payments function to open the gateway's checkout.
 */
create function public.start_online_payment(
  p_pledge_id uuid,
  p_provider text,
  p_fee_kobo bigint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.investment_pledges;
  provider text := lower(trim(coalesce(p_provider, '')));
  ref text;
  email text;
  cycle_code text;
begin
  if not public.is_investor() then
    raise exception 'Only investors pay pledges online' using errcode = 'PT403';
  end if;
  select * into p from public.investment_pledges where id = p_pledge_id for update;
  if not found or p.investor_id <> auth.uid() then
    raise exception 'Pledge not found' using errcode = 'PT404';
  end if;
  perform private.lapse_pledges(p.cycle_id);
  select * into p from public.investment_pledges where id = p_pledge_id;
  if p.status <> 'pending' then
    raise exception 'This pledge is %; there is nothing to pay', p.status using errcode = 'PT409';
  end if;
  if now() < p.cooling_off_ends_at then
    raise exception 'You can pay once your cooling-off period ends, at %',
      to_char(p.cooling_off_ends_at at time zone 'Africa/Lagos', 'DD Mon YYYY HH24:MI') || ' WAT'
      using errcode = 'PT409';
  end if;
  if provider = 'mock' and not (select allow_simulated_payments from private.settings()) then
    raise exception 'Simulated payments are switched off' using errcode = 'PT400';
  end if;
  if provider !~ '^[a-z0-9_-]{2,40}$' then
    raise exception 'Unknown payment provider' using errcode = 'PT400';
  end if;
  -- The gateway's fee is a few percent at most; anything more is a mistake.
  if p_fee_kobo is null or p_fee_kobo < 0 or p_fee_kobo > p.amount_kobo / 20 + 2_000_00 then
    raise exception 'The payment fee is out of range' using errcode = 'PT400';
  end if;

  ref := 'AGC-' || upper(encode(extensions.gen_random_bytes(6), 'hex'));
  insert into public.online_payments (
    reference, pledge_id, investor_id, cycle_id, provider, amount_kobo, fee_kobo, charge_kobo
  ) values (
    ref, p.id, p.investor_id, p.cycle_id, provider, p.amount_kobo, p_fee_kobo,
    p.amount_kobo + p_fee_kobo
  );

  select pr.email into email from public.profiles pr where pr.id = auth.uid();
  select c.code into cycle_code from public.cycles c where c.id = p.cycle_id;
  return jsonb_build_object(
    'reference', ref,
    'amount_kobo', p.amount_kobo::text,
    'fee_kobo', p_fee_kobo::text,
    'charge_kobo', (p.amount_kobo + p_fee_kobo)::text,
    'email', email,
    'pledge_reference', p.reference,
    'cycle_code', cycle_code);
end $$;

/**
 * Records the gateway's answer about a payment. Only the payments function (service role)
 * can call it. The first answer counts; later ones return the status already recorded.
 */
create function public.complete_online_payment(
  p_reference text,
  p_succeeded boolean,
  p_paid_kobo bigint default null,
  p_provider_reference text default null,
  p_channel text default null,
  p_paid_at timestamptz default null,
  p_message text default null
) returns public.online_payment_status
language plpgsql security definer set search_path = '' as $$
declare
  op public.online_payments;
  p public.investment_pledges;
  ip public.investor_profiles;
  ledger_ref text;
  paid_on date;
  claims text;
  contribution uuid;
  problem text;
  result public.online_payment_status;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
     <> 'service_role' then
    raise exception 'Only the payments service can record a payment' using errcode = 'PT403';
  end if;
  select * into op from public.online_payments where reference = p_reference for update;
  if not found then
    raise exception 'No online payment %', p_reference using errcode = 'PT404';
  end if;
  if op.status <> 'initiated' then
    return op.status;
  end if;

  if not p_succeeded then
    problem := coalesce(nullif(trim(p_message), ''), 'Not paid');
    result := 'failed';
  elsif op.provider = 'mock' and not (select allow_simulated_payments from private.settings()) then
    problem := 'Simulated payments are switched off; this payment was not recorded';
    result := 'needs_review';
  elsif p_paid_kobo is distinct from op.charge_kobo then
    problem := format('%s was charged, but %s was expected', private.format_naira(coalesce(p_paid_kobo, 0)),
                      private.format_naira(op.charge_kobo));
    result := 'needs_review';
  else
    select * into p from public.investment_pledges where id = op.pledge_id for update;
    perform private.lapse_pledges(p.cycle_id);
    select * into p from public.investment_pledges where id = op.pledge_id;
    paid_on := (coalesce(p_paid_at, now()) at time zone 'Africa/Lagos')::date;
    if p.status <> 'pending' then
      problem := format('Pledge %s was already %s when this payment arrived', p.reference, p.status);
      result := 'needs_refund';
    elsif paid_on > p.pay_by then
      problem := format('Pledge %s had to be paid by %s', p.reference, to_char(p.pay_by, 'DD Mon YYYY'));
      result := 'needs_refund';
    end if;
  end if;

  if result is null then
    -- Confirm the pledge as the trustee would. The deposit is recorded as the investor's
    -- own payment (there is no trustee at the keyboard); its reference names the gateway.
    select * into ip from public.investor_profiles where user_id = p.investor_id;
    ledger_ref := left(upper(op.provider) || '-' || coalesce(nullif(trim(p_provider_reference), ''),
                                                             op.reference), 120);
    claims := current_setting('request.jwt.claims', true);
    begin
      perform set_config('request.jwt.claims',
        jsonb_build_object('sub', p.investor_id, 'role', 'service_role')::text, true);
      contribution := private.add_contribution(p.cycle_id, ip.legal_name, 'investor', p.amount_kobo,
        ledger_ref, paid_on, p.investor_id, p.id);
      update public.investment_pledges
         set status = 'paid', contribution_id = contribution, closed_at = now()
       where id = p.id;
      perform private.log_cycle_event(p.cycle_id, 'pledge_paid_online',
        format('Pledge %s (%s) paid online through %s', p.reference,
               private.format_naira(p.amount_kobo), op.provider),
        jsonb_build_object('pledge_id', p.id, 'online_payment_id', op.id));
      result := 'succeeded';
    exception when others then
      get stacked diagnostics problem = message_text;
      problem := format('Paid, but the pledge could not be confirmed: %s', problem);
      result := 'needs_refund';
      contribution := null;
    end;
    perform set_config('request.jwt.claims', coalesce(claims, ''), true);
  end if;

  update public.online_payments
     set status = result,
         contribution_id = contribution,
         note = left(problem, 500),
         provider_reference = left(nullif(trim(p_provider_reference), ''), 120),
         channel = left(nullif(trim(p_channel), ''), 40),
         paid_kobo = case when p_succeeded then p_paid_kobo end,
         paid_at = case when p_succeeded then coalesce(p_paid_at, now()) end,
         completed_at = now()
   where id = op.id;
  return result;
end $$;

/**
 * The trustee notes how a payment that needed a refund or review was resolved, e.g. the
 * refund's bank reference.
 */
create function public.resolve_online_payment(p_payment_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can resolve online payments' using errcode = 'PT403';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Say how it was resolved, e.g. the refund''s bank reference' using errcode = 'PT400';
  end if;
  update public.online_payments
     set note = left(format('%s Resolved: %s', note, trim(p_note)), 500), status = 'resolved'
   where id = p_payment_id and status in ('needs_refund', 'needs_review');
  if not found then
    raise exception 'Only payments needing a refund or review can be resolved' using errcode = 'PT409';
  end if;
end $$;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function
  public.complete_online_payment(text, boolean, bigint, text, text, timestamptz, text)
from authenticated;
grant execute on function
  public.complete_online_payment(text, boolean, bigint, text, text, timestamptz, text)
to service_role;
grant execute on function
  public.start_online_payment(uuid, text, bigint),
  public.resolve_online_payment(uuid, text)
to authenticated;
