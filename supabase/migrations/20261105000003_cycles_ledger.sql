-- =============================================================================
-- Agrowth 2.0 — funding cycles, milestones, offtake contracts and the ledger
--
-- Ledger rules, enforced inside PostgreSQL so they hold even if app code has a bug
-- or someone connects to the database directly:
--   1. Append-only: no UPDATE, DELETE or TRUNCATE on journal tables.
--   2. Every entry balances to zero and has at least two lines (checked at commit).
--   3. No recycling: an entry may only touch its own cycle's accounts (plus
--      platform-level accounts), so one cycle's money can never pay another's investors.
--   4. A ledger account can't be moved to a different cycle.
--   5. Money is integer kobo (bigint), never floating point.
--
-- Nobody writes to these tables through the API. Money is posted only by internal
-- functions (funding, disbursement, settlement) that call private.post_journal_entry.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Cycles
-- -----------------------------------------------------------------------------

create type public.cycle_status as enum (
  'draft', 'pending_approval', 'open_for_funding', 'funded', 'in_progress',
  'harvested', 'settled', 'cancelled', 'refunded'
);

/** Who funds the cycle: licensed investors, a government/donor programme, or both. */
create type public.funding_source as enum ('investor', 'programme', 'blended');

create table public.cycles (
  id uuid primary key default gen_random_uuid(),
  -- Human-readable reference, e.g. KD-MAIZE-2027-001.
  code varchar(40) not null unique,
  crop varchar(60) not null,
  season varchar(40) not null,
  status public.cycle_status not null default 'draft',
  funding_source public.funding_source not null,
  target_amount_kobo bigint not null check (target_amount_kobo > 0),
  budget_per_hectare_kobo bigint not null check (budget_per_hectare_kobo > 0),
  -- Yield assumptions in tonnes per hectare, shown as a range — never a promise.
  yield_low_t_per_ha numeric(8, 3) not null,
  yield_expected_t_per_ha numeric(8, 3) not null,
  yield_high_t_per_ha numeric(8, 3) not null,
  funding_deadline date,
  start_date date,
  expected_harvest_date date,
  cooperative_id uuid references public.cooperatives (id) on delete restrict,
  manager_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (yield_low_t_per_ha >= 0
         and yield_low_t_per_ha <= yield_expected_t_per_ha
         and yield_expected_t_per_ha <= yield_high_t_per_ha)
);

create trigger cycles_touch before update on public.cycles
for each row execute function private.touch_updated_at();

create table public.cycle_farms (
  cycle_id uuid not null references public.cycles (id) on delete cascade,
  farm_id uuid not null references public.farms (id) on delete restrict,
  primary key (cycle_id, farm_id)
);
create index cycle_farms_farm_idx on public.cycle_farms (farm_id);

create type public.milestone_status as enum (
  'pending', 'awaiting_verification', 'verified', 'released', 'blocked'
);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycles (id) on delete cascade,
  sequence smallint not null,
  name varchar(100) not null,
  planned_date date,
  amount_kobo bigint not null check (amount_kobo >= 0),
  status public.milestone_status not null default 'pending',
  verified_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, sequence)
);

create trigger milestones_touch before update on public.milestones
for each row execute function private.touch_updated_at();

create type public.price_terms as enum ('fixed', 'floor', 'formula');
create type public.offtake_status as enum ('draft', 'signed', 'approved', 'fulfilled', 'breached');

create table public.offtake_contracts (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycles (id) on delete cascade,
  buyer_name varchar(200) not null,
  buyer_contact varchar(200),
  commodity varchar(60) not null,
  volume_tonnes numeric(12, 3) not null check (volume_tonnes > 0),
  price_terms public.price_terms not null,
  price_per_tonne_kobo bigint check (price_per_tonne_kobo > 0),
  price_floor_per_tonne_kobo bigint check (price_floor_per_tonne_kobo > 0),
  price_formula text,
  delivery_window_start date,
  delivery_window_end date,
  document_url varchar(500) check (document_url ~ '^https://'),
  status public.offtake_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (delivery_window_end is null or delivery_window_start is null
         or delivery_window_end >= delivery_window_start)
);

create trigger offtake_contracts_touch before update on public.offtake_contracts
for each row execute function private.touch_updated_at();

-- Read access for staff. Writes arrive with the cycle builder.
do $$
declare
  t text;
begin
  foreach t in array array['cycles', 'cycle_farms', 'milestones', 'offtake_contracts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.is_registry_reader()))',
      t || '_read', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Ledger
-- -----------------------------------------------------------------------------

create type public.account_type as enum ('asset', 'liability', 'equity', 'income', 'expense');

create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  code varchar(60) not null,
  name varchar(200) not null,
  type public.account_type not null,
  -- Null for platform-level accounts (e.g. fee income); otherwise the one cycle it belongs to.
  cycle_id uuid references public.cycles (id) on delete restrict,
  created_at timestamptz not null default now()
);
create unique index ledger_accounts_platform_code on public.ledger_accounts (code)
  where cycle_id is null;
create unique index ledger_accounts_cycle_code on public.ledger_accounts (cycle_id, code)
  where cycle_id is not null;

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_number bigint generated always as identity unique,
  cycle_id uuid references public.cycles (id) on delete restrict,
  description varchar(300) not null,
  -- The trustee's or payment partner's transaction reference.
  reference varchar(120),
  posted_by uuid not null references public.profiles (id) on delete restrict,
  posted_at timestamptz not null default now(),
  -- A correcting entry points at the entry it cancels; each entry can be reversed once.
  reversal_of uuid unique references public.journal_entries (id) on delete restrict
);

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries (id) on delete restrict,
  account_id uuid not null references public.ledger_accounts (id) on delete restrict,
  -- Positive = debit, negative = credit.
  amount_kobo bigint not null check (amount_kobo <> 0),
  memo varchar(200)
);
create index journal_lines_entry_idx on public.journal_lines (journal_entry_id);
create index journal_lines_account_idx on public.journal_lines (account_id);

-- 1. Append-only
create function private.ledger_forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'The ledger is append-only: % on % is not allowed. Post a reversing entry instead.',
    tg_op, tg_table_name
    using errcode = 'insufficient_privilege';
end $$;

create trigger journal_entries_append_only before update or delete on public.journal_entries
for each row execute function private.ledger_forbid_change();
create trigger journal_entries_no_truncate before truncate on public.journal_entries
for each statement execute function private.ledger_forbid_change();
create trigger journal_lines_append_only before update or delete on public.journal_lines
for each row execute function private.ledger_forbid_change();
create trigger journal_lines_no_truncate before truncate on public.journal_lines
for each statement execute function private.ledger_forbid_change();

-- 2. Balanced entries, checked when the transaction commits
create function private.ledger_assert_balanced(entry_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  total bigint;
  line_count integer;
begin
  select coalesce(sum(amount_kobo), 0), count(*) into total, line_count
    from public.journal_lines where journal_entry_id = entry_id;
  if line_count < 2 then
    raise exception 'Journal entry % must have at least two lines (has %)', entry_id, line_count
      using errcode = 'check_violation';
  end if;
  if total <> 0 then
    raise exception 'Journal entry % does not balance: lines sum to % kobo', entry_id, total
      using errcode = 'check_violation';
  end if;
end $$;

create function private.ledger_check_entry_balanced() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform private.ledger_assert_balanced(new.id);
  return null;
end $$;

create function private.ledger_check_line_balanced() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform private.ledger_assert_balanced(new.journal_entry_id);
  return null;
end $$;

create constraint trigger journal_entries_balanced after insert on public.journal_entries
deferrable initially deferred
for each row execute function private.ledger_check_entry_balanced();
create constraint trigger journal_lines_balanced after insert on public.journal_lines
deferrable initially deferred
for each row execute function private.ledger_check_line_balanced();

-- 3. No movement of money between cycles
create function private.ledger_check_line_cycle() returns trigger
language plpgsql set search_path = '' as $$
declare
  entry_cycle uuid;
  account_cycle uuid;
begin
  select cycle_id into entry_cycle from public.journal_entries where id = new.journal_entry_id;
  select cycle_id into account_cycle from public.ledger_accounts where id = new.account_id;
  if account_cycle is not null and account_cycle is distinct from entry_cycle then
    raise exception 'Account % belongs to a different cycle than journal entry %; money cannot move between cycles',
      new.account_id, new.journal_entry_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger journal_lines_same_cycle before insert on public.journal_lines
for each row execute function private.ledger_check_line_cycle();

-- 4. Accounts stay in their cycle
create function private.ledger_account_cycle_fixed() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.cycle_id is distinct from old.cycle_id then
    raise exception 'A ledger account cannot be moved to another cycle'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger ledger_accounts_cycle_fixed before update of cycle_id on public.ledger_accounts
for each row execute function private.ledger_account_cycle_fixed();

-- Posting. p_lines is a JSON array of {"account_id", "amount_kobo", "memo"}.
-- amount_kobo may be a JSON number or a string; it must be a whole number of kobo.
create function private.post_journal_entry(
  p_cycle_id uuid,
  p_description text,
  p_posted_by uuid,
  p_lines jsonb,
  p_reference text default null,
  p_reversal_of uuid default null
) returns uuid
language plpgsql set search_path = '' as $$
declare
  entry_id uuid;
  line jsonb;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal entry needs at least two lines' using errcode = 'PT400';
  end if;
  insert into public.journal_entries (cycle_id, description, reference, posted_by, reversal_of)
  values (p_cycle_id, p_description, p_reference, p_posted_by, p_reversal_of)
  returning id into entry_id;

  for line in select * from jsonb_array_elements(p_lines) loop
    if (line ->> 'amount_kobo') !~ '^-?[0-9]+$' then
      raise exception 'Line amounts must be whole kobo, got %', line ->> 'amount_kobo'
        using errcode = 'PT400';
    end if;
    insert into public.journal_lines (journal_entry_id, account_id, amount_kobo, memo)
    values (entry_id, (line ->> 'account_id')::uuid, (line ->> 'amount_kobo')::bigint,
            line ->> 'memo');
  end loop;
  -- Fail now with a clear message rather than at commit.
  perform private.ledger_assert_balanced(entry_id);
  return entry_id;
end $$;

/** Corrects a posted entry by adding its mirror image. The original is never changed. */
create function private.reverse_journal_entry(p_entry_id uuid, p_posted_by uuid, p_reason text)
returns uuid
language plpgsql set search_path = '' as $$
declare
  original public.journal_entries;
begin
  select * into original from public.journal_entries where id = p_entry_id;
  if not found then
    raise exception 'Journal entry not found' using errcode = 'PT404';
  end if;
  if exists (select 1 from public.journal_entries where reversal_of = p_entry_id) then
    raise exception 'This entry has already been reversed' using errcode = 'PT409';
  end if;
  return private.post_journal_entry(
    original.cycle_id,
    left(format('Reversal of #%s: %s', original.entry_number, p_reason), 300),
    p_posted_by,
    (select jsonb_agg(jsonb_build_object(
              'account_id', account_id, 'amount_kobo', (-amount_kobo)::text, 'memo', memo))
       from public.journal_lines where journal_entry_id = p_entry_id),
    original.reference,
    p_entry_id
  );
end $$;

-- Ledger access: read-only, and only for admins, auditors and compliance.
do $$
declare
  t text;
begin
  foreach t in array array['ledger_accounts', 'journal_entries', 'journal_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.is_ledger_reader()))',
      t || '_read', t);
  end loop;
end $$;

/** Debit-positive balance per account, in kobo (as text, so no precision is lost in JSON). */
create view public.ledger_balances with (security_invoker = true) as
select a.id as account_id, a.code, a.name, a.type, a.cycle_id,
       coalesce(sum(l.amount_kobo), 0)::text as balance_kobo
  from public.ledger_accounts a
  left join public.journal_lines l on l.account_id = a.id
 group by a.id;

revoke all on public.ledger_balances from anon, authenticated;
grant select on public.ledger_balances to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
