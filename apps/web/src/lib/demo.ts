import { ROLE_LABELS } from './roles';
import type { Role } from './types';

/**
 * One-click sign-in for demo accounts, configured in .env.local (never committed):
 *
 *   VITE_DEMO_PASSWORD=...                 shared by every demo account
 *   VITE_ADMIN_DEMO_PASSWORD=...           optional: overrides it for one role
 *                                          (VITE_<ROLE>_DEMO_PASSWORD, e.g. VITE_TRUSTEE_DEMO_PASSWORD)
 *   VITE_DEMO_ACCOUNTS=admin:you@example.com,field_agent:agent@example.com,...
 *
 * An account with no password (shared or its own) gets no button. Buttons appear on the
 * development server (npm run dev / dev:phone) and in hosted demo builds (see below) only.
 */
export interface DemoAccount {
  role: Role;
  label: string;
  email: string;
  password: string;
}

type Env = Record<string, string | undefined>;

/** The password for a role: its own VITE_<ROLE>_DEMO_PASSWORD, else the shared one. */
export function passwordFor(role: Role, env: Env): string {
  const own = env[`VITE_${role.toUpperCase()}_DEMO_PASSWORD`]?.trim();
  return own || env.VITE_DEMO_PASSWORD?.trim() || '';
}

export function parseDemoAccounts(value: string, env: Env = {}): DemoAccount[] {
  return value
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .flatMap((pair) => {
      const [role, email] = pair.split(':').map((s) => s.trim());
      if (!email || !email.includes('@') || !(role in ROLE_LABELS)) return [];
      const password = passwordFor(role as Role, env);
      if (!password) return [];
      return [{ role: role as Role, label: ROLE_LABELS[role as Role], email, password }];
    });
}

/**
 * A hosted demo is a production build made with VITE_DEMO_MODE=true, pointed at a Supabase
 * project that holds only demo data. It keeps the demo sign-in buttons and simulated GPS,
 * shows a "sample data" banner and hides self sign-up. Any other production build contains
 * no demo accounts or passwords.
 */
const hosted = import.meta.env.VITE_DEMO_MODE === 'true';
const enabled = import.meta.env.DEV || hosted;

export const demo = {
  /** A public demo deployment (not the development server). */
  hosted,
  /** Demo conveniences such as simulated GPS are available. */
  enabled,
  accounts: enabled
    ? parseDemoAccounts(
        (import.meta.env.VITE_DEMO_ACCOUNTS as string | undefined) ?? '',
        import.meta.env as unknown as Env,
      )
    : [],
};
