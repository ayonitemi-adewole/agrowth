-- =============================================================================
-- Agrowth 2.0 — harvest and settlement
--
--   1. Harvest: each weighed delivery to the offtaker is recorded per farm, with its
--      grade and waybill. The cycle manager marks the harvest complete once every
--      milestone has been released.
--   2. Receipts: the offtaker pays the trustee (and the insurer, after a claim).
--      The trustee records each receipt: Dr TRUSTEE_CASH / Cr HARVEST_PROCEEDS or
--      INSURANCE_RECOVERIES.
--   3. Settlement: the trustee runs the waterfall over the cash it holds for the cycle:
--        a. the management fee, a share of the capital raised (set before approval);
--        b. funders' capital back, pro rata to what each put in;
--        c. any profit is split: the funders' agreed share pro rata, the rest to the
--           farmers in proportion to the kilograms they delivered.
--      If the cash doesn't cover the capital, funders bear the loss pro rata.
--   4. The trustee pays each payout and confirms it here. When the last one is paid the
--      cycle is settled and its trustee cash is exactly zero.
-- =============================================================================

alter table public.cycles
  -- Settlement terms, fixed at approval like every other term of the cycle.
  add column management_fee_bps integer not null default 0
    check (management_fee_bps between 0 and 2000),
  add column funder_profit_share_bps integer not null default 3000
    check (funder_profit_share_bps between 0 and 10000),
  add column harvest_completed_at timestamptz,
  add column settlement_started_at timestamptz,
  add column settled_at timestamptz;

grant insert (management_fee_bps, funder_profit_share_bps),
      update (management_fee_bps, funder_profit_share_bps)
   on public.cycles to authenticated;

/** Who records harvest deliveries: field staff and cycle managers. */
create function public.is_harvest_recorder() returns boolean
language sql stable set search_path = '' as $$
  select public.has_any_role(
    array['admin', 'cycle_manager', 'programme_manager', 'field_agent']::public.user_role[])
$$;

/** Returns the cycle's account with this code, creating it on first use. */
create function private.ensure_cycle_account(
  p_cycle_id uuid, p_code text, p_name text, p_type public.account_type
) returns uuid
language plpgsql set search_path = '' as $$
begin
  insert into public.ledger_accounts (code, name, type, cycle_id)
  values (p_code, p_name, p_type, p_cycle_id)
  on conflict do nothing;
  return private.cycle_account(p_cycle_id, p_code);
end $$;

create function private.format_naira(p_kobo bigint) returns text
language sql immutable set search_path = '' as $$
  select '₦' || to_char(p_kobo / 100.0, 'FM999,999,999,990.00')
$$;

/**
 * Splits p_total kobo across keys in proportion to their integer weights, exactly:
 * each gets its floor share, and the leftover kobo go to the largest remainders.
 * p_weights is a JSON array of {"key", "weight"}.
 */
create function private.allocate(p_total bigint, p_weights jsonb)
returns table (key text, amount bigint)
language sql immutable set search_path = '' as $$
  with w as (
    select e ->> 'key' as key, (e ->> 'weight')::numeric as weight, ord
      from jsonb_array_elements(p_weights) with ordinality as t (e, ord)
  ),
  total as (select sum(weight) as weight from w),
  base as (
    select w.key, w.ord,
           div(p_total::numeric * w.weight, total.weight) as share,
           mod(p_total::numeric * w.weight, total.weight) as remainder
      from w, total
     where total.weight > 0
  ),
  ranked as (
    select base.*,
           row_number() over (order by remainder desc, ord) as rank,
           p_total - sum(share) over () as leftover
      from base
  )
  select key, (share + case when rank <= leftover then 1 else 0 end)::bigint
    from ranked
   order by ord
$$;

-- -----------------------------------------------------------------------------
-- Harvest deliveries
-- -----------------------------------------------------------------------------

create type public.harvest_grade as enum ('grade_a', 'grade_b', 'grade_c', 'rejected');

create table public.harvest_deliveries (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycles (id) on delete restrict,
  farm_id uuid not null references public.farms (id) on delete restrict,
  offtake_contract_id uuid not null references public.offtake_contracts (id) on delete restrict,
  delivered_on date not null,
  weight_kg integer not null check (weight_kg > 0 and weight_kg <= 1000000),
  grade public.harvest_grade not null,
  moisture_pct numeric(4, 1) check (moisture_pct between 0 and 100),
  -- The weighbridge ticket or waybill number, so every load can be traced.
  waybill_reference varchar(120) not null unique,
  notes text check (length(notes) <= 1000),
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  -- A mistaken entry is voided with a reason, never deleted.
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete restrict,
  void_reason text
);
create index harvest_deliveries_cycle_idx on public.harvest_deliveries (cycle_id);

create function public.record_harvest_delivery(
  p_cycle_id uuid,
  p_farm_id uuid,
  p_offtake_contract_id uuid,
  p_delivered_on date,
  p_weight_kg integer,
  p_grade public.harvest_grade,
  p_waybill_reference text,
  p_moisture_pct numeric default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cycles;
  new_id uuid;
begin
  if not public.is_harvest_recorder() then
    raise exception 'Your role cannot record harvest deliveries' using errcode = 'PT403';
  end if;
  select * into c from public.cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'Cycle not found' using errcode = 'PT404';
  end if;
  if c.status <> 'in_progress' then
    raise exception 'Deliveries can only be recorded while a cycle is in progress (it is %)', c.status
      using errcode = 'PT409';
  end if;
  if not exists (select 1 from public.cycle_farms where cycle_id = p_cycle_id and farm_id = p_farm_id) then
    raise exception 'That farm is not part of this cycle' using errcode = 'PT400';
  end if;
  if not exists (select 1 from public.offtake_contracts
                  where id = p_offtake_contract_id and cycle_id = p_cycle_id) then
    raise exception 'That offtake agreement is not part of this cycle' using errcode = 'PT400';
  end if;
  if coalesce(p_weight_kg, 0) <= 0 then
    raise exception 'Weight must be a positive number of kilograms' using errcode = 'PT400';
  end if;
  if p_delivered_on is null or p_delivered_on > current_date then
    raise exception 'A delivery cannot be dated in the future' using errcode = 'PT400';
  end if;
  if coalesce(trim(p_waybill_reference), '') = '' then
    raise exception 'The waybill or weighbridge ticket number is required' using errcode = 'PT400';
  end if;
  if exists (select 1 from public.harvest_deliveries where waybill_reference = trim(p_waybill_reference)) then
    raise exception 'Waybill % has already been recorded', trim(p_waybill_reference) using errcode = 'PT409';
  end if;

  insert into public.harvest_deliveries (
    cycle_id, farm_id, offtake_contract_id, delivered_on, weight_kg, grade, moisture_pct,
    waybill_reference, notes, recorded_by
  ) values (
    p_cycle_id, p_farm_id, p_offtake_contract_id, p_delivered_on, p_weight_kg, p_grade, p_moisture_pct,
    trim(p_waybill_reference), nullif(trim(p_notes), ''), auth.uid()
  ) returning id into new_id;

  perform private.log_cycle_event(p_cycle_id, 'harvest_delivered',
    format('%s kg delivered (%s), waybill %s', p_weight_kg, replace(p_grade::text, '_', ' '),
           trim(p_waybill_reference)),
    jsonb_build_object('delivery_id', new_id, 'farm_id', p_farm_id));
  return new_id;
end $$;

create function public.void_harvest_delivery(p_delivery_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.harvest_deliveries;
begin
  if not public.is_harvest_recorder() then
    raise exception 'Your role cannot change harvest deliveries' using errcode = 'PT403';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why the delivery is being voided' using errcode = 'PT400';
  end if;
  select * into d from public.harvest_deliveries where id = p_delivery_id for update;
  if not found then
    raise exception 'Delivery not found' using errcode = 'PT404';
  end if;
  if d.voided_at is not null then
    raise exception 'This delivery is already voided' using errcode = 'PT409';
  end if;
  if (select status from public.cycles where id = d.cycle_id) <> 'in_progress' then
    raise exception 'Deliveries can only be changed while the cycle is in progress' using errcode = 'PT409';
  end if;
  update public.harvest_deliveries
     set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
   where id = p_delivery_id;
  perform private.log_cycle_event(d.cycle_id, 'harvest_voided',
    format('Delivery %s voided: %s', d.waybill_reference, trim(p_reason)),
    jsonb_build_object('delivery_id', d.id));
end $$;

/** Ends the season: every milestone released, nothing left to pay. */
create function public.complete_harvest(p_cycle_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cycles;
  open_milestone public.milestones;
  kg bigint;
begin
  if not public.is_cycle_manager() then
    raise exception 'Only cycle or programme managers can complete a harvest' using errcode = 'PT403';
  end if;
  select * into c from public.cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'Cycle not found' using errcode = 'PT404';
  end if;
  if c.status <> 'in_progress' then
    raise exception 'Only a cycle in progress can complete its harvest (this one is %)', c.status
      using errcode = 'PT409';
  end if;
  select * into open_milestone from public.milestones
   where cycle_id = p_cycle_id and status <> 'released' order by sequence limit 1;
  if found then
    raise exception 'Milestone % (%) has not been released yet', open_milestone.sequence, open_milestone.name
      using errcode = 'PT409';
  end if;

  select coalesce(sum(weight_kg), 0) into kg from public.harvest_deliveries
   where cycle_id = p_cycle_id and voided_at is null and grade <> 'rejected';
  update public.cycles set status = 'harvested', harvest_completed_at = now() where id = p_cycle_id;
  perform private.log_cycle_event(p_cycle_id, 'harvested',
    format('Harvest complete: %s t accepted by the offtaker', to_char(kg / 1000.0, 'FM999,999,990.000')));
end $$;

-- -----------------------------------------------------------------------------
-- Receipts: offtake payments and insurance payouts
-- -----------------------------------------------------------------------------

create type public.receipt_kind as enum ('offtake_payment', 'insurance_payout');

create table public.cycle_receipts (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycles (id) on delete restrict,
  kind public.receipt_kind not null,
  offtake_contract_id uuid references public.offtake_contracts (id) on delete restrict,
  insurance_policy_id uuid references public.insurance_policies (id) on delete restrict,
  payer_name varchar(200) not null,
  amount_kobo bigint not null check (amount_kobo > 0),
  trustee_reference varchar(120) not null unique,
  received_on date not null,
  notes text check (length(notes) <= 1000),
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  journal_entry_id uuid not null unique references public.journal_entries (id),
  created_at timestamptz not null default now(),
  check ((kind = 'offtake_payment' and offtake_contract_id is not null and insurance_policy_id is null)
      or (kind = 'insurance_payout' and insurance_policy_id is not null and offtake_contract_id is null))
);
create index cycle_receipts_cycle_idx on public.cycle_receipts (cycle_id);

/** The trustee records money received for the cycle from its offtaker or insurer. */
create function public.record_cycle_receipt(
  p_cycle_id uuid,
  p_kind public.receipt_kind,
  p_source_id uuid,
  p_amount_kobo bigint,
  p_trustee_reference text,
  p_received_on date default current_date,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cycles;
  payer text;
  income_account uuid;
  entry uuid;
  new_id uuid;
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can record money received' using errcode = 'PT403';
  end if;
  select * into c from public.cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'Cycle not found' using errcode = 'PT404';
  end if;
  if c.status not in ('in_progress', 'harvested') or c.settlement_started_at is not null then
    raise exception 'Receipts can only be recorded before settlement, once a cycle is under way'
      using errcode = 'PT409';
  end if;
  if coalesce(p_amount_kobo, 0) <= 0 then
    raise exception 'Amount must be positive' using errcode = 'PT400';
  end if;
  if coalesce(trim(p_trustee_reference), '') = '' then
    raise exception 'The trustee reference is required' using errcode = 'PT400';
  end if;
  if p_received_on is null or p_received_on > current_date then
    raise exception 'A receipt cannot be dated in the future' using errcode = 'PT400';
  end if;
  if exists (select 1 from public.cycle_receipts where trustee_reference = trim(p_trustee_reference)) then
    raise exception 'Trustee reference % has already been recorded', trim(p_trustee_reference)
      using errcode = 'PT409';
  end if;

  if p_kind = 'offtake_payment' then
    select buyer_name into payer from public.offtake_contracts
     where id = p_source_id and cycle_id = p_cycle_id;
    income_account := private.ensure_cycle_account(p_cycle_id, 'HARVEST_PROCEEDS',
      'Harvest proceeds from the offtaker', 'income');
  else
    select insurer_name into payer from public.insurance_policies
     where id = p_source_id and cycle_id = p_cycle_id;
    income_account := private.ensure_cycle_account(p_cycle_id, 'INSURANCE_RECOVERIES',
      'Insurance claim payouts', 'income');
  end if;
  if payer is null then
    raise exception 'That % is not part of this cycle',
      case p_kind when 'offtake_payment' then 'offtake agreement' else 'insurance policy' end
      using errcode = 'PT400';
  end if;

  entry := private.post_journal_entry(
    p_cycle_id,
    left(format('%s from %s',
      case p_kind when 'offtake_payment' then 'Harvest payment' else 'Insurance payout' end, payer), 300),
    auth.uid(),
    jsonb_build_array(
      jsonb_build_object('account_id', private.cycle_account(p_cycle_id, 'TRUSTEE_CASH'),
                         'amount_kobo', p_amount_kobo::text),
      jsonb_build_object('account_id', income_account, 'amount_kobo', (-p_amount_kobo)::text,
                         'memo', payer)),
    trim(p_trustee_reference));

  insert into public.cycle_receipts (
    cycle_id, kind, offtake_contract_id, insurance_policy_id, payer_name, amount_kobo,
    trustee_reference, received_on, notes, recorded_by, journal_entry_id
  ) values (
    p_cycle_id, p_kind,
    case when p_kind = 'offtake_payment' then p_source_id end,
    case when p_kind = 'insurance_payout' then p_source_id end,
    payer, p_amount_kobo, trim(p_trustee_reference), p_received_on, nullif(trim(p_notes), ''),
    auth.uid(), entry
  ) returning id into new_id;

  perform private.log_cycle_event(p_cycle_id, 'receipt',
    format('%s received from %s', private.format_naira(p_amount_kobo), payer),
    jsonb_build_object('receipt_id', new_id));
  return new_id;
end $$;

-- -----------------------------------------------------------------------------
-- Settlement
-- -----------------------------------------------------------------------------

/**
 * The waterfall for a cycle as it stands now, as JSON (amounts in kobo, as strings
 * so no precision is lost). Used for the preview and, unchanged, by settle_cycle.
 */
create function private.compute_settlement(p_cycle_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  c public.cycles;
  cash bigint;
  capital bigint;
  deployed bigint;
  fee bigint;
  capital_back bigint;
  profit bigint;
  funder_return bigint;
  farmer_surplus bigint;
  accepted_kg bigint;
  funders jsonb;
  farmers jsonb;
begin
  select * into c from public.cycles where id = p_cycle_id;
  cash := private.account_balance(private.cycle_account(p_cycle_id, 'TRUSTEE_CASH'));
  deployed := private.account_balance(private.cycle_account(p_cycle_id, 'FARM_DEPLOYMENT'));
  select coalesce(sum(amount_kobo), 0) into capital from public.funding_contributions
   where cycle_id = p_cycle_id and refund_entry_id is null;
  select coalesce(sum(weight_kg), 0) into accepted_kg from public.harvest_deliveries
   where cycle_id = p_cycle_id and voided_at is null and grade <> 'rejected';

  fee := least(cash, round(capital * c.management_fee_bps / 10000.0)::bigint);
  capital_back := least(cash - fee, capital);
  profit := cash - fee - capital_back;
  -- With nothing delivered there is no one to share a farmer surplus with.
  funder_return := case when accepted_kg = 0 then profit
                        else round(profit * c.funder_profit_share_bps / 10000.0)::bigint end;
  farmer_surplus := profit - funder_return;

  with contributions as (
    select id, funder_name, amount_kobo, created_at from public.funding_contributions
     where cycle_id = p_cycle_id and refund_entry_id is null
  ),
  weights as (
    select coalesce(jsonb_agg(jsonb_build_object('key', id, 'weight', amount_kobo) order by created_at, id),
                    '[]') as w
      from contributions
  ),
  capital_shares as (select a.key::uuid as id, a.amount from weights, private.allocate(capital_back, w) a),
  return_shares as (select a.key::uuid as id, a.amount from weights, private.allocate(funder_return, w) a)
  select coalesce(jsonb_agg(jsonb_build_object(
           'contribution_id', fc.id,
           'name', fc.funder_name,
           'contributed', fc.amount_kobo::text,
           'capital', cs.amount::text,
           'return', rs.amount::text,
           'loss', (fc.amount_kobo - cs.amount)::text,
           'total', (cs.amount + rs.amount)::text)
         order by fc.created_at, fc.id), '[]')
    into funders
    from contributions fc
    join capital_shares cs on cs.id = fc.id
    join return_shares rs on rs.id = fc.id;

  with delivered as (
    select f.farmer_id, sum(d.weight_kg)::bigint as kg
      from public.harvest_deliveries d
      join public.farms f on f.id = d.farm_id
     where d.cycle_id = p_cycle_id and d.voided_at is null and d.grade <> 'rejected'
     group by f.farmer_id
  ),
  shares as (
    select a.key::uuid as farmer_id, a.amount
      from private.allocate(farmer_surplus,
             (select coalesce(jsonb_agg(jsonb_build_object('key', farmer_id, 'weight', kg)
                                        order by farmer_id), '[]') from delivered)) a
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'farmer_id', d.farmer_id, 'name', fa.full_name, 'kg', d.kg,
           'amount', coalesce(s.amount, 0)::text)
         order by fa.full_name, d.farmer_id), '[]')
    into farmers
    from delivered d
    join public.farmers fa on fa.id = d.farmer_id
    left join shares s on s.farmer_id = d.farmer_id;

  return jsonb_build_object(
    'cash', cash::text,
    'capital', capital::text,
    'deployed', deployed::text,
    'fee', fee::text,
    'capital_returned', capital_back::text,
    'capital_loss', (capital - capital_back)::text,
    'profit', profit::text,
    'funder_return', funder_return::text,
    'farmer_surplus', farmer_surplus::text,
    'accepted_kg', accepted_kg,
    'management_fee_bps', c.management_fee_bps,
    'funder_profit_share_bps', c.funder_profit_share_bps,
    'funders', funders,
    'farmers', farmers);
end $$;

/** What settlement would pay out if it ran now. */
create function public.settlement_preview(p_cycle_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st public.cycle_status;
begin
  if not public.is_cycle_reader() then
    raise exception 'Your role cannot see cycles' using errcode = 'PT403';
  end if;
  select status into st from public.cycles where id = p_cycle_id;
  if not found then
    raise exception 'Cycle not found' using errcode = 'PT404';
  end if;
  if st not in ('in_progress', 'harvested') then
    raise exception 'Settlement only applies to a cycle that is under way' using errcode = 'PT409';
  end if;
  return private.compute_settlement(p_cycle_id);
end $$;

create type public.payout_kind as enum ('platform_fee', 'funder', 'farmer');

/** One payment the trustee owes at settlement. */
create table public.settlement_payouts (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycles (id) on delete restrict,
  kind public.payout_kind not null,
  contribution_id uuid references public.funding_contributions (id) on delete restrict,
  farmer_id uuid references public.farmers (id) on delete restrict,
  payee_name varchar(200) not null,
  amount_kobo bigint not null check (amount_kobo > 0),
  -- For a funder: how much of the payout is their capital coming back; the rest is return.
  capital_kobo bigint not null default 0 check (capital_kobo between 0 and amount_kobo),
  status public.disbursement_status not null default 'instructed',
  created_at timestamptz not null default now(),
  paid_by uuid references public.profiles (id) on delete restrict,
  paid_at timestamptz,
  trustee_reference varchar(120) unique,
  journal_entry_id uuid unique references public.journal_entries (id),
  check ((kind = 'funder') = (contribution_id is not null)),
  check ((kind = 'farmer') = (farmer_id is not null)),
  check (kind = 'funder' or capital_kobo = 0)
);
create index settlement_payouts_cycle_idx on public.settlement_payouts (cycle_id);

create function private.finish_settlement(p_cycle_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  update public.cycles set status = 'settled', settled_at = now() where id = p_cycle_id;
  -- An agreement is fulfilled once the accepted deliveries meet its volume.
  update public.offtake_contracts oc set status = 'fulfilled'
   where oc.cycle_id = p_cycle_id
     and (select coalesce(sum(weight_kg), 0) from public.harvest_deliveries d
           where d.offtake_contract_id = oc.id and d.voided_at is null and d.grade <> 'rejected')
         >= oc.volume_tonnes * 1000;
  perform private.log_cycle_event(p_cycle_id, 'settled', 'Settled: every payout made, the cycle is closed');
end $$;

/**
 * Runs the waterfall: closes the deployed inputs to production cost, records any capital
 * loss, and creates the payouts for the trustee to make.
 */
create function public.settle_cycle(p_cycle_id uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  c public.cycles;
  s jsonb;
  funder jsonb;
  farmer jsonb;
  loss_lines jsonb := '[]';
  n int := 0;
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can settle a cycle' using errcode = 'PT403';
  end if;
  select * into c from public.cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'Cycle not found' using errcode = 'PT404';
  end if;
  if c.status <> 'harvested' or c.settlement_started_at is not null then
    raise exception 'Only a harvested cycle that has not been settled can be settled (this one is %)',
      c.status using errcode = 'PT409';
  end if;
  if exists (select 1 from public.disbursements where cycle_id = p_cycle_id and status = 'instructed') then
    raise exception 'Confirm every milestone payment before settling' using errcode = 'PT409';
  end if;

  s := private.compute_settlement(p_cycle_id);

  -- The inputs and services deployed to the farms were used up producing the harvest.
  if (s ->> 'deployed')::bigint > 0 then
    perform private.post_journal_entry(p_cycle_id, 'Settlement: farm deployment used in production',
      auth.uid(), jsonb_build_array(
        jsonb_build_object('account_id', private.ensure_cycle_account(p_cycle_id, 'PRODUCTION_COST',
                             'Cost of production', 'expense'),
                           'amount_kobo', s ->> 'deployed'),
        jsonb_build_object('account_id', private.cycle_account(p_cycle_id, 'FARM_DEPLOYMENT'),
                           'amount_kobo', (-(s ->> 'deployed')::bigint)::text)));
  end if;

  -- Capital the cash can't cover is a loss the funders bear, each in proportion.
  if (s ->> 'capital_loss')::bigint > 0 then
    for funder in select * from jsonb_array_elements(s -> 'funders') loop
      if (funder ->> 'loss')::bigint > 0 then
        loss_lines := loss_lines || jsonb_build_object(
          'account_id', private.cycle_account(p_cycle_id, 'FUNDER_CAPITAL'),
          'amount_kobo', funder ->> 'loss', 'memo', funder ->> 'name');
      end if;
    end loop;
    loss_lines := loss_lines || jsonb_build_object(
      'account_id', private.ensure_cycle_account(p_cycle_id, 'CAPITAL_LOSS',
                      'Capital loss borne by funders', 'income'),
      'amount_kobo', (-(s ->> 'capital_loss')::bigint)::text);
    perform private.post_journal_entry(p_cycle_id, 'Settlement: capital loss borne by funders',
      auth.uid(), loss_lines);
  end if;

  if (s ->> 'fee')::bigint > 0 then
    insert into public.settlement_payouts (cycle_id, kind, payee_name, amount_kobo)
    values (p_cycle_id, 'platform_fee', 'Platform operator (management fee)', (s ->> 'fee')::bigint);
    n := n + 1;
  end if;
  for funder in select * from jsonb_array_elements(s -> 'funders') loop
    if (funder ->> 'total')::bigint > 0 then
      insert into public.settlement_payouts (cycle_id, kind, contribution_id, payee_name, amount_kobo, capital_kobo)
      values (p_cycle_id, 'funder', (funder ->> 'contribution_id')::uuid, funder ->> 'name',
              (funder ->> 'total')::bigint, (funder ->> 'capital')::bigint);
      n := n + 1;
    end if;
  end loop;
  for farmer in select * from jsonb_array_elements(s -> 'farmers') loop
    if (farmer ->> 'amount')::bigint > 0 then
      insert into public.settlement_payouts (cycle_id, kind, farmer_id, payee_name, amount_kobo)
      values (p_cycle_id, 'farmer', (farmer ->> 'farmer_id')::uuid, farmer ->> 'name',
              (farmer ->> 'amount')::bigint);
      n := n + 1;
    end if;
  end loop;

  update public.cycles set settlement_started_at = now() where id = p_cycle_id;
  perform private.log_cycle_event(p_cycle_id, 'settlement_started',
    format('Settlement run: %s to pay out in %s payment(s)',
           private.format_naira((s ->> 'cash')::bigint), n),
    jsonb_build_object('settlement', s));
  if n = 0 then
    perform private.finish_settlement(p_cycle_id);
  end if;
  return n;
end $$;

/** The trustee confirms it has paid a settlement payout. Posts it to the ledger. */
create function public.confirm_settlement_payout(p_payout_id uuid, p_trustee_reference text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.settlement_payouts;
  cash_account uuid;
  lines jsonb;
  entry uuid;
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can confirm payments' using errcode = 'PT403';
  end if;
  if coalesce(trim(p_trustee_reference), '') = '' then
    raise exception 'The trustee''s payment reference is required' using errcode = 'PT400';
  end if;
  select * into p from public.settlement_payouts where id = p_payout_id for update;
  if not found then
    raise exception 'Payout not found' using errcode = 'PT404';
  end if;
  if p.status <> 'instructed' then
    raise exception 'This payout is already %', p.status using errcode = 'PT409';
  end if;
  if exists (select 1 from public.settlement_payouts where trustee_reference = trim(p_trustee_reference)) then
    raise exception 'Trustee reference % has already been used', trim(p_trustee_reference)
      using errcode = 'PT409';
  end if;
  perform 1 from public.cycles where id = p.cycle_id for update;

  cash_account := private.cycle_account(p.cycle_id, 'TRUSTEE_CASH');
  if private.account_balance(cash_account) < p.amount_kobo then
    raise exception 'The trustee does not hold enough of this cycle''s cash for this payout'
      using errcode = 'PT409';
  end if;

  lines := jsonb_build_array(jsonb_build_object(
    'account_id', cash_account, 'amount_kobo', (-p.amount_kobo)::text));
  if p.kind = 'funder' then
    if p.capital_kobo > 0 then
      lines := lines || jsonb_build_object(
        'account_id', private.cycle_account(p.cycle_id, 'FUNDER_CAPITAL'),
        'amount_kobo', p.capital_kobo::text, 'memo', 'capital returned');
    end if;
    if p.amount_kobo > p.capital_kobo then
      lines := lines || jsonb_build_object(
        'account_id', private.ensure_cycle_account(p.cycle_id, 'FUNDER_RETURNS',
                        'Returns paid to funders', 'expense'),
        'amount_kobo', (p.amount_kobo - p.capital_kobo)::text, 'memo', 'return');
    end if;
  elsif p.kind = 'platform_fee' then
    lines := lines || jsonb_build_object(
      'account_id', private.ensure_cycle_account(p.cycle_id, 'PLATFORM_FEES',
                      'Management fee', 'expense'),
      'amount_kobo', p.amount_kobo::text);
  else
    lines := lines || jsonb_build_object(
      'account_id', private.ensure_cycle_account(p.cycle_id, 'FARMER_SURPLUS',
                      'Surplus paid to farmers', 'expense'),
      'amount_kobo', p.amount_kobo::text);
  end if;

  entry := private.post_journal_entry(p.cycle_id,
    left(format('Settlement payout: %s', p.payee_name), 300), auth.uid(), lines,
    trim(p_trustee_reference));

  update public.settlement_payouts
     set status = 'executed', paid_by = auth.uid(), paid_at = now(),
         trustee_reference = trim(p_trustee_reference), journal_entry_id = entry
   where id = p.id;

  if not exists (select 1 from public.settlement_payouts
                  where cycle_id = p.cycle_id and status = 'instructed') then
    perform private.finish_settlement(p.cycle_id);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Access: all of these are written only through the functions above
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['harvest_deliveries', 'cycle_receipts', 'settlement_payouts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.is_cycle_reader()))',
      t || '_read', t);
  end loop;
end $$;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.is_harvest_recorder(),
  public.record_harvest_delivery(uuid, uuid, uuid, date, integer, public.harvest_grade, text, numeric, text),
  public.void_harvest_delivery(uuid, text),
  public.complete_harvest(uuid),
  public.record_cycle_receipt(uuid, public.receipt_kind, uuid, bigint, text, date, text),
  public.settlement_preview(uuid),
  public.settle_cycle(uuid),
  public.confirm_settlement_payout(uuid, text)
to authenticated;
