/**
 * What the demo seed needs from a database. Two implementations exist:
 * - supabase-api.ts talks to a real Supabase project over its public API, signed in as each
 *   demo user, exactly as the web app does;
 * - the test in tests/seed.test.ts runs the same seed against the migrations on PGlite.
 *
 * Every write goes through a signed-in user, so row-level security and the database
 * functions check it. The only service-level writes are creating the accounts, giving
 * finished demo cycles past dates (see seed.ts), and recording identity-check results as
 * the identity-check Edge Function does.
 */
export type Row = Record<string, unknown>;

export type Role =
  | 'admin'
  | 'cycle_manager'
  | 'programme_manager'
  | 'field_agent'
  | 'compliance_officer'
  | 'auditor'
  | 'trustee'
  | 'vendor'
  | 'investor';

/** A signed-in user. */
export interface Session {
  rpc<T = unknown>(fn: string, args: Row): Promise<T>;
  /** Inserts and returns the inserted rows. */
  insert(table: string, rows: Row | Row[]): Promise<Row[]>;
  /** Rows of a table matching every key in `match`. */
  select(table: string, columns: string, match: Row): Promise<Row[]>;
  upload(bucket: string, path: string, body: Uint8Array, contentType: string): Promise<void>;
}

export interface SeedApi {
  /** Creates the account (or resets an existing one's password), sets its role, returns its id. */
  ensureUser(user: {
    email: string;
    password: string;
    fullName: string;
    role: Role;
  }): Promise<string>;
  as(userId: string): Session;
  /** Service-level read, used to check whether the project already holds demo data. */
  adminSelect(table: string, columns: string, match: Row): Promise<Row[]>;
  /**
   * Service-level update, used only to give finished demo cycles (and the investments in
   * them) past dates, to pause investor cooling-off while those investments are made, and
   * to allow simulated online payments on the demo.
   */
  adminUpdate(table: string, match: Row, values: Row): Promise<void>;
  /** Service-level function call, used only for public.complete_identity_check. */
  adminRpc(fn: string, args: Row): Promise<void>;
}
