import { BriefcaseBusiness, Coins, Gauge, TrendingUp, Wallet } from 'lucide-react';
import { Link } from 'react-router';
import { CycleStatusBadge } from '../../components/StatusBadges';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Progress,
  SectionTitle,
  Spinner,
  Stat,
} from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatDate, titleCase } from '../../lib/format';
import { INVESTOR_CLASS, statement } from '../../lib/investing';
import { formatNaira, ratio, toKobo } from '../../lib/money';
import { supabase } from '../../lib/supabase';
import type { MyInvestments } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';
import { PaymentInstructions, PledgeStatusBadge, WithdrawButton } from './shared';

type Position = MyInvestments['pledges'][number];

export function PortfolioPage() {
  const state = useAsync(async () => {
    const { data, error } = await supabase.rpc('my_investments');
    if (error) throw error;
    return data as MyInvestments;
  }, []);

  if (state.loading && !state.data) return <Spinner />;
  if (state.error) return <Alert>{errorMessage(state.error)}</Alert>;
  const { pledges, cap, escrow } = state.data!;

  const active = pledges.filter((p) => p.status === 'paid' && !p.refunded);
  const atWork = active
    .filter((p) => p.payouts.length === 0)
    .reduce((s, p) => s + toKobo(p.amount_kobo), 0n);
  const paidOut = (kind: 'capital' | 'return') =>
    active
      .flatMap((p) => p.payouts)
      .filter((x) => x.status === 'executed')
      .reduce(
        (s, x) =>
          s +
          (kind === 'capital'
            ? toKobo(x.capital_kobo)
            : toKobo(x.amount_kobo) - toKobo(x.capital_kobo)),
        0n,
      );
  const pending = pledges.filter((p) => p.status === 'pending');
  const others = pledges.filter((p) => p.status !== 'pending');

  return (
    <div className="space-y-8">
      <PageHeader
        title="My investments"
        description="Every naira you put in, where it is now, and what has come back."
        actions={
          <Link to="/invest">
            <Button>Browse cycles</Button>
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={<Wallet />}
          label="Invested, in the field"
          value={formatNaira(atWork, { compact: true })}
          sub={`${active.filter((p) => p.payouts.length === 0).length} active cycle(s)`}
        />
        <Stat
          icon={<Coins />}
          tone="blue"
          label="Capital returned"
          value={formatNaira(paidOut('capital'), { compact: true })}
        />
        <Stat
          icon={<TrendingUp />}
          tone="violet"
          label="Returns received"
          value={formatNaira(paidOut('return'), { compact: true })}
        />
        <CapStat cap={cap} />
      </div>

      {pending.length > 0 && (
        <div>
          <SectionTitle
            title="Waiting for your payment"
            description="Your share is reserved until the pay-by date."
          />
          <div className="grid gap-4 lg:grid-cols-2">
            {pending.map((p) => (
              <Card key={p.id}>
                <PositionHeader p={p} onChange={state.reload} />
                <div className="mt-4">
                  <PaymentInstructions pledge={p} escrow={escrow} />
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionTitle title="Positions and statements" />
        {others.length === 0 && pending.length === 0 ? (
          <EmptyState icon={<BriefcaseBusiness />} title="No investments yet">
            When you invest in a cycle it appears here, with a statement of every payment.
          </EmptyState>
        ) : others.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing paid in yet.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {others.map((p) => (
              <Card key={p.id}>
                <PositionHeader p={p} onChange={state.reload} />
                <Statement p={p} />
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CapStat({ cap }: { cap: MyInvestments['cap'] }) {
  if (!cap.kyc_status) {
    return (
      <Stat
        icon={<Gauge />}
        tone="amber"
        label="Investment limit"
        value="—"
        sub={
          <Link to="/profile" className="font-medium text-brand-700 hover:underline">
            Complete KYC to invest
          </Link>
        }
      />
    );
  }
  if (!cap.capped) {
    return (
      <Stat
        icon={<Gauge />}
        tone="amber"
        label="Investment limit"
        value="No limit"
        sub={
          cap.classification ? `${INVESTOR_CLASS[cap.classification]} investor` : 'KYC under review'
        }
      />
    );
  }
  const used = toKobo(cap.used_here_kobo) + toKobo(cap.used_elsewhere_kobo);
  return (
    <div className="flex h-full flex-col rounded-2xl bg-white p-5 shadow-card ring-1 ring-zinc-950/5">
      <span className="text-sm font-medium text-zinc-500">Left to invest this year</span>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-zinc-950 tabular-nums">
        {formatNaira(cap.remaining_kobo, { compact: true })}
      </p>
      <Progress value={ratio(used, cap.cap_kobo ?? 0)} className="mt-2" />
      <p className="mt-1.5 text-xs text-zinc-500">
        Retail limit {formatNaira(cap.cap_kobo, { compact: true })} in 12 months, including{' '}
        {formatNaira(cap.used_elsewhere_kobo, { compact: true })} declared elsewhere
      </p>
    </div>
  );
}

function PositionHeader({ p, onChange }: { p: Position; onChange: () => void }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Link
          to={`/invest/${p.cycle_id}`}
          className="font-semibold text-zinc-950 hover:text-brand-700"
        >
          {titleCase(p.cycle.crop)} · {p.cycle.season}
        </Link>
        <p className="mt-0.5 text-xs text-zinc-500">
          <span className="font-mono">{p.cycle.code}</span> · {formatNaira(p.amount_kobo)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PledgeStatusBadge pledge={p} />
        {p.status === 'paid' && <CycleStatusBadge status={p.cycle.status} />}
        {p.status === 'pending' && <WithdrawButton pledge={p} onDone={onChange} />}
      </div>
    </div>
  );
}

function Statement({ p }: { p: Position }) {
  const lines = statement(p);
  return (
    <div className="mt-4">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-zinc-950/5">
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="py-2 pr-3 whitespace-nowrap text-zinc-500">{formatDate(l.date)}</td>
              <td className="py-2 text-zinc-800">{l.text}</td>
              <td className="py-2 pl-3 text-right whitespace-nowrap tabular-nums">
                {l.amount !== undefined && (
                  <span className={l.amount < 0n ? 'text-zinc-700' : 'text-brand-700'}>
                    {l.amount > 0n ? '+' : ''}
                    {formatNaira(l.amount)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={`/invest/${p.cycle_id}`}>
          <Button size="sm" variant="secondary">
            Track the cycle
          </Button>
        </Link>
        {p.status === 'paid' && !p.refunded && (
          <Link to={`/portfolio/${p.id}/certificate`}>
            <Button size="sm" variant="ghost">
              Certificate
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}
