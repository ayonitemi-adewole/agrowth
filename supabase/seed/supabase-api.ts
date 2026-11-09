/**
 * The seed's database interface on a real Supabase project. Accounts are created with the
 * secret key; everything else is done signed in as each demo user with the publishable key,
 * exactly as the web app does, so row-level security and the database functions apply.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Row, SeedApi, Session } from './api.ts';

interface Config {
  url: string;
  publishableKey: string;
  secretKey: string;
}

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } };

type ApiError = { message: string; details?: string | null; hint?: string | null; code?: string };

function fail(context: string, error: ApiError): never {
  const extra = [error.details, error.hint].filter(Boolean).join(' — ');
  throw new Error(`${context}: ${error.message}${extra ? ` (${extra})` : ''}`);
}

export function supabaseApi(config: Config): SeedApi {
  const admin = createClient(config.url, config.secretKey, NO_SESSION);
  const credentials = new Map<string, { email: string; password: string }>();
  const clients = new Map<string, Promise<SupabaseClient>>();

  async function findUserId(email: string): Promise<string> {
    for (let page = 1; ; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) fail('Listing users', error);
      const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (user) return user.id;
      if (data.users.length < 200) throw new Error(`User ${email} exists but could not be found`);
    }
  }

  function signedIn(userId: string): Promise<SupabaseClient> {
    let client = clients.get(userId);
    if (!client) {
      client = (async () => {
        const c = createClient(config.url, config.publishableKey, NO_SESSION);
        const { email, password } = credentials.get(userId)!;
        const { error } = await c.auth.signInWithPassword({ email, password });
        if (error) fail(`Signing in as ${email}`, error);
        return c;
      })();
      clients.set(userId, client);
    }
    return client;
  }

  const session = (userId: string): Session => ({
    async rpc<T>(fn: string, args: Row) {
      const { data, error } = await (await signedIn(userId)).rpc(fn, args);
      if (error) fail(fn, error);
      return data as T;
    },
    async insert(table, rows) {
      const { data, error } = await (await signedIn(userId)).from(table).insert(rows).select();
      if (error) fail(`Adding to ${table}`, error);
      return data as Row[];
    },
    async select(table, columns, match) {
      const { data, error } = await (
        await signedIn(userId)
      )
        .from(table)
        .select(columns)
        .match(match);
      if (error) fail(`Reading ${table}`, error);
      return data as unknown as Row[];
    },
    async upload(bucket, path, body, contentType) {
      const { error } = await (
        await signedIn(userId)
      ).storage
        .from(bucket)
        .upload(path, body, { contentType, upsert: false });
      if (error) fail(`Uploading ${path}`, error);
    },
  });

  return {
    async ensureUser({ email, password, fullName, role }) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      let id = data.user?.id;
      if (error) {
        if (error.code !== 'email_exists' && !/already/i.test(error.message)) {
          fail(`Creating ${email}`, error);
        }
        id = await findUserId(email);
        const { error: e } = await admin.auth.admin.updateUserById(id, {
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName },
        });
        if (e) fail(`Updating ${email}`, e);
      }
      // Staff roles are granted the same way the README's first admin is: at the service level.
      const { error: e } = await admin
        .from('profiles')
        .update({ role, full_name: fullName, is_active: true })
        .eq('id', id!);
      if (e) fail(`Setting ${email}'s role`, e);
      credentials.set(id!, { email, password });
      return id!;
    },
    as: session,
    async adminSelect(table, columns, match) {
      const { data, error } = await admin.from(table).select(columns).match(match);
      if (error) fail(`Reading ${table}`, error);
      return data as unknown as Row[];
    },
    async adminUpdate(table, match, values) {
      const { error } = await admin.from(table).update(values).match(match);
      if (error) fail(`Updating ${table}`, error);
    },
    async adminRpc(fn, args) {
      const { error } = await admin.rpc(fn, args);
      if (error) fail(fn, error);
    },
  };
}
