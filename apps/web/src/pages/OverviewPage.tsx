import {
  ArrowRight,
  ClipboardCheck,
  Coins,
  Landmark,
  Lock,
  MapPinned,
  ShieldCheck,
  UserCheck,
  UsersRound,
  Wheat,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Alert, Card, SectionTitle, Skeleton, Stat } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatHectares } from '../lib/format';
import { formatNaira } from '../lib/money';
import { can } from '../lib/roles';
import { supabase } from '../lib/supabase';
import type { Role } from '../lib/types';
import { useAsync } from '../lib/useAsync';

const base = (table: string) => supabase.from(table).select('*', { count: 'exact', head: true });
type Query = ReturnType<typeof base>;

const count = async (table: string, apply: (q: Query) => Query = (q) => q) => {
  const { count, error } = await apply(base(table));
  if (error) throw error;
  return count ?? 0;
};

async function loadOverview(role: Role | undefined) {
  const registry = can.readRegistry(role);
  const [farmers, farms, cycles, funding, todo] = await Promise.all([
    registry ? count('farmers') : Promise.resolve(null),
    registry ? supabase.from('farms').select('area_hectares') : Promise.resolve(null),
    supabase.from('cycles').select('status'),
    supabase.from('cycle_funding').select('raised_kobo'),
    loadTodo(role),
  ]);
  if (farms?.error) throw farms.error;
  if (cycles.error) throw cycles.error;
  if (funding.error) throw funding.error;
  const statuses = cycles.data.map((c) => c.status as string);
  return {
    farmers,
    hectares: farms ? farms.data.reduce((s, f) => s + Number(f.area_hectares), 0) : null,
    farmCount: farms?.data.length ?? null,
    raising: statuses.filter((s) => s === 'open_for_funding').length,
    active: statuses.filter((s) => ['funded', 'in_progress', 'harvested'].includes(s)).length,
    held: funding.data.reduce((s, f) => s + BigInt(String(f.raised_kobo)), 0n),
    todo,
  };
}

interface Todo {
  icon: LucideIcon;
  label: string;
  count: number;
  to: string;
}

/** What's waiting for this role. */
async function loadTodo(role: Role | undefined): Promise<Todo[]> {
  const items: Promise<Todo>[] = [];
  const add = (icon: LucideIcon, label: string, to: string, n: Promise<number>) =>
    items.push(n.then((c) => ({ icon, label, to, count: c })));

  if (can.reviewCycles(role)) {
    add(
      ShieldCheck,
      'Cycles awaiting your approval',
      '/cycles',
      count('cycles', (q) => q.eq('status', 'pending_approval')),
    );
  }
  if (can.reviewKyc(role)) {
    add(
      UserCheck,
      'Farmers awaiting KYC review',
      '/farmers?kyc=pending',
      count('farmers', (q) => q.eq('kyc_status', 'pending')),
    );
  }
  if (can.actAsTrustee(role)) {
    add(
      Landmark,
      'Payments to confirm',
      '/cycles',
      count('disbursements', (q) => q.eq('status', 'instructed')),
    );
    add(
      Coins,
      'Cycles raising funds',
      '/cycles',
      count('cycles', (q) => q.eq('status', 'open_for_funding')),
    );
  }
  if (can.manageCycles(role)) {
    add(
      Wheat,
      'Draft cycles',
      '/cycles',
      count('cycles', (q) => q.eq('status', 'draft')),
    );
    add(
      Landmark,
      'Milestones verified, ready to release',
      '/cycles',
      count('milestones', (q) => q.eq('status', 'verified')),
    );
    add(
      Lock,
      'Milestones blocked by a failed visit',
      '/cycles',
      count('milestones', (q) => q.eq('status', 'blocked')),
    );
  }
  if (can.doFieldVisits(role)) {
    add(
      ClipboardCheck,
      'Milestones waiting for field visits',
      '/field',
      count('milestones', (q) => q.in('status', ['awaiting_verification', 'blocked'])),
    );
  }
  return Promise.all(items);
}

export function OverviewPage() {
  const { profile } = useAuth();
  const role = profile?.role;
  const state = useAsync(() => loadOverview(role), [role]);
  const d = state.data;
  const firstName = profile?.full_name?.split(' ')[0];

  return (
    <>
      <div className="mb-8">
        <p className="text-sm text-zinc-500">
          {new Date().toLocaleDateString('en-NG', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">
          {greeting()}
          {firstName ? `, ${firstName}` : ''}
        </h1>
      </div>

      {state.error ? (
        <Alert>{errorMessage(state.error)}</Alert>
      ) : (
        <div className="space-y-8">
          <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
            {!d ? (
              [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
            ) : (
              <>
                <Stat
                  icon={<Coins />}
                  label="Held by the trustee"
                  value={formatNaira(d.held, { compact: true })}
                  sub="Across all cycles"
                />
                <Stat
                  icon={<Wheat />}
                  tone="violet"
                  label="Active cycles"
                  value={d.active}
                  sub={`${d.raising} raising funds`}
                />
                {d.farmers !== null && (
                  <Stat
                    icon={<UsersRound />}
                    tone="blue"
                    label="Farmers enrolled"
                    value={d.farmers.toLocaleString()}
                  />
                )}
                {d.hectares !== null && (
                  <Stat
                    icon={<MapPinned />}
                    tone="amber"
                    label="Land mapped"
                    value={formatHectares(d.hectares)}
                    sub={`${d.farmCount} farms`}
                  />
                )}
              </>
            )}
          </div>

          <Card>
            <SectionTitle title="Needs your attention" />
            {!d ? (
              <Skeleton className="h-24" />
            ) : d.todo.length === 0 ? (
              <p className="text-sm text-zinc-500">Nothing assigned to your role.</p>
            ) : (
              <ul className="-mx-2 divide-y divide-zinc-950/5">
                {d.todo.map(({ icon: Icon, label, count: n, to }) => (
                  <li key={label}>
                    <Link
                      to={to}
                      className="group flex items-center gap-4 rounded-xl px-2 py-3 transition hover:bg-zinc-50"
                    >
                      <span
                        className={`grid size-9 place-items-center rounded-lg ${n > 0 ? 'bg-brand-50 text-brand-700' : 'bg-zinc-100 text-zinc-400'}`}
                      >
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span
                        className={`flex-1 text-sm ${n > 0 ? 'font-medium text-zinc-900' : 'text-zinc-500'}`}
                      >
                        {label}
                      </span>
                      <span
                        className={`min-w-7 rounded-full px-2 py-0.5 text-center text-xs font-semibold tabular-nums ${n > 0 ? 'bg-brand-700 text-white' : 'bg-zinc-100 text-zinc-500'}`}
                      >
                        {n}
                      </span>
                      <ArrowRight
                        className="size-4 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-zinc-500"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
