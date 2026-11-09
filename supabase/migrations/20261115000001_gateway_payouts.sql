-- =============================================================================
-- Agrowth 2.0 — paying out through the payment gateway
--
-- The trustee can now make a payment through Paystack's transfers instead of its own
-- bank: settlement payouts, vendor payments for vouchers and release payments, wherever
-- the payee's bank account is on file. Confirming a payment by hand, with the bank's
-- reference, stays; the trustee chooses either way.
--
--   1. The trustee picks payments. The payouts Edge Function opens a transfer for each
--      here (start_gateway_payouts, as the trustee).
--   2. For each, it asks the gateway whose account it is. If the name the bank holds
--      doesn't match the payee, the transfer is held for the trustee and nothing is sent.
--   3. Otherwise it sends the transfer from the trustee's Paystack balance. The gateway
--      reports the outcome (straight away or by webhook) and complete_gateway_transfer,
--      service role only, records it: a successful transfer confirms the payment exactly
--      as the trustee would, under the gateway's reference; a failed one puts the payment
--      back with those waiting.
--
-- The Paystack account must be the trustee's own, so custody doesn't change. A payment
-- can't be both in a bank payment file and in a gateway transfer, so it can't be paid twice.
-- Simulated transfers are refused unless an admin allows simulated payments.
-- =============================================================================

create type public.gateway_transfer_status as enum (
  'pending',       -- opened; not sent yet
  'sent',          -- sent; waiting for the gateway to say it arrived
  'paid',          -- arrived, and the payment confirmed
  'failed',        -- not paid; the payment is back with those waiting
  'needs_review'   -- held: the account name didn't match, the gateway wants an OTP,
                   -- or the outcome is unclear. Check the gateway before anything else.
);

create table public.gateway_transfers (
  -- Also the reference sent to the gateway, so its reports find their way back.
  id uuid primary key default gen_random_uuid(),
  kind public.payment_item_kind not null,
  item_id uuid not null,
  cycle_id uuid not null references public.cycles (id) on delete restrict,
  provider varchar(40) not null check (provider ~ '^[a-z0-9_-]{2,40}$'),
  amount_kobo bigint not null check (amount_kobo > 0),
  payee_name varchar(200) not null,
  bank_name varchar(120),
  bank_code varchar(10) not null check (bank_code ~ '^[0-9]{3,6}$'),
  account_number char(10) not null check (account_number ~ '^[0-9]{10}$'),
  account_name varchar(200) not null,
  -- The name the bank holds for the account, from the gateway's look-up.
  resolved_account_name varchar(200),
  status public.gateway_transfer_status not null default 'pending',
  provider_reference varchar(120),
  message varchar(500),
  requested_by uuid not null references public.profiles (id) on delete restrict,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status in ('paid', 'failed')) = (completed_at is not null))
);
-- One live transfer per payment.
create unique index gateway_transfers_live_idx on public.gateway_transfers (kind, item_id)
  where status in ('pending', 'sent', 'needs_review');

alter table public.gateway_transfers enable row level security;
revoke all on public.gateway_transfers from anon, authenticated;
grant select on public.gateway_transfers to authenticated;
create policy gateway_transfers_read on public.gateway_transfers for select to authenticated
  using ((select public.is_ledger_reader()));

/** Is a payment out through the gateway right now? */
create function private.in_live_transfer(p_kind public.payment_item_kind, p_item_id uuid)
returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.gateway_transfers
                  where kind = p_kind and item_id = p_item_id
                    and status in ('pending', 'sent', 'needs_review'))
$$;

/** A payment going through the gateway can't also go in a bank payment file. */
create function private.batch_item_not_in_transfer() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.in_live_transfer(new.kind, new.item_id) then
    raise exception '% (%) is being paid through the payment gateway', new.reference, new.payee_name
      using errcode = 'PT409';
  end if;
  return new;
end $$;
create trigger payment_batch_items_not_in_transfer before insert on public.payment_batch_items
for each row execute function private.batch_item_not_in_transfer();

/**
 * The trustee opens transfers for payments. p_items is a JSON array of
 * { kind, item_id, bank_code }: the payments function works out each bank's code.
 * Returns the transfers, with what to send.
 */
create function public.start_gateway_payouts(p_items jsonb, p_provider text)
returns setof public.gateway_transfers
language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  o record;
  provider text := lower(trim(coalesce(p_provider, '')));
  new_id uuid;
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can make payments' using errcode = 'PT403';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Choose at least one payment' using errcode = 'PT400';
  end if;
  if provider = 'mock' and not (select allow_simulated_payments from private.settings()) then
    raise exception 'Simulated payments are switched off' using errcode = 'PT400';
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    select * into o from private.outbound_payments() op
     where op.kind::text = item ->> 'kind' and op.item_id::text = item ->> 'item_id';
    if not found then
      raise exception 'Payment % not found', coalesce(item ->> 'item_id', '?') using errcode = 'PT404';
    end if;
    if o.paid then
      raise exception '% (%) is already paid', o.reference, o.payee_name using errcode = 'PT409';
    end if;
    if o.problem is not null then
      raise exception '% (%): %', o.reference, o.payee_name, o.problem using errcode = 'PT400';
    end if;
    if coalesce(item ->> 'bank_code', '') !~ '^[0-9]{3,6}$' then
      raise exception '% (%): the bank "%" isn''t one the gateway can pay; pay it from the bank instead',
        o.reference, o.payee_name, coalesce(o.bank_name, '?') using errcode = 'PT400';
    end if;
    if exists (select 1 from public.payment_batch_items
                where kind = o.kind and item_id = o.item_id and withdrawn_at is null) then
      raise exception '% (%) is in a bank payment file. Withdraw it from the file first.',
        o.reference, o.payee_name using errcode = 'PT409';
    end if;
    if private.in_live_transfer(o.kind, o.item_id) then
      raise exception '% (%) is already being paid through the gateway', o.reference, o.payee_name
        using errcode = 'PT409';
    end if;

    insert into public.gateway_transfers (
      kind, item_id, cycle_id, provider, amount_kobo, payee_name, bank_name, bank_code,
      account_number, account_name, requested_by
    ) values (
      o.kind, o.item_id, o.cycle_id, provider, o.amount_kobo, o.payee_name, o.bank_name,
      item ->> 'bank_code', o.account_number, o.account_name, auth.uid()
    ) returning id into new_id;
    return query select * from public.gateway_transfers where id = new_id;
  end loop;
end $$;

/**
 * Records a transfer's progress before it's settled: sent (with the gateway's reference),
 * or held for review (with the reason). Service role only.
 */
create function public.record_gateway_transfer(
  p_transfer_id uuid,
  p_status public.gateway_transfer_status,
  p_provider_reference text default null,
  p_resolved_account_name text default null,
  p_message text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then
    raise exception 'Only the payments service can record transfers' using errcode = 'PT403';
  end if;
  if p_status not in ('sent', 'needs_review') then
    raise exception 'Use complete_gateway_transfer to settle a transfer' using errcode = 'PT400';
  end if;
  update public.gateway_transfers
     set status = p_status,
         provider_reference = coalesce(left(nullif(trim(p_provider_reference), ''), 120), provider_reference),
         resolved_account_name = coalesce(left(nullif(trim(p_resolved_account_name), ''), 200), resolved_account_name),
         message = left(nullif(trim(p_message), ''), 500)
   where id = p_transfer_id and status in ('pending', 'sent');
  if not found then
    raise exception 'No open transfer with this id' using errcode = 'PT404';
  end if;
end $$;

/**
 * The gateway's final word on a transfer. Paid: the payment is confirmed as the trustee
 * would, by the trustee who sent it, under the gateway's reference. Failed: the payment
 * goes back with those waiting. Reports after the first are ignored, except a reversal of
 * a paid transfer, which is held for the trustee. Service role only. Returns the status.
 */
create function public.complete_gateway_transfer(
  p_transfer_id uuid,
  p_succeeded boolean,
  p_provider_reference text default null,
  p_message text default null,
  p_reversed boolean default false
) returns public.gateway_transfer_status
language plpgsql security definer set search_path = '' as $$
declare
  t public.gateway_transfers;
  ref text;
  claims text;
  problem text;
  result public.gateway_transfer_status;
begin
  if not private.is_service() then
    raise exception 'Only the payments service can record transfers' using errcode = 'PT403';
  end if;
  select * into t from public.gateway_transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'No gateway transfer %', p_transfer_id using errcode = 'PT404';
  end if;

  if p_reversed and t.status = 'paid' then
    update public.gateway_transfers
       set status = 'needs_review', completed_at = null,
           message = left('The gateway reversed this transfer after it was confirmed. The money is back in the trustee''s Paystack balance; reverse the payment in the books and pay it again.', 500)
     where id = t.id;
    return 'needs_review';
  end if;
  if t.status not in ('pending', 'sent', 'needs_review') then
    return t.status;
  end if;

  if not p_succeeded then
    update public.gateway_transfers
       set status = 'failed', completed_at = now(),
           provider_reference = coalesce(left(nullif(trim(p_provider_reference), ''), 120), provider_reference),
           message = left(coalesce(nullif(trim(p_message), ''), 'The transfer failed'), 500)
     where id = t.id;
    return 'failed';
  end if;

  ref := left(upper(t.provider) || '-' || coalesce(nullif(trim(p_provider_reference), ''),
                                                    t.provider_reference, t.id::text), 120);
  -- Confirm it as the trustee who sent it: the same checks, the same ledger entry.
  claims := current_setting('request.jwt.claims', true);
  begin
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', t.requested_by, 'role', 'service_role')::text, true);
    case t.kind
      when 'disbursement' then perform public.confirm_disbursement(t.item_id, ref);
      when 'vendor_payment' then perform public.confirm_redemption_payment(t.item_id, ref);
      else perform public.confirm_settlement_payout(t.item_id, ref);
    end case;
    result := 'paid';
  exception when others then
    get stacked diagnostics problem = message_text;
    result := 'needs_review';
    problem := format('Paid by the gateway, but the payment couldn''t be confirmed in the books: %s', problem);
  end;
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);

  update public.gateway_transfers
     set status = result,
         completed_at = case when result = 'paid' then now() end,
         provider_reference = coalesce(left(nullif(trim(p_provider_reference), ''), 120), provider_reference),
         message = left(coalesce(problem, nullif(trim(p_message), '')), 500)
   where id = t.id;
  return result;
end $$;

/**
 * The trustee lets go of a held transfer, once it has checked the gateway: nothing was
 * paid (a name mismatch, an OTP never given), so the payment goes back with those
 * waiting. Not for transfers the gateway may have paid; those are completed by its report.
 */
create function public.cancel_gateway_transfer(p_transfer_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can cancel transfers' using errcode = 'PT403';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Say what you checked, e.g. "Nothing sent: the account name didn''t match"'
      using errcode = 'PT400';
  end if;
  update public.gateway_transfers
     set status = 'failed', completed_at = now(),
         message = left(format('Cancelled by the trustee: %s', trim(p_note)), 500)
   where id = p_transfer_id and status = 'needs_review';
  if not found then
    raise exception 'Only a held transfer can be cancelled' using errcode = 'PT409';
  end if;
end $$;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function
  public.record_gateway_transfer(uuid, public.gateway_transfer_status, text, text, text),
  public.complete_gateway_transfer(uuid, boolean, text, text, boolean)
from authenticated;
grant execute on function
  public.record_gateway_transfer(uuid, public.gateway_transfer_status, text, text, text),
  public.complete_gateway_transfer(uuid, boolean, text, text, boolean)
to service_role;
grant execute on function
  public.start_gateway_payouts(jsonb, text),
  public.cancel_gateway_transfer(uuid, text)
to authenticated;
