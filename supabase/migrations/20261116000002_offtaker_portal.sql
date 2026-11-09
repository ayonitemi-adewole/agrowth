-- =============================================================================
-- Agrowth 2.0 — the offtaker (buyer) portal
--
-- The buyer who has agreed to take a cycle's harvest now has its own sign-in:
--
--   * Buyers are records of their own (public.offtakers). Every buyer named on an offtake
--     agreement gets one, matched by name, so agreements with the same buyer across
--     cycles belong together.
--   * An admin links a buyer's staff sign-ins (accounts with the Offtaker role) to it.
--   * Signed in, a buyer sees its agreements: the volume, price and delivery window, each
--     load weighed and graded for it, what it has paid, and an estimate of what it owes.
--     It sees farms by name, never farmers.
--   * It confirms each load, or disputes it with a reason (a different weight at its
--     weighbridge, say). A confirmed load is final. A disputed one stands until the
--     recorder voids and re-records it, or the buyer confirms it after all.
-- =============================================================================

create table public.offtakers (
  id uuid primary key default gen_random_uuid(),
  name varchar(200) not null check (length(trim(name)) >= 2),
  contact varchar(200),
  created_at timestamptz not null default now()
);
create unique index offtakers_name_idx on public.offtakers (lower(trim(name)));

/** A buyer's staff sign-ins: accounts with the Offtaker role, linked by an admin. */
create table public.offtaker_users (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  offtaker_id uuid not null references public.offtakers (id) on delete restrict,
  linked_by uuid references public.profiles (id) on delete restrict,
  linked_at timestamptz not null default now()
);

alter table public.offtake_contracts
  add column offtaker_id uuid references public.offtakers (id) on delete restrict;

-- Every agreement's buyer becomes a buyer record, matched by name.
insert into public.offtakers (name, contact)
select distinct on (lower(trim(buyer_name))) trim(buyer_name), buyer_contact
  from public.offtake_contracts
 order by lower(trim(buyer_name)), created_at
on conflict do nothing;
update public.offtake_contracts oc
   set offtaker_id = o.id
  from public.offtakers o
 where lower(trim(o.name)) = lower(trim(oc.buyer_name));

create function private.link_offtaker() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.offtakers (name, contact) values (trim(new.buyer_name), new.buyer_contact)
  on conflict do nothing;
  select id into new.offtaker_id from public.offtakers
   where lower(trim(name)) = lower(trim(new.buyer_name));
  return new;
end $$;
create trigger offtake_contracts_offtaker before insert or update of buyer_name
on public.offtake_contracts for each row execute function private.link_offtaker();

/** The buyer the signed-in Offtaker account works for, if any. */
create function public.my_offtaker_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select offtaker_id from public.offtaker_users where user_id = auth.uid()
$$;

alter table public.offtakers enable row level security;
alter table public.offtaker_users enable row level security;
revoke all on public.offtakers, public.offtaker_users from anon, authenticated;
grant select on public.offtakers, public.offtaker_users to authenticated;
create policy offtakers_read on public.offtakers for select to authenticated
  using ((select public.is_cycle_reader()) or id = (select public.my_offtaker_id()));
create policy offtaker_users_read on public.offtaker_users for select to authenticated
  using ((select public.is_admin()) or user_id = (select auth.uid()));

/** An admin links an Offtaker account to the buyer it works for (or unlinks it, with null). */
create function public.link_offtaker_account(p_user_id uuid, p_offtaker_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  account_role public.user_role;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can link buyer accounts' using errcode = 'PT403';
  end if;
  if p_offtaker_id is null then
    delete from public.offtaker_users where user_id = p_user_id;
    return;
  end if;
  select role into account_role from public.profiles where id = p_user_id;
  if not found then
    raise exception 'User not found' using errcode = 'PT404';
  end if;
  if account_role <> 'offtaker' then
    raise exception 'Give this user the Offtaker role first' using errcode = 'PT400';
  end if;
  if not exists (select 1 from public.offtakers where id = p_offtaker_id) then
    raise exception 'Buyer not found' using errcode = 'PT404';
  end if;
  insert into public.offtaker_users (user_id, offtaker_id, linked_by)
  values (p_user_id, p_offtaker_id, auth.uid())
  on conflict (user_id) do update
    set offtaker_id = excluded.offtaker_id, linked_by = excluded.linked_by, linked_at = now();
end $$;

-- -----------------------------------------------------------------------------
-- The buyer's say on each load
-- -----------------------------------------------------------------------------

alter table public.harvest_deliveries
  add column buyer_confirmed_at timestamptz,
  add column buyer_confirmed_by uuid references public.profiles (id) on delete restrict,
  add column buyer_disputed_at timestamptz,
  add column buyer_dispute varchar(500);

/** The delivery, if the signed-in buyer's agreement covers it and it can still be answered. */
create function private.buyer_delivery(p_delivery_id uuid) returns public.harvest_deliveries
language plpgsql set search_path = '' as $$
declare
  d public.harvest_deliveries;
begin
  select hd.* into d
    from public.harvest_deliveries hd
    join public.offtake_contracts oc on oc.id = hd.offtake_contract_id
   where hd.id = p_delivery_id and oc.offtaker_id = public.my_offtaker_id()
     for update of hd;
  if not found then
    raise exception 'Delivery not found' using errcode = 'PT404';
  end if;
  if d.voided_at is not null then
    raise exception 'This load was voided' using errcode = 'PT409';
  end if;
  if d.buyer_confirmed_at is not null then
    raise exception 'This load is already confirmed' using errcode = 'PT409';
  end if;
  return d;
end $$;

/** The buyer confirms a load as weighed and graded. Final. */
create function public.confirm_harvest_delivery(p_delivery_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.harvest_deliveries;
begin
  d := private.buyer_delivery(p_delivery_id);
  update public.harvest_deliveries
     set buyer_confirmed_at = now(), buyer_confirmed_by = auth.uid()
   where id = d.id;
end $$;

/** The buyer disputes a load, saying why. It stands until re-recorded or confirmed. */
create function public.dispute_harvest_delivery(p_delivery_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.harvest_deliveries;
begin
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Say what''s wrong with the load, e.g. the weight at your weighbridge'
      using errcode = 'PT400';
  end if;
  d := private.buyer_delivery(p_delivery_id);
  update public.harvest_deliveries
     set buyer_disputed_at = now(), buyer_dispute = left(trim(p_reason), 500)
   where id = d.id;
  perform private.log_cycle_event(d.cycle_id, 'delivery_disputed',
    format('The buyer disputed load %s: %s', d.waybill_reference, left(trim(p_reason), 200)),
    jsonb_build_object('delivery_id', d.id));
end $$;

-- -----------------------------------------------------------------------------
-- What the buyer sees
-- -----------------------------------------------------------------------------

/**
 * The signed-in buyer's agreements, with their loads, payments and an estimate of what's
 * owed: accepted tonnes at the fixed or floor price, less what's been paid. Farms are
 * named; farmers never are.
 */
create function public.offtaker_portal() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := public.my_offtaker_id();
begin
  if not public.has_any_role(array['offtaker']::public.user_role[]) then
    raise exception 'This is the buyer portal' using errcode = 'PT403';
  end if;
  if me is null then
    return jsonb_build_object('offtaker', null, 'contracts', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'offtaker', (select jsonb_build_object('id', o.id, 'name', o.name) from public.offtakers o where o.id = me),
    'contracts', coalesce((
      select jsonb_agg(x.c order by x.sort desc)
        from (
          select coalesce(oc.delivery_window_start, c.expected_harvest_date) as sort,
                 jsonb_build_object(
                   'id', oc.id,
                   'cycle_code', c.code, 'crop', c.crop, 'season', c.season,
                   'cycle_status', c.status,
                   'cooperative', co.name, 'state', co.state, 'lga', co.lga,
                   'commodity', oc.commodity, 'volume_tonnes', oc.volume_tonnes,
                   'price_terms', oc.price_terms,
                   'price_per_tonne_kobo', oc.price_per_tonne_kobo::text,
                   'price_floor_per_tonne_kobo', oc.price_floor_per_tonne_kobo::text,
                   'price_formula', oc.price_formula,
                   'delivery_window_start', oc.delivery_window_start,
                   'delivery_window_end', oc.delivery_window_end,
                   'expected_harvest_date', c.expected_harvest_date,
                   'status', oc.status,
                   'accepted_kg', t.accepted_kg, 'rejected_kg', t.rejected_kg,
                   'paid_kobo', p.paid::text,
                   'value_kobo', case when oc.price_terms in ('fixed', 'floor') then
                       round(t.accepted_kg / 1000.0 *
                             coalesce(oc.price_per_tonne_kobo, oc.price_floor_per_tonne_kobo))::bigint::text end,
                   'deliveries', coalesce((
                     select jsonb_agg(jsonb_build_object(
                              'id', hd.id, 'delivered_on', hd.delivered_on,
                              'weight_kg', hd.weight_kg, 'grade', hd.grade,
                              'moisture_pct', hd.moisture_pct,
                              'waybill_reference', hd.waybill_reference,
                              'farm', coalesce(f.name, 'Farm'),
                              'voided', hd.voided_at is not null,
                              'void_reason', hd.void_reason,
                              'confirmed_at', hd.buyer_confirmed_at,
                              'disputed_at', hd.buyer_disputed_at,
                              'dispute', hd.buyer_dispute)
                            order by hd.delivered_on desc, hd.created_at desc)
                       from public.harvest_deliveries hd
                       join public.farms f on f.id = hd.farm_id
                      where hd.offtake_contract_id = oc.id), '[]'::jsonb)
                 ) as c
            from public.offtake_contracts oc
            join public.cycles c on c.id = oc.cycle_id
            left join public.cooperatives co on co.id = c.cooperative_id
            cross join lateral (
              select coalesce(sum(weight_kg) filter (where grade <> 'rejected'), 0) as accepted_kg,
                     coalesce(sum(weight_kg) filter (where grade = 'rejected'), 0) as rejected_kg
                from public.harvest_deliveries
               where offtake_contract_id = oc.id and voided_at is null) t
            cross join lateral (
              select coalesce(sum(amount_kobo), 0) as paid
                from public.cycle_receipts
               where offtake_contract_id = oc.id) p
           where oc.offtaker_id = me and c.status <> 'draft'
        ) x), '[]'::jsonb));
end $$;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.my_offtaker_id(),
  public.link_offtaker_account(uuid, uuid),
  public.confirm_harvest_delivery(uuid),
  public.dispute_harvest_delivery(uuid, text),
  public.offtaker_portal()
to authenticated;
