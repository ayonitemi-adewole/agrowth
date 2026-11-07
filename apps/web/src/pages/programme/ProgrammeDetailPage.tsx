import { ArrowLeft, Coins, Download, Gauge, Sprout, Truck, UsersRound, Wheat } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { CycleStatusBadge } from '../../components/StatusBadges';
import { useToast } from '../../components/Toast';
import {
  Alert,
  Badge,
  Button,
  Card,
  DescriptionList,
  EmptyState,
  Modal,
  PageHeader,
  Progress,
  SectionTitle,
  Spinner,
  Stat,
  Table,
  Tabs,
  cx,
} from '../../components/ui';
import { formatTonnes } from '../../lib/cycles';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatHectares, titleCase } from '../../lib/format';
import { formatNaira, ratio } from '../../lib/money';
import {
  csvNaira,
  download,
  formatPct,
  PROGRAMME_KIND,
  PROGRAMME_STATUS,
  REPAYMENT_MODE,
  repaymentRate,
  toCsv,
  yieldPerHa,
} from '../../lib/programmes';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { ProgrammeBeneficiary, ProgrammeDashboard, ProgrammeFigures } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';
import { ProgrammeForm } from './ProgrammeForm';

type Dim = 'by_state' | 'by_lga' | 'by_ward' | 'by_commodity' | 'by_cooperative';
const DIMS: { id: Dim; label: string; column: string }[] = [
  { id: 'by_state', label: 'State', column: 'State' },
  { id: 'by_lga', label: 'LGA', column: 'State · LGA' },
  { id: 'by_ward', label: 'Ward', column: 'LGA · ward' },
  { id: 'by_commodity', label: 'Commodity', column: 'Commodity' },
  { id: 'by_cooperative', label: 'Cooperative', column: 'Cooperative' },
];

export function ProgrammeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const role = useAuth().profile?.role;
  const [dim, setDim] = useState<Dim>('by_lga');
  const [editing, setEditing] = useState(false);
  const state = useAsync(async () => {
    const { data, error } = await supabase.rpc('programme_dashboard', { p_programme_id: id! });
    if (error) throw error;
    return data as ProgrammeDashboard;
  }, [id]);

  if (state.loading && !state.data) return <Spinner />;
  if (state.error) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Alert>{errorMessage(state.error)}</Alert>
      </div>
    );
  }
  const d = state.data!;
  const p = d.programme;
  const t = d.totals;
  const status = PROGRAMME_STATUS[p.status];
  const rate = repaymentRate(t);
  const yieldHa = yieldPerHa(t);
  const manage = can.manageProgrammes(role);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={
          <div className="flex flex-wrap items-center gap-3">
            <BackLink />
            <span className="font-mono text-xs">{p.code}</span>
          </div>
        }
        title={p.name}
        description={`${p.sponsor} · ${PROGRAMME_KIND[p.kind]} · ${formatDate(p.starts_on)} – ${formatDate(p.ends_on)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
            <ExportButtons dashboard={d} />
            {manage && p.status === 'draft' && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit terms
              </Button>
            )}
            {manage && p.status !== 'closed' && (
              <StatusButton
                programmeId={p.id}
                action={p.status === 'draft' ? 'activate' : 'close'}
                onDone={state.reload}
              />
            )}
          </div>
        }
      />

      {p.status === 'draft' && (
        <Alert tone="info">
          This programme is a draft. Cycles can be attached now, but none can be submitted, and no
          programme money can be deposited, until it is activated.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat
          icon={<UsersRound />}
          label="Farmers reached"
          value={t.farmers.toLocaleString('en-NG')}
          sub={`${formatPct(t.farmers ? t.women / t.farmers : null)} women · ${t.farms} farms`}
        />
        <Stat
          icon={<Sprout />}
          tone="blue"
          label="Hectares"
          value={formatHectares(t.hectares)}
          sub={`${formatHectares(t.harvested_hectares)} harvested`}
        />
        <div className="flex h-full flex-col rounded-2xl bg-white p-5 shadow-card ring-1 ring-zinc-950/5">
          <span className="text-sm font-medium text-zinc-500">Budget committed</span>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-zinc-950 tabular-nums">
            {formatNaira(d.budget_committed_kobo, { compact: true })}
          </p>
          <Progress value={ratio(d.budget_committed_kobo, p.budget_kobo)} className="mt-2" />
          <p className="mt-1.5 text-xs text-zinc-500">
            of {formatNaira(p.budget_kobo, { compact: true })} ·{' '}
            {formatPct(ratio(d.budget_committed_kobo, p.budget_kobo))} used
          </p>
        </div>
        <Stat
          icon={<Truck />}
          tone="violet"
          label="Inputs delivered"
          value={formatNaira(t.inputs_kobo, { compact: true })}
          sub={`Plus ${formatNaira(t.cash_kobo, { compact: true })} cash to farmers`}
        />
        <Stat
          icon={<Wheat />}
          tone="amber"
          label="Harvest delivered"
          value={formatTonnes(t.delivered_kg)}
          sub={
            yieldHa === null
              ? 'No season finished yet'
              : `${yieldHa.toLocaleString('en-NG', { maximumFractionDigits: 2 })} t/ha · ${t.under_delivered} farm(s) under the low estimate`
          }
        />
        <Stat
          icon={p.kind === 'grant' ? <Coins /> : <Gauge />}
          tone="green"
          label={p.kind === 'grant' ? 'Returned' : 'Repayment rate'}
          value={
            p.kind === 'grant' ? formatNaira(t.recovered_kobo, { compact: true }) : formatPct(rate)
          }
          sub={
            p.kind === 'grant'
              ? 'A grant: nothing is due back'
              : rate === null
                ? 'Nothing due yet: repayment falls due at settlement'
                : `${formatNaira(t.recovered_kobo, { compact: true })} of ${formatNaira(t.due_kobo, { compact: true })} due`
          }
        />
      </div>

      <div>
        <SectionTitle
          title="Breakdown"
          description="Cycle-level money (deposits, vendor payments, repayments) is shared out by farm area; vouchers and harvest are each farm's own."
        />
        <Tabs
          tabs={DIMS.map((x) => ({ id: x.id, label: x.label, count: d[x.id].length }))}
          value={dim}
          onChange={setDim}
        />
        <Breakdown
          rows={d[dim]}
          column={DIMS.find((x) => x.id === dim)!.column}
          grant={p.kind === 'grant'}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <UnderDelivered dashboard={d} />
          <Agents dashboard={d} />
          <Cycles dashboard={d} />
        </div>
        <Card>
          <SectionTitle title="Terms" />
          <DescriptionList
            items={[
              ['Commodities', p.commodities.map(titleCase).join(', ')],
              ['States', p.target_states.join(', ')],
              ['LGAs', p.target_lgas.length ? p.target_lgas.join(', ') : 'All'],
              [
                'Hectares per farmer',
                p.max_hectares_per_farmer ? `Up to ${p.max_hectares_per_farmer} ha` : 'No limit',
              ],
              ['Cooperative membership', p.require_cooperative ? 'Required' : 'Not required'],
              [
                'Package value',
                p.max_budget_per_ha_kobo
                  ? `${formatNaira(p.max_budget_per_ha_kobo)} per ha`
                  : 'No cap',
              ],
              [
                'Repayment',
                p.kind === 'grant'
                  ? 'None (grant)'
                  : `${p.repayment_bps / 100}% · ${REPAYMENT_MODE[p.repayment_mode].toLowerCase()}`,
              ],
            ]}
          />
          {p.input_package && (
            <p className="mt-4 rounded-xl bg-zinc-50 px-4 py-3 text-sm text-zinc-700 ring-1 ring-zinc-950/5">
              <span className="block text-xs font-medium text-zinc-500">Input package</span>
              {p.input_package}
            </p>
          )}
          {p.description && <p className="mt-4 text-sm text-zinc-600">{p.description}</p>}
        </Card>
      </div>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        wide
        title={`Edit ${p.code}`}
        description="A draft's terms can change freely. Once active they're fixed."
      >
        <ProgrammeForm
          programme={p}
          onDone={(saved) => {
            setEditing(false);
            if (saved) state.reload();
          }}
        />
      </Modal>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/programmes"
      className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
    >
      <ArrowLeft className="size-4" aria-hidden /> Programmes
    </Link>
  );
}

function Breakdown({
  rows,
  column,
  grant,
}: {
  rows: (ProgrammeFigures & { key: string })[];
  column: string;
  grant: boolean;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState title="Nothing to show yet">
        Figures appear once a cycle in this programme is approved.
      </EmptyState>
    );
  }
  return (
    <Table
      head={[
        column,
        'Farmers',
        'Hectares',
        'Committed',
        'Inputs',
        'Harvest',
        'Yield',
        grant ? 'Returned' : 'Repaid',
        'Under low estimate',
      ]}
    >
      {rows.map((r) => {
        const rate = repaymentRate(r);
        const y = yieldPerHa(r);
        return (
          <tr key={r.key}>
            <td className="font-medium text-zinc-900">{titleCase(r.key)}</td>
            <td className="text-zinc-600 tabular-nums">
              {r.farmers}
              <span className="ml-1 text-xs text-zinc-400">({r.women} women)</span>
            </td>
            <td className="text-zinc-600 tabular-nums">{formatHectares(r.hectares)}</td>
            <td className="text-zinc-600 tabular-nums">
              {formatNaira(r.committed_kobo, { compact: true })}
            </td>
            <td className="text-zinc-600 tabular-nums">
              {formatNaira(r.inputs_kobo, { compact: true })}
            </td>
            <td className="text-zinc-600 tabular-nums">{formatTonnes(r.delivered_kg)}</td>
            <td className="text-zinc-600 tabular-nums">
              {y === null ? '—' : `${y.toLocaleString('en-NG', { maximumFractionDigits: 2 })} t/ha`}
            </td>
            <td className="tabular-nums">
              {grant ? (
                formatNaira(r.recovered_kobo, { compact: true })
              ) : rate === null ? (
                <span className="text-zinc-400">Not due</span>
              ) : (
                <span
                  className={cx(
                    'font-medium',
                    rate >= 0.95
                      ? 'text-brand-700'
                      : rate >= 0.7
                        ? 'text-amber-700'
                        : 'text-red-700',
                  )}
                >
                  {formatPct(rate)}
                </span>
              )}
            </td>
            <td className="tabular-nums">
              {r.under_delivered > 0 ? (
                <Badge tone="amber">{r.under_delivered}</Badge>
              ) : (
                <span className="text-zinc-400">0</span>
              )}
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

function UnderDelivered({ dashboard: d }: { dashboard: ProgrammeDashboard }) {
  return (
    <div>
      <SectionTitle
        title="Farms under the low-yield estimate"
        description="In finished seasons: farms that delivered less to the offtaker than the cycle's low-yield assumption. Follow these up first."
      />
      {d.under_delivered.length === 0 ? (
        <Card>
          <p className="text-sm text-zinc-500">
            {d.totals.harvested_hectares > 0
              ? 'Every farm delivered at least the low-yield estimate.'
              : 'No season has finished yet.'}
          </p>
        </Card>
      ) : (
        <Table head={['Farmer', 'Cooperative', 'Ward', 'Cycle', 'Delivered', 'Low estimate']}>
          {d.under_delivered.map((u) => (
            <tr key={`${u.cycle_id}-${u.farmer_id}`}>
              <td className="font-medium text-zinc-900">
                <Link to={`/farmers/${u.farmer_id}`} className="hover:text-brand-700">
                  {u.farmer_name}
                </Link>
              </td>
              <td className="text-zinc-600">{u.cooperative}</td>
              <td className="text-zinc-600">
                {u.ward}, {u.lga}
              </td>
              <td className="font-mono text-xs text-zinc-600">
                <Link to={`/cycles/${u.cycle_id}`} className="hover:text-brand-700">
                  {u.cycle_code}
                </Link>
              </td>
              <td className="text-zinc-900 tabular-nums">
                {formatTonnes(u.delivered_kg)}{' '}
                <span className="text-xs text-red-700">
                  ({formatPct(u.low_kg ? u.delivered_kg / u.low_kg : null)})
                </span>
              </td>
              <td className="text-zinc-600 tabular-nums">{formatTonnes(u.low_kg)}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function Agents({ dashboard: d }: { dashboard: ProgrammeDashboard }) {
  return (
    <div>
      <SectionTitle
        title="Extension agents"
        description={
          d.visits_outstanding > 0
            ? `${d.visits_outstanding} farm check(s) requested and not yet passed.`
            : 'No farm checks are waiting.'
        }
      />
      {d.agents.length === 0 ? (
        <Card>
          <p className="text-sm text-zinc-500">No field visits in this programme yet.</p>
        </Card>
      ) : (
        <Table head={['Agent', 'Visits', 'Passed', 'Off the farm', 'Farms', 'Days to visit']}>
          {d.agents.map((a) => (
            <tr key={a.agent_id}>
              <td className="font-medium text-zinc-900">{a.name}</td>
              <td className="text-zinc-600 tabular-nums">{a.visits}</td>
              <td className="text-zinc-600 tabular-nums">{formatPct(a.passed / a.visits)}</td>
              <td className="tabular-nums">
                {a.gps_failed > 0 ? (
                  <Badge tone="red">{a.gps_failed}</Badge>
                ) : (
                  <span className="text-zinc-400">0</span>
                )}
              </td>
              <td className="text-zinc-600 tabular-nums">{a.farms}</td>
              <td className="text-zinc-600 tabular-nums">
                {a.avg_days_to_visit === null ? '—' : `${a.avg_days_to_visit} on average`}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function Cycles({ dashboard: d }: { dashboard: ProgrammeDashboard }) {
  return (
    <div>
      <SectionTitle
        title="Cycles"
        description="Attach a cycle from its Edit form: programme or blended funding, then choose this programme."
      />
      {d.cycles.length === 0 ? (
        <Card>
          <p className="text-sm text-zinc-500">No cycles attached yet.</p>
        </Card>
      ) : (
        <Table head={['Cycle', 'Crop', 'Status', 'Programme money', 'Target']}>
          {d.cycles.map((c) => (
            <tr key={c.id}>
              <td className="font-mono text-xs">
                <Link to={`/cycles/${c.id}`} className="text-zinc-900 hover:text-brand-700">
                  {c.code}
                </Link>
              </td>
              <td className="text-zinc-600">
                {titleCase(c.crop)} · {c.season}
                {c.funding_source === 'blended' && (
                  <span className="ml-1.5 text-xs text-zinc-400">(blended)</span>
                )}
              </td>
              <td>
                <CycleStatusBadge status={c.status} />
              </td>
              <td className="text-zinc-900 tabular-nums">{formatNaira(c.programme_kobo)}</td>
              <td className="text-zinc-600 tabular-nums">{formatNaira(c.target_kobo)}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function ExportButtons({ dashboard: d }: { dashboard: ProgrammeDashboard }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const code = d.programme.code;

  /** Every beneficiary farm, with names: for auditors and donors. */
  const beneficiaries = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('programme_beneficiaries', {
      p_programme_id: d.programme.id,
    });
    setBusy(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    download(
      `${code}-beneficiaries.csv`,
      toCsv(data as ProgrammeBeneficiary[], [
        ['Cycle', (r) => r.cycle_code],
        ['Cycle status', (r) => r.cycle_status],
        ['Commodity', (r) => r.crop],
        ['Farmer ID', (r) => r.farmer_id],
        ['Farmer', (r) => r.farmer_name],
        ['Gender', (r) => r.gender],
        ['State', (r) => r.state],
        ['LGA', (r) => r.lga],
        ['Ward', (r) => r.ward],
        ['Cooperative', (r) => r.cooperative],
        ['Hectares', (r) => Number(r.hectares).toFixed(2)],
        ['Programme money (NGN)', (r) => csvNaira(r.committed_kobo)],
        ['Inputs delivered (NGN)', (r) => csvNaira(r.inputs_kobo)],
        ['Cash to farmer (NGN)', (r) => csvNaira(r.cash_kobo)],
        ['Delivered (kg)', (r) => Math.round(r.delivered_kg)],
        ['Low-yield estimate (kg)', (r) => Math.round(r.low_kg)],
        ['Due (NGN)', (r) => csvNaira(r.due_kobo)],
        ['Recovered (NGN)', (r) => csvNaira(r.recovered_kobo)],
      ]),
    );
  };

  /** Totals by LGA, with no personal data: safe to publish. */
  const openData = () =>
    download(
      `${code}-open-data-by-lga.csv`,
      toCsv(d.by_lga, [
        ['Programme', () => code],
        ['State · LGA', (r) => r.key],
        ['Farmers', (r) => r.farmers],
        ['Women', (r) => r.women],
        ['Hectares', (r) => r.hectares],
        ['Programme money (NGN)', (r) => csvNaira(r.committed_kobo)],
        ['Inputs delivered (NGN)', (r) => csvNaira(r.inputs_kobo)],
        ['Harvest delivered (kg)', (r) => r.delivered_kg],
        ['Due (NGN)', (r) => csvNaira(r.due_kobo)],
        ['Recovered (NGN)', (r) => csvNaira(r.recovered_kobo)],
      ]),
    );

  return (
    <>
      <Button variant="secondary" onClick={beneficiaries} busy={busy}>
        <Download aria-hidden /> Beneficiaries (audit)
      </Button>
      <Button
        variant="secondary"
        onClick={openData}
        title="Totals by LGA with no names: safe to publish"
      >
        <Download aria-hidden /> Open data
      </Button>
    </>
  );
}

function StatusButton({
  programmeId,
  action,
  onDone,
}: {
  programmeId: string;
  action: 'activate' | 'close';
  onDone: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc(
      action === 'activate' ? 'activate_programme' : 'close_programme',
      { p_programme_id: programmeId },
    );
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    toast.success(action === 'activate' ? 'Programme activated' : 'Programme closed');
    setOpen(false);
    onDone();
  };

  return (
    <>
      <Button variant={action === 'close' ? 'secondary' : 'primary'} onClick={() => setOpen(true)}>
        {action === 'activate' ? 'Activate' : 'Close programme'}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={action === 'activate' ? 'Activate this programme?' : 'Close this programme?'}
        description={
          action === 'activate'
            ? 'Its terms are fixed from now on. Cycles that fit them can be submitted, and programme money can be deposited up to the budget.'
            : 'No new deposits or cycle submissions. Cycles already under way carry on to settlement and still count here.'
        }
      >
        {error && (
          <div className="mb-4">
            <Alert>{error}</Alert>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Back
          </Button>
          <Button variant={action === 'close' ? 'danger' : 'primary'} busy={busy} onClick={go}>
            {action === 'activate' ? 'Activate' : 'Close programme'}
          </Button>
        </div>
      </Modal>
    </>
  );
}
