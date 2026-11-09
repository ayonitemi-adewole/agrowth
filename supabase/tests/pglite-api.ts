import type { PGlite } from '@electric-sql/pglite';
import type { Row, SeedApi, Session } from '../seed/api';
import { asService, asUser, createUser } from './db';

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Bad identifier ${name}`);
  return name;
};

/** jsonb arguments travel as JSON text; text[] arrays and scalars as they are. */
const param = (v: unknown) =>
  v !== null &&
  typeof v === 'object' &&
  !(Array.isArray(v) && v.every((x) => typeof x === 'string'))
    ? JSON.stringify(v)
    : v;

const where = (match: Row, offset = 0) => {
  const keys = Object.keys(match);
  return {
    sql: keys.length
      ? ` where ${keys.map((k, i) => `${ident(k)} = $${i + 1 + offset}`).join(' and ')}`
      : '',
    values: keys.map((k) => match[k]),
  };
};

/** The seed's database interface, implemented on PGlite with the same RLS as Supabase's API. */
export function pgliteApi(db: PGlite): SeedApi {
  const session = (userId: string): Session => ({
    rpc: (fn, args) =>
      asUser(db, userId, async (tx) => {
        const keys = Object.keys(args);
        const { rows } = await tx.query<{ r: unknown }>(
          `select public.${ident(fn)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')}) as r`,
          keys.map((k) => param(args[k])),
        );
        return rows[0].r as never;
      }),
    insert: (table, input) =>
      asUser(db, userId, async (tx) => {
        const rows = Array.isArray(input) ? input : [input];
        const cols = Object.keys(rows[0]);
        const values: unknown[] = [];
        const tuples = rows.map(
          (r) => `(${cols.map((c) => `$${values.push(param(r[c]))}`).join(', ')})`,
        );
        const { rows: out } = await tx.query<Row>(
          `insert into public.${ident(table)} (${cols.map(ident).join(', ')}) values ${tuples.join(', ')} returning *`,
          values,
        );
        return out;
      }),
    select: (table, columns, match) =>
      asUser(db, userId, async (tx) => {
        const w = where(match);
        return (
          await tx.query<Row>(`select ${columns} from public.${ident(table)}${w.sql}`, w.values)
        ).rows;
      }),
    upload: (bucket, path) =>
      asUser(db, userId, async (tx) => {
        await tx.query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [
          bucket,
          path,
        ]);
      }),
  });

  return {
    ensureUser: ({ email, fullName, role }) => createUser(db, email, role, { full_name: fullName }),
    as: session,
    adminSelect: async (table, columns, match) => {
      const w = where(match);
      return (
        await db.query<Row>(`select ${columns} from public.${ident(table)}${w.sql}`, w.values)
      ).rows;
    },
    adminUpdate: async (table, match, values) => {
      const keys = Object.keys(values);
      const w = where(match, keys.length);
      await db.query(
        `update public.${ident(table)} set ${keys.map((k, i) => `${ident(k)} = $${i + 1}`).join(', ')}${w.sql}`,
        [...keys.map((k) => values[k]), ...w.values],
      );
    },
    adminRpc: (fn, args) =>
      asService(db, async (tx) => {
        const keys = Object.keys(args);
        await tx.query(
          `select public.${ident(fn)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')})`,
          keys.map((k) => param(args[k])),
        );
      }),
  };
}
