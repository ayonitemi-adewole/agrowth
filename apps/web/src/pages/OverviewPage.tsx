import {
  ArrowRight,
  Banknote,
  ClipboardCheck,
  Coins,
  HandCoins,
  Landmark,
  Lock,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sprout,
  Store,
  UserCheck,
  UsersRound,
  Wheat,
  type LucideIcon,
} from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Alert, Card, SectionTitle, Skeleton, Stat } from '../components/ui';
import { WeatherWatch } from '../components/WeatherWatch';
import { errorMessage } from '../lib/errors';
import { formatHectares } from '../lib/format';
import { formatNaira, toKobo } from '../lib/money';
import { can } from '../lib/roles';
import { supabase } from '../lib/supabase';
import type { CycleStatus, FarmMap as Farm, Role } from '../lib/types';
import { useAsync } from '../lib/useAsync';

// The map library is only downloaded when the map is shown.
const FarmMap = lazy(() => import('../components/FarmMap').then((m) => ({ default: m.FarmMap })));

const must = <T,>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

type Amount = { cycle_id: string; amount_kobo: string | number };
const total = (rows: Amount[]) => rows.reduce((s, r) => s + toKobo(r.amount_kobo), 0n);

/** Cycles that hold farms: from approval through harvest. */
const LIVE: CycleStatus[] = ['open_for_funding', 'funded', 'in_progress', 'harvested'];

async function loadOverview(role: Role | undefined) {
  const registry = can.readRegistry(role);
  const skip = Promise.resolve({ data: null, error: null });
  const [cycles, funding, released, receipts, payouts, events, farmers, farms, cycleFarms, todo] =
    await Promise.all([
      supabase.from('cycle_summaries').select('id, code, status, target_amount_kobo, hectares'),
      supabase.from('cycle_funding').select('cycle_id, raised_kobo'),
      supabase
        .from('disbursements')
        .select('cycle_id, amount_kobo, milestone_id')
        .eq('status', 'executed'),
      supabase.from('cycle_receipts').select('cycle_id, amount_kobo'),
      supabase
        .from('settlement_payouts')
        .select('cycle_id, amount_kobo, kind')
        .eq('status', 'executed'),
      supabase
        .from('cycle_events')
        .select('id, cycle_id, message, created_at, cycles(code)')
        .order('created_at', { ascending: false })
        .limit(8),
      registry
        ? supabase.from('farmers').select('*', { count: 'exact', head: true })
        : Promise.resolve({ count: null, error: null }),
      registry ? supabase.from('farm_maps').select('*') : skip,
      registry ? supabase.from('cycle_farms').select('cycle_id, farm_id') : skip,
      loadTodo(role),
    ]);
  if (farmers.error) throw farmers.error;

  const cycleRows = must(cycles) as {
    id: string;
    code: string;
    status: CycleStatus;
    target_amount_kobo: string;
    hectares: number;
  }[];
  const raisedBy = new Map(
    (must(funding) as { cycle_id: string; raised_kobo: string }[]).map((f) => [
      f.cycle_id,
      toKobo(f.raised_kobo),
    ]),
  );
  const releasedRows = must(released) as (Amount & { milestone_id: string })[];
  const payoutRows = must(payouts) as (Amount & { kind: string })[];
  const raised = [...raisedBy.values()].reduce((s, v) => s + v, 0n);

  // What funders got back on settled cycles, against what they put in.
  const settledIds = new Set(cycleRows.filter((c) => c.status === 'settled').map((c) => c.id));
  const funderPayouts = payoutRows.filter((p) => p.kind === 'funder');
  const returned = total(funderPayouts);
  const settledIn = [...settledIds].reduce((s, id) => s + (raisedBy.get(id) ?? 0n), 0n);
  const settledOut = total(funderPayouts.filter((p) => settledIds.has(p.cycle_id)));

  // Farms in a cycle that holds them, for the map.
  const live = new Set(cycleRows.filter((c) => LIVE.includes(c.status)).map((c) => c.id));
  const liveFarms = new Set(
    ((must(cycleFarms) ?? []) as { cycle_id: string; farm_id: string }[])
      .filter((cf) => live.has(cf.cycle_id))
      .map((cf) => cf.farm_id),
  );
  const farmRows = (must(farms) ?? null) as Farm[] | null;

  return {
    raised,
    // Money the trustee holds now: in from funders and buyers, less everything paid out.
    held: raised + total(must(receipts) as Amount[]) - total(releasedRows) - total(payoutRows),
    released: total(releasedRows),
    milestonesReleased: new Set(releasedRows.map((r) => r.milestone_id)).size,
    returned,
    settledCount: settledIds.size,
    settledResult:
      settledIn > 0n ? Number(((settledOut - settledIn) * 10000n) / settledIn) / 100 : null,
    farmerSurplus: total(payoutRows.filter((p) => p.kind === 'farmer')),
    farmers: farmers.count,
    farms: farmRows,
    liveFarms,
    hectares: farmRows?.reduce((s, f) => s + Number(f.area_hectares), 0) ?? 0,
    pipeline: STAGES.map((stage) => {
      const rows = cycleRows.filter((c) => stage.statuses.includes(c.status));
      return {
        ...stage,
        count: rows.length,
        value: rows.reduce((s, c) => s + toKobo(c.target_amount_kobo), 0n),
      };
    }),
    events: must(events) as unknown as {
      id: string;
      cycle_id: string;
      message: string;
      created_at: string;
      cycles: { code: string } | null;
    }[],
    todo,
  };
}

const STAGES: { label: string; statuses: CycleStatus[]; filter: string }[] = [
  { label: 'Being built', statuses: ['draft', 'pending_approval'], filter: 'building' },
  { label: 'Raising funds', statuses: ['open_for_funding'], filter: 'funding' },
  { label: 'Funded', statuses: ['funded'], filter: 'active' },
  { label: 'In season', statuses: ['in_progress'], filter: 'active' },
  { label: 'Harvested', statuses: ['harvested'], filter: 'active' },
  { label: 'Settled', statuses: ['settled'], filter: 'closed' },
];

interface Todo {
  icon: LucideIcon;
  label: string;
  count: number;
  to: string;
}

/**
 * What's waiting for this role. When everything waiting is in one cycle, the item opens
 * that cycle at the right tab; otherwise it opens the list.
 */
async function loadTodo(role: Role | undefined): Promise<Todo[]> {
  const items: Promise<Todo>[] = [];

  /** `rows` are cycle ids (one per waiting item). */
  const add = (
    icon: LucideIcon,
    label: string,
    rows: PromiseLike<{ data: { cycle_id: string }[] | null; error: unknown }>,
    tab: string,
    fallback: string,
  ) =>
    items.push(
      Promise.resolve(rows).then(({ data, error }) => {
        if (error) throw error;
        const ids = [...new Set((data ?? []).map((r) => r.cycle_id))];
        const to =
          ids.length === 1
            ? `/cycles/${ids[0]}${tab === 'overview' ? '' : `?tab=${tab}`}`
            : fallback;
        return { icon, label, count: data?.length ?? 0, to };
      }),
    );
  const cyclesIn = (status: CycleStatus) =>
    supabase.from('cycles').select('cycle_id:id').eq('status', status);

  if (can.reviewCycles(role)) {
    add(
      ShieldCheck,
      'Cycles awaiting your approval',
      cyclesIn('pending_approval'),
      'overview',
      '/cycles?stage=building',
    );
  }
  if (can.reviewKyc(role)) {
    items.push(
      Promise.resolve(
        supabase
          .from('farmers')
          .select('*', { count: 'exact', head: true })
          .eq('kyc_status', 'pending'),
      ).then(({ count, error }) => {
        if (error) throw error;
        return {
          icon: UserCheck,
          label: 'Farmers awaiting KYC review',
          count: count ?? 0,
          to: '/farmers?kyc=pending',
        };
      }),
    );
  }
  if (can.actAsTrustee(role)) {
    add(
      Landmark,
      'Payments to confirm',
      supabase.from('disbursements').select('cycle_id').eq('status', 'instructed'),
      'milestones',
      '/cycles?stage=active',
    );
    add(
      Scale,
      'Harvested cycles to settle',
      supabase
        .from('cycles')
        .select('cycle_id:id')
        .eq('status', 'harvested')
        .is('settlement_started_at', null),
      'settlement',
      '/cycles?stage=active',
    );
    add(
      Banknote,
      'Settlement payouts to make',
      supabase.from('settlement_payouts').select('cycle_id').eq('status', 'instructed'),
      'settlement',
      '/cycles?stage=active',
    );
    add(
      Store,
      'Agro-dealer redemptions to pay',
      supabase
        .from('voucher_redemptions')
        .select('cycle_id')
        .is('paid_at', null)
        .is('voided_at', null),
      'vouchers',
      '/cycles?stage=active',
    );
    add(
      ShieldAlert,
      'Insurance claims to receive',
      supabase.from('insurance_claims').select('cycle_id').eq('status', 'assessed'),
      'contracts',
      '/cycles?stage=active',
    );
    add(
      Coins,
      'Cycles raising funds',
      cyclesIn('open_for_funding'),
      'funding',
      '/cycles?stage=funding',
    );
  }
  if (can.manageCycles(role)) {
    add(Wheat, 'Draft cycles', cyclesIn('draft'), 'overview', '/cycles?stage=building');
    add(
      Landmark,
      'Milestones verified, ready to release',
      supabase.from('milestones').select('cycle_id').eq('status', 'verified'),
      'milestones',
      '/cycles?stage=active',
    );
    add(
      ShieldAlert,
      'Insurance claims to take forward',
      supabase.from('insurance_claims').select('cycle_id').in('status', ['reported', 'notified']),
      'contracts',
      '/cycles?stage=active',
    );
    add(
      Lock,
      'Milestones blocked by a failed visit',
      supabase.from('milestones').select('cycle_id').eq('status', 'blocked'),
      'milestones',
      '/cycles?stage=active',
    );
  }
  if (can.doFieldVisits(role)) {
    add(
      ClipboardCheck,
      'Milestones waiting for field visits',
      supabase
        .from('milestones')
        .select('cycle_id')
        .in('status', ['awaiting_verification', 'blocked']),
      'milestones',
      '/field',
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
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {!d ? (
              [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
            ) : (
              <>
                <Stat
                  icon={<Coins />}
                  label="Capital raised"
                  value={formatNaira(d.raised, { compact: true })}
                  sub={`${formatNaira(d.held, { compact: true })} held by the trustee now`}
                />
                <Stat
                  icon={<Sprout />}
                  tone="violet"
                  label="Released to farms"
                  value={formatNaira(d.released, { compact: true })}
                  sub={`${d.milestonesReleased} milestones, each after field visits`}
                />
                <Stat
                  icon={<HandCoins />}
                  tone="blue"
                  label="Paid back to funders"
                  value={formatNaira(d.returned, { compact: true })}
                  sub={
                    d.settledResult === null
                      ? 'No cycle settled yet'
                      : `${d.settledResult >= 0 ? '+' : '−'}${Math.abs(d.settledResult).toFixed(1)}% across ${d.settledCount} settled cycle${d.settledCount === 1 ? '' : 's'}`
                  }
                />
                {d.farmers !== null ? (
                  <Stat
                    icon={<UsersRound />}
                    tone="amber"
                    label="Farmers enrolled"
                    value={d.farmers.toLocaleString()}
                    sub={`${formatHectares(d.hectares)} mapped · ${formatNaira(d.farmerSurplus, { compact: true })} surplus paid`}
                  />
                ) : (
                  <Stat
                    icon={<UsersRound />}
                    tone="amber"
                    label="Surplus paid to farmers"
                    value={formatNaira(d.farmerSurplus, { compact: true })}
                    sub="After funders were repaid"
                  />
                )}
              </>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <SectionTitle
                  title="Pipeline"
                  description="Every cycle by stage, with the capital it targets."
                  actions={
                    <Link
                      to="/cycles"
                      className="text-sm font-medium text-brand-700 hover:text-brand-800"
                    >
                      All cycles →
                    </Link>
                  }
                />
                {!d ? (
                  <Skeleton className="h-20" />
                ) : (
                  <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                    {d.pipeline.map((s) => (
                      <li key={s.label}>
                        <Link
                          to={`/cycles?stage=${s.filter}`}
                          className="group block h-full rounded-xl bg-zinc-50 px-3 py-3 ring-1 ring-zinc-950/5 transition hover:bg-brand-50 hover:ring-brand-600/20"
                        >
                          <p className="flex items-center justify-between gap-1 text-xs font-medium text-zinc-500">
                            {s.label}
                            <ArrowRight
                              className="size-3.5 shrink-0 text-brand-600 transition group-hover:translate-x-0.5"
                              aria-hidden
                            />
                          </p>
                          <p className="mt-1 text-2xl font-semibold text-zinc-950 tabular-nums">
                            {s.count}
                          </p>
                          <p className="text-xs text-zinc-500 tabular-nums">
                            {s.count ? formatNaira(s.value, { compact: true }) : '—'}
                          </p>
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>

              {d?.farms && (
                <Card>
                  <SectionTitle
                    title="Mapped farms"
                    description={
                      <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span>{d.farms.length} farms, every boundary checked for overlaps.</span>
                        <span className="flex items-center gap-1.5">
                          <span className="size-2.5 rounded-sm border-2 border-[#16a34a]" />
                          In a live cycle
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="size-2.5 rounded-sm border-2 border-[#52525b]" />
                          Not in a live cycle
                        </span>
                      </span>
                    }
                  />
                  {d.farms.length === 0 ? (
                    <p className="text-sm text-zinc-500">
                      No farms mapped yet. Field agents map them from a farmer's page.
                    </p>
                  ) : (
                    <Suspense fallback={<Skeleton className="h-80 rounded-2xl" />}>
                      <FarmMap
                        farms={d.farms}
                        highlightIds={d.liveFarms}
                        className="h-80 w-full rounded-2xl ring-1 ring-zinc-950/5"
                      />
                    </Suspense>
                  )}
                </Card>
              )}
            </div>

            <div className="space-y-6">
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
                          className="group flex items-center gap-3 rounded-xl px-2 py-3 transition hover:bg-zinc-50"
                        >
                          <span
                            className={`grid size-8 shrink-0 place-items-center rounded-lg ${n > 0 ? 'bg-brand-50 text-brand-700' : 'bg-zinc-100 text-zinc-400'}`}
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
                            className="size-4 text-brand-600 transition group-hover:translate-x-0.5 group-hover:text-brand-800"
                            aria-hidden
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {can.readCycles(role) && <WeatherWatch />}

              <Card>
                <SectionTitle title="Recent activity" />
                {!d ? (
                  <Skeleton className="h-40" />
                ) : d.events.length === 0 ? (
                  <p className="text-sm text-zinc-500">Nothing has happened yet.</p>
                ) : (
                  <ol className="space-y-4">
                    {d.events.map((e) => (
                      <li key={e.id} className="flex gap-3 text-sm">
                        <span
                          className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500"
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <p className="text-zinc-800">{e.message}</p>
                          <p className="mt-0.5 text-xs text-zinc-500">
                            <Link
                              to={`/cycles/${e.cycle_id}?tab=history`}
                              className="link font-mono"
                            >
                              {e.cycles?.code}
                            </Link>{' '}
                            · {timeAgo(e.created_at)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString('en-NG', { dateStyle: 'medium' });
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
