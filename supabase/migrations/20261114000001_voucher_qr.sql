-- =============================================================================
-- Agrowth 2.0 — scanning vouchers at the counter
--
-- Each voucher slip now carries a QR code. It's a link to the app's Redeem page with
-- the voucher's scan token, a secret separate from the printed code, so a vendor can
-- point a phone's camera at the slip and land on the voucher, ready to redeem.
--
--   * The scan token is 24 random characters (120 bits): it can't be guessed, and it
--     can't be worked out from the printed code. Tokens live in a private table the API
--     can't reach; staff who print slips get them through voucher_slip_tokens.
--   * By default a scan alone identifies the voucher, as cash would. If slips start going
--     astray, an admin can require the farmer's phone digits after a scan too
--     (voucher_settings.scan_needs_phone).
--   * Typing the code and the phone digits works as before. Wrong scans count towards the
--     same lock-out as wrong codes.
-- =============================================================================

create table public.voucher_settings (
  id boolean primary key default true check (id),
  -- Ask for the last 4 digits of the farmer's phone after a scan, as with a typed code.
  scan_needs_phone boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict
);
insert into public.voucher_settings default values;

alter table public.voucher_settings enable row level security;
revoke all on public.voucher_settings from anon, authenticated;
grant select on public.voucher_settings to authenticated;
grant update (scan_needs_phone) on public.voucher_settings to authenticated;
create policy voucher_settings_read on public.voucher_settings for select to authenticated
  using (true);
create policy voucher_settings_update on public.voucher_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create function private.stamp_voucher_settings() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger voucher_settings_stamp before update on public.voucher_settings
for each row execute function private.stamp_voucher_settings();

-- -----------------------------------------------------------------------------
-- Scan tokens
-- -----------------------------------------------------------------------------

create function private.new_scan_token() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(24);
  token text := '';
begin
  for i in 0..23 loop
    token := token || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return token;
end $$;

create table private.voucher_scan_tokens (
  voucher_id uuid primary key references public.vouchers (id) on delete cascade,
  token char(24) not null unique default private.new_scan_token()
);

insert into private.voucher_scan_tokens (voucher_id) select id from public.vouchers;

create function private.give_voucher_scan_token() returns trigger
language plpgsql set search_path = '' as $$
begin
  insert into private.voucher_scan_tokens (voucher_id) values (new.id);
  return new;
end $$;
create trigger vouchers_scan_token after insert on public.vouchers
for each row execute function private.give_voucher_scan_token();

/**
 * The scan tokens of a cycle's vouchers, for printing their QR codes. Only for staff who
 * can see the cycle; vendors never get them.
 */
create function public.voucher_slip_tokens(p_cycle_id uuid)
returns table (voucher_id uuid, token text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_cycle_reader() then
    raise exception 'Your role cannot print voucher slips' using errcode = 'PT403';
  end if;
  return query
    select v.id, t.token::text
      from public.vouchers v
      join private.voucher_scan_tokens t on t.voucher_id = v.id
     where v.cycle_id = p_cycle_id;
end $$;

-- -----------------------------------------------------------------------------
-- Checking and redeeming by scan
-- -----------------------------------------------------------------------------

/** The scan token in whatever the camera read: the token itself or the slip's link. */
create function private.scan_token_from(p_scanned text) returns text
language sql immutable set search_path = '' as $$
  select upper(coalesce(
    substring(coalesce(p_scanned, '') from '[?&]v=([A-Za-z0-9]{24})(?:&|$)'),
    substring(regexp_replace(coalesce(p_scanned, ''), '\s', '', 'g') from '^([A-Za-z0-9]{24})$')))
$$;

/**
 * Finds a voucher by its scan token (and the phone digits, when the setting asks for
 * them), recording the attempt like a typed code. Returns null if nothing matches,
 * without saying why. The caller must not raise after a null.
 */
create function private.match_scanned_voucher(p_scanned text, p_phone_last4 text)
returns public.vouchers
language plpgsql set search_path = '' as $$
declare
  v public.vouchers;
  phone text;
begin
  perform private.assert_not_throttled();
  select vo.* into v
    from private.voucher_scan_tokens t
    join public.vouchers vo on vo.id = t.voucher_id
   where t.token = private.scan_token_from(p_scanned);
  if found and (select scan_needs_phone from public.voucher_settings) then
    select regexp_replace(f.phone, '[^0-9]', '', 'g') into phone
      from public.farmers f where f.id = v.farmer_id;
    if right(phone, 4) is distinct from regexp_replace(coalesce(p_phone_last4, ''), '[^0-9]', '', 'g') then
      v := null;
    end if;
  end if;
  insert into private.voucher_attempts (user_id, succeeded) values (auth.uid(), v.id is not null);
  return v;
end $$;

/**
 * What a scan needs besides itself: { needs_phone }. Lets the counter ask for the phone
 * digits before checking, rather than counting a scan without them as a wrong attempt.
 */
create function public.voucher_scan_rules() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('needs_phone', scan_needs_phone) from public.voucher_settings
$$;

/** Step 1 by scan: check the voucher before handing anything over. */
create function public.check_scanned_voucher(p_scanned text, p_phone_last4 text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.vouchers;
begin
  perform private.current_vendor();
  v := private.match_scanned_voucher(p_scanned, p_phone_last4);
  if v.id is null then
    return jsonb_build_object('ok', false, 'message',
      case when (select scan_needs_phone from public.voucher_settings)
        then 'No voucher matches that scan and phone number. Check the digits with the farmer, or type the code.'
        else 'That QR code isn''t a voucher. Type the code from the slip instead.' end);
  end if;
  return private.voucher_summary(v) || jsonb_build_object('scanned', true);
end $$;

/** Records a redemption against a voucher already matched by code or scan. */
create function private.redeem_matched(
  p_vendor public.vendors, p_voucher_id uuid, p_amount_kobo bigint, p_items text
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v public.vouchers;
  reason text;
  new_id uuid;
begin
  select * into v from public.vouchers where id = p_voucher_id for update;
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
  values (v.id, p_vendor.id, v.cycle_id, p_amount_kobo, left(trim(p_items), 500), auth.uid())
  returning id into new_id;

  update public.vouchers
     set redeemed_kobo = redeemed_kobo + p_amount_kobo,
         status = (case when redeemed_kobo + p_amount_kobo = value_kobo then 'redeemed' else 'active' end)::public.voucher_status
   where id = v.id
   returning * into v;

  perform private.log_cycle_event(v.cycle_id, 'voucher_redeemed',
    format('%s redeemed %s of voucher %s: %s', p_vendor.name, private.format_naira(p_amount_kobo),
      v.code, left(trim(p_items), 200)),
    jsonb_build_object('voucher_id', v.id, 'redemption_id', new_id, 'vendor_id', p_vendor.id));

  return private.voucher_summary(v) || jsonb_build_object('redemption_id', new_id);
end $$;

/** Step 2 by scan: record what was supplied. */
create function public.redeem_scanned_voucher(
  p_scanned text, p_amount_kobo bigint, p_items text, p_phone_last4 text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  vendor public.vendors;
  v public.vouchers;
begin
  vendor := private.current_vendor();
  v := private.match_scanned_voucher(p_scanned, p_phone_last4);
  if v.id is null then
    return jsonb_build_object('ok', false,
      'message', 'No voucher matches that scan. Type the code from the slip instead.');
  end if;
  return private.redeem_matched(vendor, v.id, p_amount_kobo, p_items);
end $$;

-- The typed route now shares the same redemption steps.
create or replace function public.redeem_voucher(
  p_code text, p_phone_last4 text, p_amount_kobo bigint, p_items text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  vendor public.vendors;
  v public.vouchers;
begin
  vendor := private.current_vendor();
  v := private.match_voucher(p_code, p_phone_last4);
  if v.id is null then
    return jsonb_build_object('ok', false,
      'message', 'No voucher matches that code and phone number. Check both with the farmer.');
  end if;
  return private.redeem_matched(vendor, v.id, p_amount_kobo, p_items);
end $$;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.voucher_slip_tokens(uuid),
  public.voucher_scan_rules(),
  public.check_scanned_voucher(text, text),
  public.redeem_scanned_voucher(text, bigint, text, text),
  public.redeem_voucher(text, text, bigint, text)
to authenticated;
