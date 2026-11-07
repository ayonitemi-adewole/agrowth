import {
  ClipboardCheck,
  Crown,
  Eye,
  Landmark,
  Loader2,
  MapPinned,
  ShieldCheck,
  Store,
  TrendingUp,
  UserRound,
  Wheat,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { demo, type DemoAccount } from '../lib/demo';
import { errorMessage } from '../lib/errors';
import type { Role } from '../lib/types';
import { Alert, cx } from './ui';

const ROLE_ICON: Partial<Record<Role, LucideIcon>> = {
  admin: Crown,
  field_agent: MapPinned,
  compliance_officer: ShieldCheck,
  cycle_manager: Wheat,
  programme_manager: Wheat,
  trustee: Landmark,
  auditor: Eye,
  vendor: Store,
  investor: TrendingUp,
};

const ROLE_HINT: Partial<Record<Role, string>> = {
  admin: 'Assigns roles',
  field_agent: 'Enrols, maps, visits',
  compliance_officer: 'KYC and approvals',
  cycle_manager: 'Builds cycles, releases',
  programme_manager: 'Builds programme cycles',
  trustee: 'Confirms money',
  auditor: 'Reads the ledger',
  vendor: 'Redeems vouchers',
  investor: 'Invests in cycles',
};

/** What each role does, for visitors to a hosted demo. */
const ROLE_DETAIL: Partial<Record<Role, string>> = {
  admin: 'Manages users and their roles',
  field_agent: 'Enrols farmers, maps farms, records GPS-checked visits',
  compliance_officer: 'Reviews KYC and approves cycles',
  cycle_manager: 'Builds cycles and instructs staged releases',
  programme_manager: 'Runs government programme cycles',
  trustee: 'Confirms deposits, payments and payouts',
  auditor: 'Read-only view of every record and the ledger',
  vendor: "An agro-dealer's counter, redeeming farmers' input vouchers",
  investor: 'Browses cycles, pledges, tracks the farms and the payouts',
};

/**
 * One-click sign-in buttons for the demo accounts listed in .env.local. `detailed` is the
 * hosted demo's version: one role per row, with what that role does.
 */
export function DemoSignIn({ detailed = false }: { detailed?: boolean }) {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (demo.accounts.length === 0) return null;

  const go = async (account: DemoAccount) => {
    setBusy(account.email);
    setError(null);
    try {
      await signIn(account.email, account.password);
    } catch (err) {
      setError(`${account.label}: ${errorMessage(err)}`);
      setBusy(null);
    }
  };

  return (
    <div className={detailed ? undefined : 'mt-8'}>
      {!detailed && (
        <div className="mb-3 flex items-center gap-3 text-xs font-medium text-zinc-400">
          <span className="h-px flex-1 bg-zinc-200" />
          Demo accounts
          <span className="h-px flex-1 bg-zinc-200" />
        </div>
      )}
      <div className={cx('grid gap-2 sm:grid-cols-2')}>
        {demo.accounts.map((a) => {
          const Icon = ROLE_ICON[a.role] ?? UserRound;
          return (
            <button
              key={a.email}
              type="button"
              disabled={busy !== null}
              onClick={() => go(a)}
              title={a.email}
              className={cx(
                'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left ring-1 ring-zinc-950/10 transition',
                'hover:bg-brand-50 hover:ring-brand-600/30 disabled:opacity-60',
              )}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
                {busy === a.email ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Icon className="size-4" aria-hidden />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-zinc-900">{a.label}</span>
                <span className={cx('block text-xs text-zinc-500', !detailed && 'truncate')}>
                  {(detailed ? ROLE_DETAIL[a.role] : ROLE_HINT[a.role]) ?? a.email}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
    </div>
  );
}

/** Sidebar control to jump straight to another demo account. */
export function DemoSwitcher() {
  const { profile, signIn, signOut } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  if (demo.accounts.length === 0) return null;
  const others = demo.accounts.filter(
    (a) => a.email.toLowerCase() !== profile?.email.toLowerCase(),
  );

  const switchTo = async (email: string) => {
    const account = demo.accounts.find((a) => a.email === email);
    if (!account) return;
    setBusy(true);
    await signOut();
    try {
      await signIn(account.email, account.password);
      navigate('/');
    } catch {
      navigate('/sign-in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="mt-3 block">
      <span className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold tracking-wider text-brand-300/60 uppercase">
        {busy && <Loader2 className="size-3 animate-spin" aria-hidden />}
        <ClipboardCheck className={cx('size-3', busy && 'hidden')} aria-hidden /> Demo: switch
        account
      </span>
      <select
        value=""
        disabled={busy}
        onChange={(e) => switchTo(e.target.value)}
        className="w-full rounded-lg border-0 bg-white/10 px-3 py-2 text-sm text-white ring-1 ring-white/10 focus:ring-2 focus:ring-brand-400 focus:outline-none"
      >
        <option value="" disabled className="text-zinc-900">
          Sign in as…
        </option>
        {others.map((a) => (
          <option key={a.email} value={a.email} className="text-zinc-900">
            {a.label}
          </option>
        ))}
      </select>
    </label>
  );
}
