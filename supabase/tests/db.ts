import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { postgis } from '@electric-sql/pglite-postgis';

/**
 * The tests run the real migrations on PGlite (PostgreSQL compiled to WebAssembly,
 * with PostGIS), so no database server or Docker is needed.
 *
 * Supabase provides a few things the migrations rely on: the auth schema, the
 * anon/authenticated roles, Vault and the "extensions" schema. These stand-ins
 * mimic them closely enough to test permissions as a signed-in user would see them.
 */
const SUPABASE_STANDINS = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;

  create schema extensions;
  grant usage on schema extensions to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  -- Supabase grants new public tables and functions to the API roles by default;
  -- the migrations must revoke what they don't want exposed.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'
  );
  create function auth.uid() returns uuid language sql stable as $$
    select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated;

  create schema vault;
  create table vault.secrets (
    id uuid primary key default gen_random_uuid(),
    name text unique,
    description text,
    secret text not null
  );
  create view vault.decrypted_secrets as select id, name, description, secret as decrypted_secret from vault.secrets;
  create function vault.create_secret(new_secret text, new_name text, new_description text default '')
  returns uuid language sql as $$
    insert into vault.secrets (name, description, secret) values (new_name, new_description, new_secret) returning id
  $$;

  -- Supabase Storage keeps file records in storage.objects, protected by row-level security.
  create schema storage;
  grant usage on schema storage to anon, authenticated;
  create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text not null,
    owner uuid default auth.uid(),
    created_at timestamptz not null default now()
  );
  alter table storage.objects enable row level security;
  grant select, insert, update, delete on storage.objects to authenticated;
`;

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

export async function createDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pgcrypto, postgis } });
  await db.exec(SUPABASE_STANDINS);
  await db.exec('set search_path = public, extensions');
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return db;
}

export type Tx = Transaction;

/** Creates a user through "Supabase Auth" and gives them a role. */
export async function createUser(
  db: PGlite,
  email: string,
  role: string,
  meta: Record<string, unknown> = {},
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [email, JSON.stringify(meta)],
  );
  const id = rows[0].id;
  if (role !== 'investor') {
    await db.query(`update public.profiles set role = $1 where id = $2`, [role, id]);
  }
  return id;
}

/**
 * Runs queries as a signed-in API user: the "authenticated" role with their id in the
 * JWT claims, exactly as Supabase's API does. Row-level security applies.
 */
export function asUser<T>(db: PGlite, userId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    await tx.exec('set local role authenticated');
    return work(tx);
  });
}

/** Rejects with the PostgreSQL error, so tests can check code and message. */
export async function pgError(promise: Promise<unknown>): Promise<{
  code: string;
  message: string;
  detail?: string;
}> {
  try {
    await promise;
  } catch (err) {
    return err as { code: string; message: string; detail?: string };
  }
  throw new Error('Expected the database to raise an error, but it succeeded');
}

/** A square of `size` degrees with its south-west corner at (lon, lat). 0.0009° ≈ 100 m. */
export function square(lon: number, lat: number, size = 0.0009) {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lon, lat],
        [lon + size, lat],
        [lon + size, lat + size],
        [lon, lat + size],
        [lon, lat],
      ],
    ],
  };
}
