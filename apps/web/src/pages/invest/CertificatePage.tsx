import { Printer } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Logo } from '../../components/Layout';
import { Alert, Button, Spinner } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatHectares, titleCase } from '../../lib/format';
import { formatBps } from '../../lib/cycles';
import { formatNaira, ratio } from '../../lib/money';
import { supabase } from '../../lib/supabase';
import type { MyInvestments } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';
import { loadMyInvestorProfile } from './data';

/** A printable record of one paid investment. */
export function CertificatePage() {
  const { pledgeId } = useParams<{ pledgeId: string }>();
  const state = useAsync(async () => {
    const [mine, profile] = await Promise.all([
      supabase.rpc('my_investments'),
      loadMyInvestorProfile(),
    ]);
    if (mine.error) throw mine.error;
    const pledge = (mine.data as MyInvestments).pledges.find((p) => p.id === pledgeId);
    return { pledge, profile };
  }, [pledgeId]);

  if (state.loading) return <Spinner />;
  if (state.error) return <Alert>{errorMessage(state.error)}</Alert>;
  const { pledge: p, profile } = state.data!;
  if (!p || p.status !== 'paid' || p.refunded || !profile) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Alert>
          There is no certificate for this pledge: it hasn't been paid, or was refunded.
        </Alert>
        <Link to="/portfolio" className="link-back mt-4">
          ← My investments
        </Link>
      </div>
    );
  }
  const c = p.cycle;
  const share = ratio(p.amount_kobo, c.target_kobo);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 print:max-w-none print:p-0">
      <div className="mb-6 flex items-center justify-between gap-3 print:hidden">
        <Link to="/portfolio" className="link-back">
          ← My investments
        </Link>
        <Button onClick={() => window.print()}>
          <Printer aria-hidden /> Print or save as PDF
        </Button>
      </div>

      <article className="rounded-2xl border border-zinc-300 bg-white p-8 sm:p-12 print:rounded-none print:border-0">
        <div className="flex items-center justify-between">
          <Logo />
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Investment certificate
          </span>
        </div>

        <p className="mt-10 text-sm text-zinc-500">This certifies that</p>
        <p className="mt-1 text-2xl font-semibold text-zinc-950">{profile.legal_name}</p>
        <p className="mt-4 text-sm leading-relaxed text-zinc-700">
          has invested <span className="font-semibold">{formatNaira(p.amount_kobo)}</span> in
          funding cycle <span className="font-mono font-semibold">{c.code}</span>,{' '}
          {titleCase(c.crop)} {c.season}
          {c.cooperative &&
            `, farmed by ${c.cooperative.name} in ${c.cooperative.lga}, ${c.cooperative.state}`}
          . The money is held by the trustee and released in stages to the cycle's verified farms.
        </p>

        <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-4 text-sm sm:grid-cols-3">
          {(
            [
              ['Amount', formatNaira(p.amount_kobo)],
              [
                'Share of the cycle',
                `${(share * 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}%`,
              ],
              ['Paid on', formatDate(p.received_on)],
              ['Pledge reference', p.reference],
              ['Trustee reference', p.trustee_reference ?? '—'],
              ['Farms', `${c.farm_count} · ${formatHectares(c.hectares)}`],
              ['Harvest expected', formatDate(c.expected_harvest_date)],
              ['Funders’ profit share', formatBps(c.funder_profit_share_bps)],
              ['Management fee', `${formatBps(c.management_fee_bps)} of capital`],
            ] as [string, string][]
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-zinc-500">{label}</dt>
              <dd className="mt-0.5 font-medium text-zinc-950">{value}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-10 border-t border-zinc-200 pt-4 text-xs leading-relaxed text-zinc-500">
          Returns are not guaranteed. At settlement the harvest proceeds pay the management fee,
          then return funders' capital, then split the profit. Funders bear any loss in proportion
          to their share. Risk disclosure version {p.disclosure_version} acknowledged on{' '}
          {formatDate(p.disclosure_acknowledged_at)}.
        </p>
      </article>
    </div>
  );
}
