import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(import.meta.dirname, '..', 'migrations');

/**
 * Supabase refuses an UPDATE or DELETE without a WHERE clause (its safeupdate guard), even
 * inside a function. The test database doesn't, so this reads the migrations for them.
 */
describe('migrations', () => {
  /** Statements fixed by a later migration, which replaced the function holding them. */
  const fixedLater = new Set(['20261115000002_payout_accounts.sql:operator_settings']);

  it('never update or delete without a WHERE clause', () => {
    const unguarded: string[] = [];
    for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql'))) {
      const sql = readFileSync(join(DIR, file), 'utf8')
        // Comments and quoted text can hold anything, semicolons included.
        .replace(/--[^\n]*/g, '')
        .replace(/'(?:[^']|'')*'/g, "''");
      for (const m of sql.matchAll(
        /\b(update|delete\s+from)\s+(public|private)\.(\w+)\b([\s\S]*?);/gi,
      )) {
        // ON CONFLICT … DO UPDATE belongs to an INSERT, and has its own rules.
        const before = sql.slice(Math.max(0, m.index! - 12), m.index!);
        if (/\bdo\s*$/i.test(before)) continue;
        if (!/\bwhere\b/i.test(m[4]) && !fixedLater.has(`${file}:${m[3]}`)) {
          unguarded.push(`${file}: ${m[1]} ${m[2]}.${m[3]}`);
        }
      }
    }
    expect(unguarded).toEqual([]);
  });
});
