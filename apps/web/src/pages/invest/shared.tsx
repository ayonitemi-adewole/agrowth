import { CalendarClock, MapPin, ShieldCheck, Wheat } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useToast } from '../../components/Toast';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardCta,
  Modal,
  Progress,
  cx,
} from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatHectares, titleCase } from '../../lib/format';
import {
  durationMonths,
  formatReturn,
  PLEDGE_STATUS,
  projections,
  riskScore,
  subscribed,
} from '../../lib/investing';
import { formatNaira } from '../../lib/money';
import { supabase } from '../../lib/supabase';
import type { Listing, MyPledge } from '../../lib/types';

export function RiskBadge({ listing }: { listing: Listing }) {
  const r = riskScore(listing);
  return (
    <Badge tone={r.tone} dot>
      {r.label} risk · {r.score}/5
    </Badge>
  );
}

export function PledgeStatusBadge({
  pledge,
}: {
  pledge: Pick<MyPledge, 'status' | 'refunded'>;
}) {
  const s = PLEDGE_STATUS[pledge.refunded ? 'refunded' : pledge.status];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

/** Low / expected / high return for funders, from the cycle's own assumptions. */
export function ReturnRange({
  listing,
  large = false,
}: {
  listing: Listing;
  large?: boolean;
}) {
  const labels = { low: 'Low', expected: 'Expected', high: 'High' };
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      {projections(listing).map((p) => (
        <div
          key={p.scenario}
          className={cx(
            'rounded-xl px-2 py-2.5',
            p.scenario === 'expected'
              ? 'bg-brand-50 ring-1 ring-brand-600/15'
              : 'bg-zinc-50'
          )}
        >
          <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
            {labels[p.scenario]}
          </p>
          <p
            className={cx(
              'mt-0.5 font-semibold tabular-nums',
              large ? 'text-xl' : 'text-base',
              p.returnPct < 0 ? 'text-red-700' : 'text-zinc-950'
            )}
          >
            {formatReturn(p.returnPct)}
          </p>
        </div>
      ))}
    </div>
  );
}

export function ListingCard({ listing, to }: { listing: Listing; to: string }) {
  const months = durationMonths(listing);
  const taken = subscribed(listing);
  return (
    <Link to={to} className="group block focus-visible:outline-none">
      <Card className="h-full transition group-hover:shadow-pop group-focus-visible:ring-2 group-focus-visible:ring-brand-600">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-zinc-500">{listing.code}</p>
            <h3 className="mt-1 text-lg font-semibold text-zinc-950">
              {titleCase(listing.crop)} · {listing.season}
            </h3>
          </div>
          <RiskBadge listing={listing} />
        </div>
        <ul className="mt-3 space-y-1.5 text-sm text-zinc-600">
          {listing.cooperative && (
            <li className="flex items-center gap-2">
              <MapPin className="size-4 text-zinc-400" aria-hidden />
              {listing.cooperative.lga}, {listing.cooperative.state}
            </li>
          )}
          <li className="flex items-center gap-2">
            <Wheat className="size-4 text-zinc-400" aria-hidden />
            {listing.farm_count} farms · {formatHectares(listing.hectares)}
            {listing.offtakers.length > 0 &&
              ` · sold to ${listing.offtakers.join(', ')}`}
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-zinc-400" aria-hidden />
            Insured
            {listing.insurers.length
              ? ` by ${listing.insurers.join(', ')}`
              : ''}
          </li>
          <li className="flex items-center gap-2">
            <CalendarClock className="size-4 text-zinc-400" aria-hidden />
            {months ? `About ${months} months` : 'Season dates to follow'}
            {listing.status === 'open_for_funding' &&
              ` · closes ${formatDate(listing.funding_deadline)}`}
          </li>
        </ul>
        <div className="mt-5">
          <p className="mb-2 text-xs font-medium text-zinc-500">
            Projected return to funders
          </p>
          <ReturnRange listing={listing} />
        </div>
        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-xs text-zinc-500">
            <span>
              <span className="font-medium text-zinc-900">
                {Math.round(taken * 100)}%
              </span>{' '}
              subscribed
            </span>
            <span>
              {formatNaira(listing.target_kobo, { compact: true })} target
            </span>
          </div>
          <Progress value={taken} />
        </div>
        <CardCta>View opportunity</CardCta>
      </Card>
    </Link>
  );
}

/** How to pay a pledge into the trustee's escrow account. */
export function PaymentInstructions({
  escrow,
  pledge,
}: {
  escrow: { bank_name: string; account_name: string; account_number: string };
  pledge: {
    reference: string;
    amount_kobo: string;
    pay_by: string;
    cooling_off_ends_at: string;
  };
}) {
  const rows: [string, string, boolean?][] = [
    ['Amount', formatNaira(pledge.amount_kobo)],
    ['Bank', escrow.bank_name],
    ['Account name', escrow.account_name],
    ['Account number', escrow.account_number, true],
    ['Reference', pledge.reference, true],
    ['Pay by', formatDate(pledge.pay_by)],
  ];
  return (
    <div className="space-y-3">
      <dl className="divide-y divide-zinc-950/5 rounded-xl bg-zinc-50 px-4 text-sm ring-1 ring-zinc-950/5">
        {rows.map(([label, value, mono]) => (
          <div key={label} className="flex justify-between gap-4 py-2.5">
            <dt className="text-zinc-500">{label}</dt>
            <dd
              className={cx(
                'text-right font-medium text-zinc-950',
                mono && 'font-mono'
              )}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs bg-amber-50 text-amber-800 ring-amber-600/20 ring-1 ring-inset rounded-xl p-3 flex flex-col gap-0.5">
        <span>- Pay the trustee's escrow account, never a person.</span>
        <span>
          - Quote the reference so the trustee can match your payment.
        </span>
        - Your money is added to the cycle after your cooling-off period ends (
        {new Date(pledge.cooling_off_ends_at).toLocaleString('en-NG', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}
        );
        <span>- Until the trustee confirms it, you can withdraw.</span>
      </p>
    </div>
  );
}

/** The investor withdraws a pledge the trustee hasn't confirmed payment for. */
export function WithdrawButton({
  pledge,
  onDone,
}: {
  pledge: MyPledge;
  onDone: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withdraw = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('withdraw_pledge', {
      p_pledge_id: pledge.id,
    });
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    toast.success('Pledge withdrawn');
    setOpen(false);
    onDone();
  };

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Withdraw
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Withdraw your ${formatNaira(pledge.amount_kobo)} pledge?`}
        description="Your share of the cycle is released for other investors. If you have already paid, the trustee returns the money to you; it was never added to the cycle."
      >
        {error && (
          <div className="mb-4">
            <Alert>{error}</Alert>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button variant="danger" busy={busy} onClick={withdraw}>
            Withdraw pledge
          </Button>
        </div>
      </Modal>
    </>
  );
}
