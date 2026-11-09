-- =============================================================================
-- Agrowth 2.0 — fix: set_operator_fee_account updates its one row by key
--
-- Supabase refuses an UPDATE with no WHERE clause (the safeupdate guard), so the
-- function failed on a real project: "UPDATE requires a WHERE clause". The settings table
-- has a single row, keyed id = true; the update now says so.
-- =============================================================================

create or replace function public.set_operator_fee_account(
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
         updated_by = auth.uid(), updated_at = now()
   where id;
end $$;
