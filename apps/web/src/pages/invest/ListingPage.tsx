import { ArrowLeft, Camera, CheckCircle2, CircleAlert, CircleDashed, Info } from 'lucide-react';
import { lazy, Suspense, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { CycleStatusBadge, MilestoneStatusBadge } from '../../components/StatusBadges';
import { useToast } from '../../components/Toast';
import {
  Alert,
  Badge,
  Button,
  Card,
  DescriptionList,
  Field,
  Input,
  Modal,
  PageHeader,
  Progress,
  SectionTitle,
  Skeleton,
  Spinner,
  Table,
  cx,
} from '../../components/ui';
import { formatBps, formatTonnes, signedUrls } from '../../lib/cycles';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatHectares, titleCase } from '../../lib/format';
import {
  durationMonths,
  formatReturn,
  openKobo,
  projections,
  riskScore,
} from '../../lib/investing';
import { formatNaira, nairaInput, parseNaira, ratio, toKobo } from '../../lib/money';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type {
  FarmMap as FarmRow,
  InvestmentCap,
  InvestorProfile,
  InvestorSettings,
  ListingDetail,
  MyPledge,
  PledgeReceipt,
} from '../../lib/types';
import { useAsync } from '../../lib/useAsync';
import { loadInvestorSettings, loadMyInvestorProfile } from './data';
import { PaymentInstructions, PledgeStatusBadge, RiskBadge, WithdrawButton } from './shared';

const FarmMap = lazy(() =>
  import('../../components/FarmMap').then((m) => ({ default: m.FarmMap })),
);

const PRICE_TERMS = { fixed: 'Fixed price', floor: 'Minimum price', formula: 'Market formula' };
const COVER = {
  area_yield: 'Area-yield',
  weather_index: 'Weather-index',
  multi_peril: 'Multi-peril',
};

export function ListingPage() {
  const { id } = useParams<{ id: string }>();
  const role = useAuth().profile?.role;
  const investor = can.invest(role);

  const state = useAsync(async () => {
    const [listing, profile, settings, cap] = await Promise.all([
      supabase.rpc('investor_listing', { p_cycle_id: id! }),
      investor ? loadMyInvestorProfile() : Promise.resolve(null),
      loadInvestorSettings(),
      investor ? supabase.rpc('my_investment_cap') : Promise.resolve({ data: null, error: null }),
    ]);
    if (listing.error) throw listing.error;
    if (cap.error) throw cap.error;
    return {
      listing: listing.data as ListingDetail,
      profile,
      settings,
      cap: cap.data as InvestmentCap | null,
    };
  }, [id, investor]);

  if (state.loading && !state.data) return <Spinner />;
  if (state.error) {
    return (
      <div className="space-y-4">
        <BackLink investor={investor} />
        <Alert>{errorMessage(state.error)}</Alert>
      </div>
    );
  }
  const { listing: l, profile, settings, cap } = state.data!;
  const months = durationMonths(l);
  const underway = ['funded', 'in_progress', 'harvested', 'settled'].includes(l.status);
  const invested = l.my_pledges.some((p) => p.status === 'paid');

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <div className="flex flex-wrap items-center gap-3">
            <BackLink investor={investor} />
            <span className="font-mono text-xs">{l.code}</span>
          </div>
        }
        title={`${titleCase(l.crop)} · ${l.season}`}
        description={
          l.cooperative
            ? `${l.cooperative.name}, ${l.cooperative.lga}, ${l.cooperative.state}`
            : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CycleStatusBadge status={l.status} />
            <RiskBadge listing={l} />
            {investor && l.status === 'open_for_funding' && (
              <InvestButton
                listing={l}
                profile={profile}
                settings={settings}
                cap={cap}
                onDone={state.reload}
              />
            )}
          </div>
        }
      />

      {!investor && (
        <Alert tone="info">
          You are seeing this cycle as investors see it. Farmer names, account numbers and other
          funders are hidden from them.
        </Alert>
      )}

      {l.my_pledges.length > 0 && (
        <MyPledges pledges={l.my_pledges} settings={settings} onChange={state.reload} />
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {l.description && (
            <Card>
              <p className="text-sm leading-relaxed whitespace-pre-line text-zinc-700">
                {l.description}
              </p>
            </Card>
          )}

          <Card padded={false} className="overflow-hidden">
            <Suspense fallback={<Skeleton className="h-80" />}>
              <FarmMap
                farms={l.farms as unknown as FarmRow[]}
                highlightIds={new Set(l.farms.map((f) => f.id))}
                className="h-80 w-full"
              />
            </Suspense>
            <p className="px-5 py-3 text-xs text-zinc-500">
              {l.farm_count} farms, {formatHectares(l.hectares)}, each mapped by GPS and checked for
              overlaps with every other farm on the platform.
            </p>
          </Card>

          <Scenarios listing={l} />
          <Milestones listing={l} />
          {underway && <FieldChecks listing={l} showPhotos={invested || !investor} />}
          {underway && <Harvest listing={l} />}
          {l.events.length > 0 && <History listing={l} />}
        </div>

        <div className="space-y-6">
          <FundingCard listing={l} />
          <Card>
            <SectionTitle title="Terms" />
            <DescriptionList
              items={[
                ['Target', formatNaira(l.target_kobo)],
                ['Funding closes', formatDate(l.funding_deadline)],
                ['Season starts', formatDate(l.start_date)],
                ['Harvest expected', formatDate(l.expected_harvest_date)],
                ['Locked in for', months ? `About ${months} months` : '—'],
                ['Management fee', `${formatBps(l.management_fee_bps)} of capital`],
                ['Funders’ share of profit', formatBps(l.funder_profit_share_bps)],
              ]}
            />
            <p className="mt-4 text-xs text-zinc-500">
              At settlement the harvest proceeds pay the management fee first, then return funders'
              capital, then the profit is split between funders and farmers.
            </p>
          </Card>
          <Card>
            <SectionTitle title="Who buys the harvest" />
            {l.offtake.length === 0 ? (
              <p className="text-sm text-zinc-500">No signed agreement.</p>
            ) : (
              <div className="space-y-4">
                {l.offtake.map((o, i) => (
                  <DescriptionList
                    key={i}
                    items={[
                      ['Buyer', o.buyer_name],
                      ['Volume', `${Number(o.volume_tonnes).toLocaleString('en-NG')} t`],
                      ['Price', PRICE_TERMS[o.price_terms]],
                      ...(o.price_kobo || o.floor_kobo
                        ? [
                            [
                              o.price_terms === 'fixed' ? 'Per tonne' : 'At least, per tonne',
                              formatNaira(o.price_kobo ?? o.floor_kobo),
                            ] as [string, string],
                          ]
                        : []),
                      ['Signed', formatDate(o.signed_on)],
                    ]}
                  />
                ))}
              </div>
            )}
          </Card>
          <Card>
            <SectionTitle title="Insurance" />
            {l.insurance.map((p, i) => (
              <DescriptionList
                key={i}
                items={[
                  ['Insurer', p.insurer_name],
                  ['Cover', COVER[p.cover_type]],
                  ['Sum insured', formatNaira(p.sum_insured_kobo)],
                  ['Pays', p.loss_payee],
                  ['Covered', `${formatDate(p.cover_start)} – ${formatDate(p.cover_end)}`],
                ]}
              />
            ))}
          </Card>
          <RiskFactors listing={l} />
        </div>
      </div>
    </div>
  );
}

function BackLink({ investor }: { investor: boolean }) {
  return (
    <Link
      to={investor ? '/invest' : '/cycles'}
      className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
    >
      <ArrowLeft className="size-4" aria-hidden /> {investor ? 'Marketplace' : 'Cycles'}
    </Link>
  );
}

function FundingCard({ listing: l }: { listing: ListingDetail }) {
  const open = openKobo(l);
  return (
    <Card>
      <p className="text-sm text-zinc-500">Raised, held by the trustee</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950 tabular-nums">
        {formatNaira(l.raised_kobo)}
      </p>
      <p className="mt-1 text-sm text-zinc-500">
        of {formatNaira(l.target_kobo)} from {l.funders} funder{l.funders === 1 ? '' : 's'}
      </p>
      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-zinc-100">
        <div className="flex h-full">
          <div
            className="h-full bg-brand-600"
            style={{ width: `${ratio(l.raised_kobo, l.target_kobo) * 100}%` }}
          />
          <div
            className="h-full bg-brand-300"
            style={{ width: `${ratio(l.reserved_kobo, l.target_kobo) * 100}%` }}
          />
        </div>
      </div>
      {l.status === 'open_for_funding' && (
        <p className="mt-3 text-xs text-zinc-500">
          {toKobo(l.reserved_kobo) > 0n &&
            `${formatNaira(l.reserved_kobo)} pledged and awaiting payment. `}
          {open > 0n ? `${formatNaira(open)} still open.` : 'Fully subscribed.'} If the cycle
          doesn't fill by {formatDate(l.funding_deadline)}, everyone is refunded in full.
        </p>
      )}
    </Card>
  );
}

function Scenarios({ listing: l }: { listing: ListingDetail }) {
  const rows = projections(l);
  const yields = [l.yield_low, l.yield_expected, l.yield_high];
  const prices = [l.price_low_kobo, l.price_expected_kobo, l.price_high_kobo];
  return (
    <div>
      <SectionTitle
        title="What funders could get back"
        description="From the cycle's own yield and price assumptions, before any insurance claim. Estimates, not promises."
      />
      <Table head={['Scenario', 'Yield', 'Price / t', 'Harvest sales', 'To funders', 'Return']}>
        {rows.map((p, i) => (
          <tr key={p.scenario} className={p.scenario === 'expected' ? 'bg-brand-50/40' : ''}>
            <td className="font-medium text-zinc-900">{titleCase(p.scenario)}</td>
            <td className="text-zinc-600 tabular-nums">{Number(yields[i])} t/ha</td>
            <td className="text-zinc-600 tabular-nums">{formatNaira(prices[i])}</td>
            <td className="text-zinc-600 tabular-nums">
              {formatNaira(Math.round(p.revenue * 100), { compact: true })}
            </td>
            <td className="text-zinc-600 tabular-nums">
              {formatNaira(Math.round(p.toFunders * 100), { compact: true })}
            </td>
            <td
              className={cx(
                'font-semibold tabular-nums',
                p.returnPct < 0 ? 'text-red-700' : 'text-zinc-900',
              )}
            >
              {formatReturn(p.returnPct)}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function RiskFactors({ listing }: { listing: ListingDetail }) {
  const r = riskScore(listing);
  return (
    <Card>
      <SectionTitle
        title={`${r.label} risk · ${r.score} of 5`}
        description="A guide for comparing cycles. Any cycle can lose money."
      />
      <ul className="space-y-3 text-sm">
        {r.factors.map((f, i) => (
          <li key={i} className="flex gap-2.5">
            {f.good ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            )}
            <span className="text-zinc-700">{f.text}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const PAYEE_LABEL: Record<string, string> = {
  input_vendor: 'inputs from vendors',
  input_voucher: 'farmers’ input vouchers',
  service_provider: 'services',
  farmer_cash: 'cash to farmers',
};

function Milestones({ listing: l }: { listing: ListingDetail }) {
  return (
    <div>
      <SectionTitle
        title="How the money is released"
        description="The trustee releases each stage only after a field agent has checked every farm, mostly as inputs paid straight to vendors."
      />
      <Card padded={false}>
        <ol className="divide-y divide-zinc-950/5">
          {l.milestones.map((m) => {
            const released = Object.entries(m.released);
            return (
              <li key={m.id} className="flex gap-4 px-5 py-4 sm:px-6">
                <span
                  className={cx(
                    'grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold',
                    m.status === 'released'
                      ? 'bg-brand-600 text-white'
                      : 'bg-zinc-100 text-zinc-600',
                  )}
                >
                  {m.sequence}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-zinc-900">{m.name}</p>
                    <MilestoneStatusBadge status={m.status} />
                  </div>
                  <p className="mt-0.5 text-sm text-zinc-500">
                    {formatNaira(m.amount_kobo)} · planned {formatDate(m.planned_date)}
                    {m.released_at && ` · released ${formatDate(m.released_at)}`}
                  </p>
                  {released.length > 0 && (
                    <p className="mt-1 text-xs text-zinc-500">
                      Paid:{' '}
                      {released
                        .map(([kind, amt]) => `${formatNaira(amt)} ${PAYEE_LABEL[kind] ?? kind}`)
                        .join(', ')}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}

const CONDITION = {
  good: { label: 'Good', tone: 'green' },
  fair: { label: 'Fair', tone: 'blue' },
  poor: { label: 'Poor', tone: 'amber' },
  failed: { label: 'Failed', tone: 'red' },
} as const;

function FieldChecks({ listing: l, showPhotos }: { listing: ListingDetail; showPhotos: boolean }) {
  const farmName = new Map(l.farms.map((f) => [f.id, f.name ?? 'Farm']));
  const milestone = new Map(l.milestones.map((m) => [m.id, m]));
  const photoPaths = showPhotos ? l.visits.flatMap((v) => v.photo_paths).slice(0, 8) : [];
  const photos = useAsync(() => signedUrls('field-photos', photoPaths), [photoPaths.join('|')]);

  return (
    <div>
      <SectionTitle
        title="Field checks"
        description="GPS check-ins inside each farm's boundary, a checklist and photos. A failed check holds the next release."
      />
      {l.visits.length === 0 ? (
        <Card>
          <p className="text-sm text-zinc-500">No field visits yet.</p>
        </Card>
      ) : (
        <Table head={['Visited', 'Farm', 'Stage', 'Crop', 'Result']}>
          {l.visits.slice(0, 12).map((v, i) => (
            <tr key={i}>
              <td className="text-zinc-600">{formatDate(v.visited_at)}</td>
              <td className="text-zinc-900">{farmName.get(v.farm_id)}</td>
              <td className="text-zinc-600">{milestone.get(v.milestone_id)?.name}</td>
              <td>
                <Badge tone={CONDITION[v.crop_condition].tone}>
                  {CONDITION[v.crop_condition].label}
                </Badge>
              </td>
              <td>
                {v.passed ? (
                  <Badge tone="green" dot>
                    Passed
                  </Badge>
                ) : (
                  <Badge tone="red" dot>
                    {v.gps_ok ? 'Failed' : 'Failed: not on the farm'}
                  </Badge>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {photos.data && photos.data.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {photos.data.map((url, i) =>
            url ? (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                <img
                  src={url}
                  alt="Field visit photo"
                  className="aspect-square w-full rounded-xl object-cover ring-1 ring-zinc-950/5"
                  loading="lazy"
                />
              </a>
            ) : null,
          )}
        </div>
      )}
      {!showPhotos && l.visits.some((v) => v.photo_paths.length > 0) && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500">
          <Camera className="size-3.5" aria-hidden /> Field photos are shared with this cycle's
          funders.
        </p>
      )}
    </div>
  );
}

function Harvest({ listing: l }: { listing: ListingDetail }) {
  const expectedKg = Number(l.hectares) * Number(l.yield_expected) * 1000;
  return (
    <Card>
      <SectionTitle title="Harvest" description="Weighed and graded on delivery to the offtaker." />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-2xl font-semibold text-zinc-950 tabular-nums">
          {formatTonnes(l.harvest.accepted_kg)}
        </p>
        <p className="text-sm text-zinc-500">
          accepted of about {formatTonnes(expectedKg)} expected · {l.harvest.deliveries} deliveries
        </p>
      </div>
      <Progress value={expectedKg ? l.harvest.accepted_kg / expectedKg : 0} className="mt-3" />
      {l.harvest.rejected_kg > 0 && (
        <p className="mt-2 text-xs text-zinc-500">
          {formatTonnes(l.harvest.rejected_kg)} rejected on quality.
        </p>
      )}
    </Card>
  );
}

function History({ listing: l }: { listing: ListingDetail }) {
  return (
    <div>
      <SectionTitle title="Cycle history" />
      <Card>
        <ol className="space-y-3">
          {l.events.slice(0, 15).map((e, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <CircleDashed className="mt-0.5 size-4 shrink-0 text-zinc-400" aria-hidden />
              <div>
                <p className="text-zinc-800">{e.message}</p>
                <p className="text-xs text-zinc-500">{formatDate(e.created_at)}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

// ---------- The investor's own pledges in this cycle ----------

function MyPledges({
  pledges,
  settings,
  onChange,
}: {
  pledges: MyPledge[];
  settings: InvestorSettings;
  onChange: () => void;
}) {
  return (
    <Card>
      <SectionTitle
        title="Your investment"
        actions={
          <Link to="/portfolio" className="text-sm font-medium text-brand-700 hover:underline">
            All investments
          </Link>
        }
      />
      <div className="divide-y divide-zinc-950/5">
        {pledges.map((p) => (
          <div key={p.id} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-zinc-950 tabular-nums">
                  {formatNaira(p.amount_kobo)}
                </p>
                <p className="text-xs text-zinc-500">
                  <span className="font-mono">{p.reference}</span> · pledged{' '}
                  {formatDate(p.pledged_at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <PledgeStatusBadge pledge={p} />
                {p.status === 'pending' && <WithdrawButton pledge={p} onDone={onChange} />}
                {p.status === 'paid' && !p.refunded && (
                  <Link to={`/portfolio/${p.id}/certificate`}>
                    <Button size="sm" variant="secondary">
                      Certificate
                    </Button>
                  </Link>
                )}
              </div>
            </div>
            {p.status === 'pending' && (
              <div className="mt-4">
                <PaymentInstructions
                  pledge={p}
                  escrow={{
                    bank_name: settings.escrow_bank_name,
                    account_name: settings.escrow_account_name,
                    account_number: settings.escrow_account_number,
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------- Investing ----------

function InvestButton({
  listing,
  profile,
  settings,
  cap,
  onDone,
}: {
  listing: ListingDetail;
  profile: InvestorProfile | null;
  settings: InvestorSettings;
  cap: InvestmentCap | null;
  onDone: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<PledgeReceipt | null>(null);

  const open_ = openKobo(listing);
  const remaining = cap?.capped ? toKobo(cap.remaining_kobo) : null;
  const max = remaining !== null && remaining < open_ ? remaining : open_;
  const min = toKobo(settings.min_pledge_kobo) < open_ ? toKobo(settings.min_pledge_kobo) : open_;

  if (profile?.kyc_status !== 'verified') {
    return (
      <Link to="/profile">
        <Button variant="secondary">
          {profile ? 'KYC under review' : 'Complete KYC to invest'}
        </Button>
      </Link>
    );
  }
  if (open_ <= 0n) return <Badge tone="violet">Fully subscribed</Badge>;

  const close = () => {
    setOpen(false);
    if (receipt) {
      setReceipt(null);
      setAmount('');
      setAcknowledged(false);
      onDone();
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const kobo = parseNaira(amount);
    if (!kobo) {
      setError('Enter an amount in naira');
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc('pledge_investment', {
      p_cycle_id: listing.id,
      p_amount_kobo: kobo.toString(),
      p_disclosure_version: settings.disclosure_version,
    });
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    setReceipt(data as PledgeReceipt);
    toast.success('Pledge made. Now pay the trustee.');
  };

  const kobo = parseNaira(amount);
  const pct = kobo ? Number((kobo * 10_000n) / toKobo(listing.target_kobo)) / 100 : 0;

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={max < min}>
        Invest
      </Button>
      <Modal
        open={open}
        onClose={close}
        wide
        title={receipt ? 'Pay the trustee' : `Invest in ${listing.code}`}
        description={
          receipt
            ? 'Your share is reserved. Transfer the amount below to the trustee’s escrow account.'
            : undefined
        }
      >
        {receipt ? (
          <div className="space-y-5">
            <PaymentInstructions
              pledge={receipt}
              escrow={{
                bank_name: receipt.escrow_bank_name,
                account_name: receipt.escrow_account_name,
                account_number: receipt.escrow_account_number,
              }}
            />
            <div className="flex justify-end">
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div>
              <p className="mb-2 text-sm font-medium text-zinc-800">
                Risk disclosure{' '}
                <span className="font-normal text-zinc-500">
                  (version {settings.disclosure_version})
                </span>
              </p>
              <div className="max-h-56 overflow-y-auto rounded-xl bg-zinc-50 px-4 py-3 text-sm leading-relaxed whitespace-pre-line text-zinc-700 ring-1 ring-zinc-950/5">
                {settings.risk_disclosure}
              </div>
              <label className="mt-3 flex items-start gap-2.5 text-sm text-zinc-800">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 size-4 rounded border-zinc-300 text-brand-600"
                />
                I have read and understood the risks. I can afford to lose this money.
              </label>
            </div>
            <Field
              label="Amount (₦)"
              hint={
                <>
                  Between {formatNaira(min)} and {formatNaira(max)}
                  {remaining !== null && ` (your 12-month limit leaves ${formatNaira(remaining)})`}
                  {kobo ? ` · ${pct.toLocaleString('en-NG')}% of the cycle` : ''}
                </>
              }
            >
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder={nairaInput(min)}
                required
              />
            </Field>
            <Alert tone="info">
              <span className="flex gap-2">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                You have a {settings.cooling_off_hours}-hour cooling-off period, and can withdraw at
                any time until the trustee confirms your payment. Pay within{' '}
                {settings.payment_window_days} days or the pledge lapses.
              </span>
            </Alert>
            {error && <Alert>{error}</Alert>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" busy={busy} disabled={!acknowledged}>
                Pledge {kobo ? formatNaira(kobo) : ''}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
