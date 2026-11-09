-- =============================================================================
-- Agrowth 2.0 — trustee bank files: payment files out, bank statements in
--
-- Until now the trustee typed a bank reference against every payment it made and every
-- deposit it received. Nigerian trustees and their banks work through files: bulk-payment
-- uploads to corporate internet banking, and statement exports. This connects to that:
--
--   Payments out
--     1. Every outstanding payment (release instructions, vendor payments for voucher
--        redemptions, settlement payouts) gets a payment reference, AGP-XXXXXXXXXX.
--     2. The trustee picks payments and creates a payment file. They're "with the bank"
--        until paid; a payment can't go in two live files, so it can't be paid twice by
--        accident. If the bank rejects one, the trustee withdraws it from the file.
--     3. The bank pays, with the reference in each narration.
--
--   Statements in
--     4. The trustee imports the bank statement. Each debit that carries a payment
--        reference and the right amount confirms that payment, exactly as the trustee
--        confirming it by hand would (same checks, same ledger entry), with the bank's
--        own reference. Each credit that carries a pledge reference (AGR-XXXXXXXX) and
--        the pledged amount confirms that pledge payment.
--     5. Anything else is left for the trustee: lines whose reference matched but whose
--        amount or state didn't ("needs review"), and lines with no reference
--        ("unmatched"), such as a programme's deposit or a buyer's payment. The trustee
--        records those on the cycle with the bank reference, and the line then shows as
--        already recorded; or dismisses it with a note (bank charges, say).
--
-- Statement lines are kept, and a line already imported is skipped, so importing
-- overlapping statements is safe. The bank file formats are handled by the app; this is
-- the same for any bank, and a bank's API could call the same functions later.
-- =============================================================================

create type public.payment_item_kind as enum ('disbursement', 'vendor_payment', 'settlement_payout');

/** The reference that ties a payment to its bank narration: AGP- and 10 hex characters. */
create function private.payment_reference(p_id uuid) returns text
language sql immutable set search_path = '' as $$
  select 'AGP-' || upper(left(md5(p_id::text), 10))
$$;

/**
 * Every payment the trustee makes to someone outside: who, where and how much, whether
 * it's paid, and why it can't go in a payment file if it can't (the trustee then pays it
 * by hand and confirms it on the cycle, as before).
 */
create function private.outbound_payments()
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
  -- Release instructions name the payee's bank and account in one field,
  -- e.g. "Access Bank 0123456789". Input vouchers aren't bank payments.
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
         ip.bank_name::text, ip.account_number::text, ip.account_name::text, p.amount_kobo,
         left(private.payment_reference(p.id) || ' ' || case p.kind
           when 'funder' then 'Settlement payout'
           when 'farmer' then 'Harvest surplus'
           else 'Management fee' end, 60),
         p.status = 'executed', p.trustee_reference::text,
         case when ip.user_id is null
              then 'No bank account on file: pay it directly and confirm it on the cycle' end,
         p.created_at
    from public.settlement_payouts p
    left join public.funding_contributions fc on fc.id = p.contribution_id
    left join public.investor_profiles ip on ip.user_id = fc.investor_id
   where p.status <> 'cancelled'
$$;

-- -----------------------------------------------------------------------------
-- Payment files
-- -----------------------------------------------------------------------------

create table public.payment_batches (
  id uuid primary key default gen_random_uuid(),
  item_count int not null check (item_count > 0),
  total_kobo bigint not null check (total_kobo > 0),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

/** What went in a payment file, as it was when the file was made. */
create table public.payment_batch_items (
  batch_id uuid not null references public.payment_batches (id) on delete restrict,
  kind public.payment_item_kind not null,
  item_id uuid not null,
  cycle_id uuid not null references public.cycles (id) on delete restrict,
  reference varchar(20) not null,
  payee_name varchar(200) not null,
  bank_name varchar(120),
  account_number char(10) not null,
  account_name varchar(200) not null,
  amount_kobo bigint not null check (amount_kobo > 0),
  narration varchar(60) not null,
  -- Taken out of the file (the bank rejected it, or it was never uploaded).
  withdrawn_at timestamptz,
  withdrawn_by uuid references public.profiles (id) on delete restrict,
  withdraw_reason varchar(300),
  primary key (batch_id, kind, item_id),
  check ((withdrawn_at is null) = (withdrawn_by is null))
);
-- A payment can be in only one live file at a time.
create unique index payment_batch_items_live_idx on public.payment_batch_items (kind, item_id)
  where withdrawn_at is null;

/**
 * The payments the trustee has to make, newest last, with the payment file each is in.
 * Paid ones are included when asked for. The trustee, compliance and auditors can read it.
 */
create function public.trustee_payments(p_include_paid boolean default false)
returns table (
  kind public.payment_item_kind,
  item_id uuid,
  cycle_id uuid,
  cycle_code text,
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
  created_at timestamptz,
  batch_id uuid,
  batch_created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_ledger_reader() then
    raise exception 'Your role cannot see the trustee''s payments' using errcode = 'PT403';
  end if;
  return query
    select o.kind, o.item_id, o.cycle_id, c.code::text, o.reference, o.payee_name, o.bank_name,
           o.account_number, o.account_name, o.amount_kobo, o.narration, o.paid,
           o.trustee_reference, o.problem, o.created_at, b.batch_id, pb.created_at
      from private.outbound_payments() o
      join public.cycles c on c.id = o.cycle_id
      left join public.payment_batch_items b
        on b.kind = o.kind and b.item_id = o.item_id and b.withdrawn_at is null
      left join public.payment_batches pb on pb.id = b.batch_id
     where p_include_paid or not o.paid
     order by o.created_at;
end $$;

/**
 * The trustee puts payments in a new payment file. p_items is a JSON array of
 * { kind, item_id }. Returns the file's id; its lines are in payment_batch_items.
 */
create function public.create_payment_batch(p_items jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  o record;
  batch uuid;
  n int := 0;
  total bigint := 0;
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can make payment files' using errcode = 'PT403';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Choose at least one payment' using errcode = 'PT400';
  end if;

  insert into public.payment_batches (item_count, total_kobo, created_by)
  values (1, 1, auth.uid()) returning id into batch;

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
    if exists (select 1 from public.payment_batch_items
                where kind = o.kind and item_id = o.item_id and withdrawn_at is null) then
      raise exception '% (%) is already in a payment file. Withdraw it from that file first.',
        o.reference, o.payee_name using errcode = 'PT409';
    end if;
    insert into public.payment_batch_items (
      batch_id, kind, item_id, cycle_id, reference, payee_name, bank_name, account_number,
      account_name, amount_kobo, narration
    ) values (
      batch, o.kind, o.item_id, o.cycle_id, o.reference, o.payee_name, o.bank_name,
      o.account_number, o.account_name, o.amount_kobo, o.narration
    );
    n := n + 1;
    total := total + o.amount_kobo;
  end loop;

  update public.payment_batches set item_count = n, total_kobo = total where id = batch;
  return batch;
end $$;

/**
 * Takes an unpaid payment out of its payment file, for example because the bank
 * rejected it. It goes back to the payments waiting for a file.
 */
create function public.withdraw_batch_payment(
  p_batch_id uuid,
  p_kind public.payment_item_kind,
  p_item_id uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o record;
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can change payment files' using errcode = 'PT403';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why the payment is being withdrawn (e.g. the bank rejected the account)'
      using errcode = 'PT400';
  end if;
  select * into o from private.outbound_payments() op
   where op.kind = p_kind and op.item_id = p_item_id;
  if found and o.paid then
    raise exception 'This payment has been made; it can''t be withdrawn' using errcode = 'PT409';
  end if;
  update public.payment_batch_items
     set withdrawn_at = now(), withdrawn_by = auth.uid(), withdraw_reason = left(trim(p_reason), 300)
   where batch_id = p_batch_id and kind = p_kind and item_id = p_item_id and withdrawn_at is null;
  if not found then
    raise exception 'That payment is not live in this payment file' using errcode = 'PT404';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Bank statements
-- -----------------------------------------------------------------------------

create type public.statement_line_status as enum (
  'confirmed',         -- matched a payment or pledge and confirmed it
  'already_recorded',  -- its bank reference is already on a recorded payment or deposit
  'needs_review',      -- the reference matched, but the amount or the payment's state didn't
  'unmatched',         -- no Agrowth reference; the trustee records it, or dismisses it
  'dismissed'          -- the trustee dealt with it outside the platform, with a note
);

create table public.bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  file_name varchar(200) not null,
  -- Counts of new lines by status, and of lines skipped as already imported.
  summary jsonb not null default '{}',
  imported_by uuid not null references public.profiles (id) on delete restrict,
  imported_at timestamptz not null default now()
);

create table public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.bank_statement_imports (id) on delete restrict,
  line_no int not null,
  value_date date not null,
  narration varchar(500) not null,
  bank_reference varchar(120),
  -- Money in is positive, money out negative.
  amount_kobo bigint not null check (amount_kobo <> 0),
  balance_kobo bigint,
  -- Identifies the line across overlapping statements: the bank reference if there is
  -- one, otherwise the date, amount, narration and balance.
  fingerprint char(32) not null unique,
  status public.statement_line_status not null,
  matched_kind varchar(30) check (matched_kind in (
    'pledge', 'funding', 'receipt', 'disbursement', 'vendor_payment', 'settlement_payout')),
  matched_id uuid,
  note varchar(500),
  resolved_by uuid references public.profiles (id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index bank_statement_lines_open_idx on public.bank_statement_lines (status)
  where status in ('needs_review', 'unmatched');

/** The reference a statement line is recorded under in the ledger. */
create function private.statement_line_reference(l public.bank_statement_lines) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(trim(l.bank_reference), ''), 'STMT-' || upper(left(l.fingerprint, 12)))
$$;

/** Matches one statement line and, when it can, confirms what it pays for. */
create function private.match_statement_line(p_line_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  l public.bank_statement_lines;
  ref text;
  code text;
  o record;
  p public.investment_pledges;
  found_kind text;
  found_id uuid;

  procedure_note text;
begin
  select * into l from public.bank_statement_lines where id = p_line_id for update;
  ref := private.statement_line_reference(l);

  -- Recorded already, by hand or by an earlier import, under this bank reference?
  select x.k, x.id into found_kind, found_id from (
    select 'funding' as k, id from public.funding_contributions where trustee_reference = ref
    union all select 'receipt', id from public.cycle_receipts where trustee_reference = ref
    union all select 'disbursement', id from public.disbursements where trustee_reference = ref
    union all select 'vendor_payment', id from public.voucher_redemptions where trustee_reference = ref
    union all select 'settlement_payout', id from public.settlement_payouts where trustee_reference = ref
  ) x limit 1;
  if found_kind is not null then
    update public.bank_statement_lines
       set status = 'already_recorded', matched_kind = found_kind, matched_id = found_id,
           note = null
     where id = l.id;
    return;
  end if;

  if l.amount_kobo < 0 then
    -- Money out: a payment the trustee made from a payment file.
    code := substring(upper(l.narration) from 'AGP-?[0-9A-F]{10}');
    if code is null then
      update public.bank_statement_lines set status = 'unmatched',
        note = 'No Agrowth payment reference (AGP-…) in the narration'
       where id = l.id;
      return;
    end if;
    code := 'AGP-' || right(code, 10);
    select * into o from private.outbound_payments() op where op.reference = code;
    if not found then
      update public.bank_statement_lines set status = 'unmatched',
        note = format('%s is not an Agrowth payment', code)
       where id = l.id;
      return;
    end if;
    if o.paid then
      update public.bank_statement_lines
         set status = 'needs_review', matched_kind = o.kind::text, matched_id = o.item_id,
             note = format('%s to %s was already confirmed (reference %s). Check this isn''t a second payment.',
                           code, o.payee_name, o.trustee_reference)
       where id = l.id;
      return;
    end if;
    if -l.amount_kobo <> o.amount_kobo then
      update public.bank_statement_lines
         set status = 'needs_review', matched_kind = o.kind::text, matched_id = o.item_id,
             note = format('%s to %s is %s, but %s left the account', code, o.payee_name,
                           private.format_naira(o.amount_kobo), private.format_naira(-l.amount_kobo))
       where id = l.id;
      return;
    end if;
    begin
      case o.kind
        when 'disbursement' then perform public.confirm_disbursement(o.item_id, ref);
        when 'vendor_payment' then perform public.confirm_redemption_payment(o.item_id, ref);
        else perform public.confirm_settlement_payout(o.item_id, ref);
      end case;
      update public.bank_statement_lines
         set status = 'confirmed', matched_kind = o.kind::text, matched_id = o.item_id,
             note = format('Confirmed %s to %s', code, o.payee_name)
       where id = l.id;
    exception when others then
      get stacked diagnostics procedure_note = message_text;
      update public.bank_statement_lines
         set status = 'needs_review', matched_kind = o.kind::text, matched_id = o.item_id,
             note = left(format('%s to %s couldn''t be confirmed: %s', code, o.payee_name,
                                procedure_note), 500)
       where id = l.id;
    end;
  else
    -- Money in: an investor paying their pledge quotes its reference.
    code := substring(upper(l.narration) from 'AGR-?[A-Z0-9]{8}');
    if code is null then
      update public.bank_statement_lines set status = 'unmatched',
        note = format('No pledge reference. If it''s a deposit or a buyer''s or insurer''s payment, record it on the cycle with reference %s, then try again.', ref)
       where id = l.id;
      return;
    end if;
    code := 'AGR-' || right(code, 8);
    select * into p from public.investment_pledges where reference = code;
    if not found then
      update public.bank_statement_lines set status = 'unmatched',
        note = format('%s is not a pledge reference', code)
       where id = l.id;
      return;
    end if;
    if p.status <> 'pending' then
      update public.bank_statement_lines
         set status = 'needs_review', matched_kind = 'pledge', matched_id = p.id,
             note = format('Pledge %s is already %s', code, p.status)
       where id = l.id;
      return;
    end if;
    if l.amount_kobo <> p.amount_kobo then
      update public.bank_statement_lines
         set status = 'needs_review', matched_kind = 'pledge', matched_id = p.id,
             note = format('Pledge %s is for %s, but %s arrived', code,
                           private.format_naira(p.amount_kobo), private.format_naira(l.amount_kobo))
       where id = l.id;
      return;
    end if;
    begin
      perform public.confirm_pledge_payment(p.id, ref, l.value_date);
      update public.bank_statement_lines
         set status = 'confirmed', matched_kind = 'pledge', matched_id = p.id,
             note = format('Confirmed pledge %s', code)
       where id = l.id;
    exception when others then
      get stacked diagnostics procedure_note = message_text;
      update public.bank_statement_lines
         set status = 'needs_review', matched_kind = 'pledge', matched_id = p.id,
             note = left(format('Pledge %s couldn''t be confirmed: %s', code, procedure_note), 500)
       where id = l.id;
    end;
  end if;
end $$;

/**
 * The trustee imports a bank statement. p_lines is a JSON array of
 * { value_date, narration, reference?, amount_kobo, balance_kobo? } with amounts as
 * whole kobo (money in positive, out negative). Lines already imported are skipped.
 * New lines are matched in date order, money in before money out on the same day.
 * Returns how many lines landed in each status.
 */
create function public.import_bank_statement(p_file_name text, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  line jsonb;
  pos int;
  v_import uuid;
  new_id uuid;
  v_amount bigint;
  v_balance bigint;
  v_date date;
  v_narration text;
  v_ref text;
  duplicates int := 0;
  v_summary jsonb;
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can import bank statements' using errcode = 'PT403';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'The statement has no lines' using errcode = 'PT400';
  end if;
  if jsonb_array_length(p_lines) > 5000 then
    raise exception 'Import at most 5,000 lines at a time' using errcode = 'PT400';
  end if;

  insert into public.bank_statement_imports (file_name, imported_by)
  values (left(coalesce(nullif(trim(p_file_name), ''), 'statement'), 200), auth.uid())
  returning id into v_import;

  for line, pos in select e, n from jsonb_array_elements(p_lines) with ordinality as t(e, n) loop
    if coalesce(line ->> 'amount_kobo', '') !~ '^-?[0-9]+$' or (line ->> 'amount_kobo')::bigint = 0 then
      raise exception 'Line %: the amount must be a non-zero whole number of kobo', pos
        using errcode = 'PT400';
    end if;
    if coalesce(line ->> 'balance_kobo', '0') !~ '^-?[0-9]+$' then
      raise exception 'Line %: the balance must be a whole number of kobo', pos using errcode = 'PT400';
    end if;
    begin
      v_date := (line ->> 'value_date')::date;
    exception when others then
      raise exception 'Line %: % is not a date', pos, coalesce(line ->> 'value_date', 'blank')
        using errcode = 'PT400';
    end;
    if v_date is null or v_date > current_date then
      raise exception 'Line %: the date is missing or in the future', pos using errcode = 'PT400';
    end if;
    v_narration := left(coalesce(trim(line ->> 'narration'), ''), 500);
    v_ref := left(nullif(trim(line ->> 'reference'), ''), 120);
    v_amount := (line ->> 'amount_kobo')::bigint;
    v_balance := (line ->> 'balance_kobo')::bigint;

    new_id := null;
    insert into public.bank_statement_lines (
      import_id, line_no, value_date, narration, bank_reference, amount_kobo, balance_kobo,
      fingerprint, status
    ) values (
      v_import, pos, v_date, v_narration, v_ref, v_amount, v_balance,
      md5(case when v_ref is not null then 'ref:' || upper(v_ref)
               else concat_ws('|', 'line', v_date, v_amount, v_narration, v_balance) end),
      'unmatched'
    )
    on conflict (fingerprint) do nothing
    returning id into new_id;
    if new_id is null then
      duplicates := duplicates + 1;
    end if;
  end loop;

  for new_id in
    select bl.id from public.bank_statement_lines bl
     where bl.import_id = v_import
     order by bl.value_date, bl.amount_kobo < 0, bl.line_no
  loop
    perform private.match_statement_line(new_id);
  end loop;

  select jsonb_build_object(
           'lines', count(*),
           'duplicates', duplicates,
           'confirmed', count(*) filter (where status = 'confirmed'),
           'already_recorded', count(*) filter (where status = 'already_recorded'),
           'needs_review', count(*) filter (where status = 'needs_review'),
           'unmatched', count(*) filter (where status = 'unmatched'))
    into v_summary
    from public.bank_statement_lines l
   where l.import_id = v_import;
  update public.bank_statement_imports set summary = v_summary
   where id = v_import;
  return v_summary;
end $$;

/** Tries a line that needs attention again, e.g. after recording the deposit by hand. */
create function public.retry_statement_line(p_line_id uuid) returns public.statement_line_status
language plpgsql security definer set search_path = '' as $$
declare
  s public.statement_line_status;
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can match statement lines' using errcode = 'PT403';
  end if;
  select status into s from public.bank_statement_lines where id = p_line_id for update;
  if not found then
    raise exception 'Statement line not found' using errcode = 'PT404';
  end if;
  if s not in ('needs_review', 'unmatched') then
    raise exception 'This line is already %', s using errcode = 'PT409';
  end if;
  perform private.match_statement_line(p_line_id);
  select status into s from public.bank_statement_lines where id = p_line_id;
  return s;
end $$;

/** The trustee sets a line aside, with a note: bank charges, a transfer between own accounts. */
create function public.dismiss_statement_line(p_line_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trustee() then
    raise exception 'Only the trustee can dismiss statement lines' using errcode = 'PT403';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Say what this line is, for the record' using errcode = 'PT400';
  end if;
  update public.bank_statement_lines
     set status = 'dismissed', note = left(trim(p_note), 500),
         resolved_by = auth.uid(), resolved_at = now()
   where id = p_line_id and status in ('needs_review', 'unmatched');
  if not found then
    raise exception 'Only lines that need attention can be dismissed' using errcode = 'PT409';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Access: readable by those who read the ledger, written only through the functions
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['payment_batches', 'payment_batch_items',
                           'bank_statement_imports', 'bank_statement_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated
                      using ((select public.is_ledger_reader()))', t || '_read', t);
  end loop;
end $$;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.trustee_payments(boolean),
  public.create_payment_batch(jsonb),
  public.withdraw_batch_payment(uuid, public.payment_item_kind, uuid, text),
  public.import_bank_statement(text, jsonb),
  public.retry_statement_line(uuid),
  public.dismiss_statement_line(uuid, text)
to authenticated;
