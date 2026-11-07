-- =============================================================================
-- Agrowth 2.0 — Government Edition: programmes, eligibility, budgets and dashboards
--
-- A programme is what a ministry, agency or donor runs: an input-credit scheme or a
-- grant, for named commodities in named states and LGAs, with a budget.
--
--   1. A programme manager designs it as a draft (commodities, target area, eligibility,
--      input package, loan or grant terms, budget) and activates it.
--   2. Programme- or blended-funded cycles are attached to it. A cycle can't be submitted
--      unless it fits the programme: an active programme, a listed commodity, every
--      farmer inside the target area and under the hectare limit, the input package's
--      per-hectare value, and the programme's dates.
--   3. Programme deposits on those cycles count against the programme's budget; one that
--      would overspend it is refused. Investor money in a blended cycle doesn't count.
--   4. Dashboards add it up from the records the core already keeps (farms, vouchers,
--      vendor payments, harvest deliveries, settlement payouts): by state, LGA, ward,
--      commodity and cooperative. Repayment is what settlement paid back to the
--      programme, against what its terms say is due.
-- =============================================================================

create function public.is_programme_manager() returns boolean
language sql stable set search_path = '' as $$
  select public.has_any_role(array['admin', 'programme_manager']::public.user_role[])
$$;

/** Who can see programme dashboards: programme and cycle staff, compliance, auditors. */
create function public.is_programme_reader() returns boolean
language sql stable set search_path = '' as $$
  select public.has_any_role(array[
    'admin', 'programme_manager', 'cycle_manager', 'compliance_officer', 'auditor'
  ]::public.user_role[])
$$;

-- -----------------------------------------------------------------------------
-- Programmes
-- -----------------------------------------------------------------------------

create type public.programme_kind as enum ('input_loan', 'grant');
create type public.programme_status as enum ('draft', 'active', 'closed');
create type public.repayment_mode as enum ('produce', 'cash', 'either');

create table public.programmes (
  id uuid primary key default gen_random_uuid(),
  code varchar(40) not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{2,39}$'),
  name varchar(200) not null check (length(trim(name)) >= 3),
  -- The ministry, agency or donor that funds it.
  sponsor varchar(200) not null check (length(trim(sponsor)) >= 2),
  description text check (length(description) <= 5000),
  kind public.programme_kind not null,
  status public.programme_status not null default 'draft',
  budget_kobo bigint not null check (budget_kobo > 0),
  commodities text[] not null check (cardinality(commodities) > 0),
  target_states text[] not null check (cardinality(target_states) > 0),
  -- Empty means every LGA in the target states.
  target_lgas text[] not null default '{}',
  -- Eligibility.
  max_hectares_per_farmer numeric(8, 2) check (max_hectares_per_farmer > 0),
  require_cooperative boolean not null default true,
  -- The input package: what each hectare gets, and its value cap.
  input_package text check (length(input_package) <= 2000),
  max_budget_per_ha_kobo bigint check (max_budget_per_ha_kobo > 0),
  -- Loan terms: the share of the programme's money farmers repay through the harvest.
  repayment_bps integer not null default 0 check (repayment_bps between 0 and 10000),
  repayment_mode public.repayment_mode not null default 'produce',
  starts_on date not null,
  ends_on date not null,
  manager_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  activated_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on > starts_on),
  check (kind = 'input_loan' or repayment_bps = 0)
);

create trigger programmes_touch before update on public.programmes
for each row execute function private.touch_updated_at();

alter table public.programmes enable row level security;
revoke all on public.programmes from anon, authenticated;
grant select on public.programmes to authenticated;
grant insert (code, name, sponsor, description, kind, budget_kobo, commodities, target_states,
              target_lgas, max_hectares_per_farmer, require_cooperative, input_package,
              max_budget_per_ha_kobo, repayment_bps, repayment_mode, starts_on, ends_on),
      update (code, name, sponsor, description, kind, budget_kobo, commodities, target_states,
              target_lgas, max_hectares_per_farmer, require_cooperative, input_package,
              max_budget_per_ha_kobo, repayment_bps, repayment_mode, starts_on, ends_on)
   on public.programmes to authenticated;

-- Cycle staff need to see programmes to attach cycles; the trustee to see whose money it is.
create policy programmes_read on public.programmes for select to authenticated
  using ((select public.is_cycle_reader()));
create policy programmes_insert on public.programmes for insert to authenticated
  with check ((select public.is_programme_manager()) and status = 'draft'
              and manager_id = (select auth.uid()));
-- Only drafts are edited; an active programme's terms are fixed (raise the budget by closing
-- and opening a successor, so every cycle stays under the terms it was approved with).
create policy programmes_update on public.programmes for update to authenticated
  using ((select public.is_programme_manager()) and status = 'draft')
  with check (status = 'draft');

/** Normalises the text lists so eligibility checks compare like with like. */
create function private.programme_normalise() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.commodities := array(select distinct lower(trim(x)) from unnest(new.commodities) x
                            where trim(x) <> '' order by 1);
  new.target_states := array(select distinct trim(x) from unnest(new.target_states) x
                              where trim(x) <> '' order by 1);
  new.target_lgas := array(select distinct trim(x) from unnest(new.target_lgas) x
                            where trim(x) <> '' order by 1);
  if cardinality(new.commodities) = 0 or cardinality(new.target_states) = 0 then
    raise exception 'A programme needs at least one commodity and one state' using errcode = 'PT400';
  end if;
  return new;
end $$;

create trigger programmes_normalise before insert or update on public.programmes
for each row execute function private.programme_normalise();

create function public.activate_programme(p_programme_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.programmes;
begin
  if not public.is_programme_manager() then
    raise exception 'Only programme managers can activate programmes' using errcode = 'PT403';
  end if;
  select * into p from public.programmes where id = p_programme_id for update;
  if not found then
    raise exception 'Programme not found' using errcode = 'PT404';
  end if;
  if p.status <> 'draft' then
    raise exception 'This programme is already %', p.status using errcode = 'PT409';
  end if;
  if p.kind = 'input_loan' and p.repayment_bps = 0 then
    raise exception 'An input-loan programme needs a repayment share' using errcode = 'PT400';
  end if;
  if p.ends_on < current_date then
    raise exception 'This programme''s end date has passed' using errcode = 'PT400';
  end if;
  update public.programmes set status = 'active', activated_at = now() where id = p.id;
end $$;

/** Closing stops new cycles and deposits; cycles already under way finish normally. */
create function public.close_programme(p_programme_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_programme_manager() then
    raise exception 'Only programme managers can close programmes' using errcode = 'PT403';
  end if;
  update public.programmes set status = 'closed', closed_at = now()
   where id = p_programme_id and status = 'active';
  if not found then
    raise exception 'Only an active programme can be closed' using errcode = 'PT409';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Cycles belong to a programme
-- -----------------------------------------------------------------------------

alter table public.cycles
  add column programme_id uuid references public.programmes (id) on delete restrict;
create index cycles_programme_idx on public.cycles (programme_id);
grant insert (programme_id), update (programme_id) on public.cycles to authenticated;

create function private.cycle_programme_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.programme_id is not null and new.funding_source = 'investor' then
    raise exception 'An investor-only cycle can''t belong to a programme; choose programme or blended funding'
      using errcode = 'PT400';
  end if;
  return new;
end $$;

create trigger cycles_programme_guard before insert or update of programme_id, funding_source
on public.cycles for each row execute function private.cycle_programme_guard();

/** The programme's eligibility rules for one cycle, as readiness checks. */
create function private.programme_checks(p_cycle_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  c public.cycles;
  p public.programmes;
  n_outside int;
  n_over int;
  n_no_coop int;
  biggest numeric;
begin
  select * into c from public.cycles where id = p_cycle_id;
  if c.programme_id is null then
    return '[]';
  end if;
  select * into p from public.programmes where id = c.programme_id;

  select count(*) filter (where not (fr.state = any (p.target_states)
                                     and (cardinality(p.target_lgas) = 0 or fr.lga = any (p.target_lgas)))),
         count(*) filter (where fr.cooperative_id is null)
    into n_outside, n_no_coop
    from public.cycle_farms cf
    join public.farms f on f.id = cf.farm_id
    join public.farmers fr on fr.id = f.farmer_id
   where cf.cycle_id = p_cycle_id;

  select count(*) filter (where ha > p.max_hectares_per_farmer), max(ha)
    into n_over, biggest
    from (select f.farmer_id, sum(f.area_hectares) as ha
            from public.cycle_farms cf join public.farms f on f.id = cf.farm_id
           where cf.cycle_id = p_cycle_id group by f.farmer_id) per_farmer;

  return jsonb_build_array(
    jsonb_build_object('key', 'programme_active', 'label', format('Programme %s is active', p.code),
      'ok', p.status = 'active',
      'detail', case when p.status <> 'active' then format('It is %s', p.status) end),
    jsonb_build_object('key', 'programme_commodity', 'label', 'The crop is one the programme funds',
      'ok', lower(c.crop) = any (p.commodities),
      'detail', format('Programme commodities: %s', array_to_string(p.commodities, ', '))),
    jsonb_build_object('key', 'programme_area', 'label', 'Every farmer is in the programme''s target area',
      'ok', n_outside = 0,
      'detail', case when n_outside > 0 then format('%s farmer(s) outside %s', n_outside,
        array_to_string(p.target_states || p.target_lgas, ', ')) end),
    jsonb_build_object('key', 'programme_hectares', 'label', 'No farmer is over the hectare limit',
      'ok', p.max_hectares_per_farmer is null or coalesce(n_over, 0) = 0,
      'detail', case when p.max_hectares_per_farmer is not null then
        format('Limit %s ha per farmer; largest here %s ha', p.max_hectares_per_farmer,
               round(coalesce(biggest, 0), 2)) end),
    jsonb_build_object('key', 'programme_cooperative', 'label', 'Every farmer belongs to a cooperative',
      'ok', not p.require_cooperative or n_no_coop = 0,
      'detail', case when p.require_cooperative and n_no_coop > 0
        then format('%s farmer(s) without a cooperative', n_no_coop) end),
    jsonb_build_object('key', 'programme_package', 'label', 'Budget per hectare fits the input package',
      'ok', p.max_budget_per_ha_kobo is null or c.budget_per_hectare_kobo <= p.max_budget_per_ha_kobo,
      'detail', case when p.max_budget_per_ha_kobo is not null then
        format('Package allows up to %s per ha', private.format_naira(p.max_budget_per_ha_kobo)) end),
    jsonb_build_object('key', 'programme_dates', 'label', 'The season falls within the programme''s dates',
      'ok', c.start_date >= p.starts_on and c.expected_harvest_date <= p.ends_on,
      'detail', format('%s to %s', to_char(p.starts_on, 'DD Mon YYYY'), to_char(p.ends_on, 'DD Mon YYYY')))
  );
end $$;

-- The readiness checklist gains the programme's checks. The original function is kept,
-- privately, and the public one adds to it; submit and approve already call it by name.
alter function public.cycle_readiness(uuid) rename to cycle_readiness_core;
alter function public.cycle_readiness_core(uuid) set schema private;

create function public.cycle_readiness(p_cycle_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return private.cycle_readiness_core(p_cycle_id) || private.programme_checks(p_cycle_id);
end $$;

-- -----------------------------------------------------------------------------
-- Programme money counts against the budget
-- -----------------------------------------------------------------------------

alter table public.funding_contributions
  add column programme_id uuid references public.programmes (id) on delete restrict;
create index funding_contributions_programme_idx on public.funding_contributions (programme_id);

create function private.programme_contribution() returns trigger
language plpgsql set search_path = '' as $$
declare
  p public.programmes;
  committed bigint;
begin
  if new.funder_kind <> 'programme' then
    return new;
  end if;
  select pr.* into p from public.cycles c join public.programmes pr on pr.id = c.programme_id
   where c.id = new.cycle_id for update of pr;
  if not found then
    return new;
  end if;
  if p.status <> 'active' then
    raise exception 'Programme % is %; it can''t fund new deposits', p.code, p.status
      using errcode = 'PT409';
  end if;
  select coalesce(sum(amount_kobo), 0) into committed from public.funding_contributions
   where programme_id = p.id and refund_entry_id is null;
  if committed + new.amount_kobo > p.budget_kobo then
    raise exception 'This deposit would take programme % over its budget: % of % is left',
      p.code, private.format_naira(p.budget_kobo - committed), private.format_naira(p.budget_kobo)
      using errcode = 'PT400';
  end if;
  new.programme_id := p.id;
  return new;
end $$;

create trigger funding_contributions_programme before insert on public.funding_contributions
for each row execute function private.programme_contribution();

-- -----------------------------------------------------------------------------
-- Dashboards
-- -----------------------------------------------------------------------------

/**
 * One row per farm in the programme's cycles (once a cycle is approved), with what reached
 * it and what came back. Cycle-level amounts (deposits, vendor payments, repayments) are
 * shared out by farm area; vouchers and harvest deliveries are the farm's own.
 */
create function private.programme_farms(p_programme_id uuid)
returns table (
  cycle_id uuid, cycle_code text, crop text, cycle_status public.cycle_status,
  farm_id uuid, farmer_id uuid, farmer_name text, gender public.gender,
  state text, lga text, ward text, cooperative text,
  hectares numeric, committed_kobo numeric, inputs_kobo numeric, cash_kobo numeric,
  delivered_kg numeric, low_kg numeric, season_over boolean,
  due_kobo numeric, recovered_kobo numeric
)
language sql stable set search_path = '' as $$
  with p as (select * from public.programmes where id = p_programme_id),
  pc as (
    select c.id, c.code, c.crop, c.status, c.yield_low_t_per_ha,
           (select coalesce(sum(f.area_hectares), 0) from public.cycle_farms cf
              join public.farms f on f.id = cf.farm_id where cf.cycle_id = c.id) as ha,
           (select coalesce(sum(fc.amount_kobo), 0) from public.funding_contributions fc
             where fc.cycle_id = c.id and fc.programme_id = p_programme_id
               and fc.refund_entry_id is null) as committed,
           (select coalesce(sum(d.amount_kobo), 0) from public.disbursements d
             where d.cycle_id = c.id and d.status = 'executed'
               and d.payee_kind in ('input_vendor', 'service_provider')) as direct_inputs,
           (select coalesce(sum(d.amount_kobo), 0) from public.disbursements d
             where d.cycle_id = c.id and d.status = 'executed' and d.payee_kind = 'farmer_cash') as cash,
           (select coalesce(sum(sp.amount_kobo), 0) from public.settlement_payouts sp
              join public.funding_contributions fc on fc.id = sp.contribution_id
             where sp.cycle_id = c.id and sp.status = 'executed'
               and fc.programme_id = p_programme_id) as recovered
      from public.cycles c
     where c.programme_id = p_programme_id
       and c.status not in ('draft', 'pending_approval', 'cancelled', 'refunded')
  )
  select pc.id, pc.code::text, pc.crop::text, pc.status,
         f.id, fr.id, fr.full_name, fr.gender,
         fr.state::text, fr.lga::text, coalesce(fr.ward, '—')::text, coalesce(co.name, 'No cooperative')::text,
         f.area_hectares,
         pc.committed * s.share,
         pc.direct_inputs * s.share
           + coalesce((select sum(r.amount_kobo) from public.voucher_redemptions r
                         join public.vouchers v on v.id = r.voucher_id
                        where v.cycle_id = pc.id and v.farm_id = f.id and r.voided_at is null), 0),
         pc.cash * s.share,
         coalesce((select sum(d.weight_kg) from public.harvest_deliveries d
                    where d.cycle_id = pc.id and d.farm_id = f.id
                      and d.voided_at is null and d.grade <> 'rejected'), 0),
         pc.yield_low_t_per_ha * f.area_hectares * 1000,
         pc.status in ('harvested', 'settled'),
         -- Due once the season is settled: the programme's share of its money, per its terms.
         case when pc.status = 'settled' then pc.committed * s.share * p.repayment_bps / 10000.0 else 0 end,
         case when pc.status = 'settled' then pc.recovered * s.share else 0 end
    from pc
    cross join p
    join public.cycle_farms cf on cf.cycle_id = pc.id
    join public.farms f on f.id = cf.farm_id
    join public.farmers fr on fr.id = f.farmer_id
    left join public.cooperatives co on co.id = fr.cooperative_id
    cross join lateral (select case when pc.ha > 0 then f.area_hectares / pc.ha else 0 end as share) s
$$;

/** Aggregates farm rows into the dashboard's figures. Amounts as whole-kobo strings. */
create function private.programme_figures(p_rows jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'farmers', count(distinct r ->> 'farmer_id'),
    'women', count(distinct r ->> 'farmer_id') filter (where r ->> 'gender' = 'female'),
    'farms', count(*),
    'hectares', round(coalesce(sum((r ->> 'hectares')::numeric), 0), 2),
    'committed_kobo', round(coalesce(sum((r ->> 'committed_kobo')::numeric), 0))::bigint::text,
    'inputs_kobo', round(coalesce(sum((r ->> 'inputs_kobo')::numeric), 0))::bigint::text,
    'cash_kobo', round(coalesce(sum((r ->> 'cash_kobo')::numeric), 0))::bigint::text,
    'delivered_kg', round(coalesce(sum((r ->> 'delivered_kg')::numeric), 0)),
    'harvested_hectares', round(coalesce(sum((r ->> 'hectares')::numeric)
                                   filter (where (r ->> 'season_over')::boolean), 0), 2),
    'due_kobo', round(coalesce(sum((r ->> 'due_kobo')::numeric), 0))::bigint::text,
    'recovered_kobo', round(coalesce(sum((r ->> 'recovered_kobo')::numeric), 0))::bigint::text,
    'under_delivered', count(*) filter (where (r ->> 'season_over')::boolean
                                          and (r ->> 'delivered_kg')::numeric < (r ->> 'low_kg')::numeric))
  from jsonb_array_elements(p_rows) r
$$;

create function private.programme_breakdown(p_rows jsonb, dim text) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', g.key) || private.programme_figures(g.farm_rows)
                            order by g.key), '[]')
    from (select case dim when 'lga' then (r ->> 'state') || ' · ' || (r ->> 'lga')
                          when 'ward' then (r ->> 'lga') || ' · ' || (r ->> 'ward')
                          else r ->> dim end as key,
                 jsonb_agg(r) as farm_rows
            from jsonb_array_elements(p_rows) r group by 1) g
$$;

/**
 * Everything a programme dashboard shows: the programme, totals, breakdowns by state, LGA,
 * ward, commodity and cooperative, its cycles, farms that delivered less than the low-yield
 * estimate, and extension agents' visit record.
 */
create function public.programme_dashboard(p_programme_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.programmes;
  farm_rows jsonb;
begin
  if not public.is_programme_reader() then
    raise exception 'Your role cannot see programme dashboards' using errcode = 'PT403';
  end if;
  select * into p from public.programmes where id = p_programme_id;
  if not found then
    raise exception 'Programme not found' using errcode = 'PT404';
  end if;
  select coalesce(jsonb_agg(to_jsonb(f)), '[]') into farm_rows
    from private.programme_farms(p_programme_id) f;

  return jsonb_build_object(
    'programme', to_jsonb(p) || jsonb_build_object('budget_kobo', p.budget_kobo::text,
                                                   'max_budget_per_ha_kobo', p.max_budget_per_ha_kobo::text),
    'totals', private.programme_figures(farm_rows),
    -- Committed counts deposits on cycles not yet approved too, as the budget does.
    'budget_committed_kobo', (select coalesce(sum(amount_kobo), 0)::text from public.funding_contributions
                               where programme_id = p_programme_id and refund_entry_id is null),
    'by_state', private.programme_breakdown(farm_rows, 'state'),
    'by_lga', private.programme_breakdown(farm_rows, 'lga'),
    'by_ward', private.programme_breakdown(farm_rows, 'ward'),
    'by_commodity', private.programme_breakdown(farm_rows, 'crop'),
    'by_cooperative', private.programme_breakdown(farm_rows, 'cooperative'),
    'cycles', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', c.id, 'code', c.code, 'crop', c.crop, 'season', c.season, 'status', c.status,
               'funding_source', c.funding_source,
               'target_kobo', c.target_amount_kobo::text,
               'programme_kobo', (select coalesce(sum(amount_kobo), 0)::text from public.funding_contributions
                                   where cycle_id = c.id and programme_id = p_programme_id
                                     and refund_entry_id is null))
             order by c.start_date desc nulls last, c.code), '[]')
        from public.cycles c where c.programme_id = p_programme_id),
    'under_delivered', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'farmer_id', r ->> 'farmer_id', 'farmer_name', r ->> 'farmer_name',
               'cooperative', r ->> 'cooperative', 'lga', r ->> 'lga', 'ward', r ->> 'ward',
               'cycle_id', r ->> 'cycle_id', 'cycle_code', r ->> 'cycle_code',
               'hectares', (r ->> 'hectares')::numeric,
               'delivered_kg', (r ->> 'delivered_kg')::numeric,
               'low_kg', round((r ->> 'low_kg')::numeric))
             order by (r ->> 'delivered_kg')::numeric / nullif((r ->> 'low_kg')::numeric, 0)), '[]')
        from jsonb_array_elements(farm_rows) r
       where (r ->> 'season_over')::boolean
         and (r ->> 'delivered_kg')::numeric < (r ->> 'low_kg')::numeric),
    'agents', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'agent_id', a.agent_id,
               'name', coalesce(nullif(pr.full_name, ''), pr.email),
               'visits', a.visits, 'passed', a.passed, 'gps_failed', a.gps_failed,
               'farms', a.farms, 'avg_days_to_visit', a.avg_days)
             order by a.visits desc), '[]')
        from (
          select v.agent_id,
                 count(*) as visits,
                 count(*) filter (where v.passed) as passed,
                 count(*) filter (where not v.gps_ok) as gps_failed,
                 count(distinct v.farm_id) as farms,
                 round(avg(extract(epoch from v.visited_at - m.verification_requested_at) / 86400)::numeric, 1)
                   as avg_days
            from public.field_visits v
            join public.milestones m on m.id = v.milestone_id
            join public.cycles c on c.id = m.cycle_id
           where c.programme_id = p_programme_id
           group by v.agent_id
        ) a
        join public.profiles pr on pr.id = a.agent_id),
    -- Farm checks requested but not yet passed: the agents' outstanding work.
    'visits_outstanding', (
      select count(*)
        from public.milestones m
        join public.cycles c on c.id = m.cycle_id
        join public.cycle_farms cf on cf.cycle_id = c.id
       where c.programme_id = p_programme_id
         and m.status in ('awaiting_verification', 'blocked')
         and not exists (select 1 from public.field_visits v
                          where v.milestone_id = m.id and v.farm_id = cf.farm_id and v.passed
                            and v.visited_at >= m.verification_requested_at)));
end $$;

/** Every beneficiary farm, for the audit export. Includes names: staff only. */
create function public.programme_beneficiaries(p_programme_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_programme_reader() then
    raise exception 'Your role cannot see programme dashboards' using errcode = 'PT403';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(f) order by f.state, f.lga, f.ward, f.farmer_name), '[]')
            from private.programme_farms(p_programme_id) f);
end $$;

/** Headline figures for every programme, for the programme list. */
create function public.programme_summaries() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_programme_reader() then
    raise exception 'Your role cannot see programme dashboards' using errcode = 'PT403';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'code', p.code, 'name', p.name, 'sponsor', p.sponsor, 'kind', p.kind,
             'status', p.status, 'budget_kobo', p.budget_kobo::text,
             'commodities', p.commodities, 'target_states', p.target_states,
             'starts_on', p.starts_on, 'ends_on', p.ends_on,
             'cycles', (select count(*) from public.cycles where programme_id = p.id),
             'committed_kobo', (select coalesce(sum(amount_kobo), 0)::text from public.funding_contributions
                                 where programme_id = p.id and refund_entry_id is null))
             || private.programme_figures(
                  (select coalesce(jsonb_agg(to_jsonb(f)), '[]') from private.programme_farms(p.id) f))
           order by p.status, p.starts_on desc), '[]')
      from public.programmes p);
end $$;

-- -----------------------------------------------------------------------------
-- Function permissions
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.is_programme_manager(),
  public.is_programme_reader(),
  public.activate_programme(uuid),
  public.close_programme(uuid),
  public.cycle_readiness(uuid),
  public.programme_dashboard(uuid),
  public.programme_beneficiaries(uuid),
  public.programme_summaries()
to authenticated;
