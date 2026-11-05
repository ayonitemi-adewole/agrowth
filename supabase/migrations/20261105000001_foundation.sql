-- =============================================================================
-- Agrowth 2.0 — foundation: extensions, user profiles, roles and access helpers
--
-- Supabase Auth owns sign-up, login and passwords (auth.users). Each user gets a
-- row in public.profiles holding their role. Every table has row-level security,
-- and every permission check reads the role from here — never from the client.
-- =============================================================================

create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Internal helpers live in "private", which the Supabase API does not expose.
create schema if not exists private;
revoke all on schema private from public;

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------

create type public.user_role as enum (
  'admin',
  'cycle_manager',
  'field_agent',
  'compliance_officer',
  'auditor',
  'investor',
  'programme_manager',
  'vendor',
  'offtaker'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '' check (length(full_name) <= 200),
  phone varchar(20) check (phone ~ '^\+?[0-9]{10,15}$'),
  -- Everyone starts as an investor. Only an admin can grant a staff role.
  role public.user_role not null default 'investor',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
for each row execute function private.touch_updated_at();

-- A profile is created for every new sign-up. The role is always 'investor':
-- anything a user puts in their sign-up metadata about roles is ignored.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta_phone text := nullif(trim(new.raw_user_meta_data ->> 'phone'), '');
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(trim(new.raw_user_meta_data ->> 'full_name'), ''), 200),
    case when meta_phone ~ '^\+?[0-9]{10,15}$' then meta_phone end
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Access helpers used by row-level security policies and functions
-- -----------------------------------------------------------------------------

/** The signed-in user's role, or null if they are signed out or deactivated. */
create function public.app_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create function public.has_any_role(roles public.user_role[]) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(public.app_role() = any (roles), false)
$$;

create function public.is_admin() returns boolean
language sql stable set search_path = '' as $$
  select public.has_any_role(array['admin']::public.user_role[])
$$;

/** Staff who can see the farmer registry. Investors, vendors and offtakers cannot. */
create function public.is_registry_reader() returns boolean
language sql stable set search_path = '' as $$
  select public.has_any_role(array[
    'admin', 'cycle_manager', 'field_agent', 'compliance_officer', 'auditor', 'programme_manager'
  ]::public.user_role[])
$$;

/** Enrolment and farm mapping happen in the field. */
create function public.is_enroller() returns boolean
language sql stable set search_path = '' as $$
  select public.has_any_role(array['admin', 'field_agent']::public.user_role[])
$$;

create function public.is_cooperative_editor() returns boolean
language sql stable set search_path = '' as $$
  select public.has_any_role(array[
    'admin', 'field_agent', 'cycle_manager', 'programme_manager'
  ]::public.user_role[])
$$;

create function public.is_kyc_reviewer() returns boolean
language sql stable set search_path = '' as $$
  select public.has_any_role(array['admin', 'compliance_officer']::public.user_role[])
$$;

create function public.is_ledger_reader() returns boolean
language sql stable set search_path = '' as $$
  select public.has_any_role(array['admin', 'auditor', 'compliance_officer']::public.user_role[])
$$;

-- -----------------------------------------------------------------------------
-- Profiles: access
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
-- Users may edit their own name and phone; role and status go through admin functions.
grant update (full_name, phone) on public.profiles to authenticated;

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Admins manage roles and access. Nobody can change their own role or lock themselves out.
create function public.admin_set_user_role(p_user_id uuid, p_role public.user_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change roles' using errcode = 'PT403';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own role' using errcode = 'PT400';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  if not found then
    raise exception 'User not found' using errcode = 'PT404';
  end if;
end $$;

create function public.admin_set_user_active(p_user_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can activate or deactivate users' using errcode = 'PT403';
  end if;
  if p_user_id = auth.uid() and not p_active then
    raise exception 'You cannot deactivate your own account' using errcode = 'PT400';
  end if;
  update public.profiles set is_active = p_active where id = p_user_id;
  if not found then
    raise exception 'User not found' using errcode = 'PT404';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Identity-number hashing
--
-- BVN and NIN are never stored. A keyed hash (HMAC-SHA256) lets the registry
-- refuse a second enrolment of the same person. The key lives in Supabase Vault,
-- encrypted, and is generated here on first run.
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'pii_hash_pepper') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'pii_hash_pepper',
      'Key for NIN/BVN hashes. Never change it once farmers are enrolled.'
    );
  end if;
end $$;

create function private.hash_identifier(value text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  pepper text;
begin
  select decrypted_secret into pepper from vault.decrypted_secrets
   where name = 'pii_hash_pepper' limit 1;
  if pepper is null then
    raise exception 'The pii_hash_pepper secret is missing from Vault';
  end if;
  return encode(
    extensions.hmac(regexp_replace(value, '[\s-]', '', 'g'), pepper, 'sha256'),
    'hex'
  );
end $$;

-- -----------------------------------------------------------------------------
-- Function permissions: nothing is callable by signed-out visitors.
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.app_role(),
  public.has_any_role(public.user_role[]),
  public.is_admin(),
  public.is_registry_reader(),
  public.is_enroller(),
  public.is_cooperative_editor(),
  public.is_kyc_reviewer(),
  public.is_ledger_reader(),
  public.admin_set_user_role(uuid, public.user_role),
  public.admin_set_user_active(uuid, boolean)
to authenticated;
