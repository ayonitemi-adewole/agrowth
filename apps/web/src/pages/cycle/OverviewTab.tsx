import {
  CalendarDays,
  CheckCircle2,
  Circle,
  Coins,
  MapPinned,
  Pencil,
  Send,
  ShieldCheck,
  Sprout,
  XCircle,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { CycleForm } from '../../components/CycleForm';
import { useToast } from '../../components/Toast';
import {
  Alert,
  Button,
  Card,
  DescriptionList,
  Field,
  Modal,
  Progress,
  SectionTitle,
  Stat,
  Textarea,
} from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatHectares } from '../../lib/format';
import { formatNaira, ratio, toKobo } from '../../lib/money';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { ReadinessCheck } from '../../lib/types';
import type { TabProps } from './useCycleData';
import { RecordFundingButton, RefundButton } from './FundingTab';

type Goto = (tab: 'farms' | 'milestones' | 'contracts' | 'funding') => void;

export function OverviewTab({ data, reload, goTo }: TabProps & { goTo: Goto }) {
  const { cycle, hectares } = data;
  const role = useAuth().profile?.role;
  const [editing, setEditing] = useState(false);

  // Harvest value range: hectares × yield × price. A range, not a promise.
  const value = (yieldPerHa: number, price: number | string | null) =>
    price === null
      ? null
      : (BigInt(Math.round(hectares * yieldPerHa * 1000)) * toKobo(price)) / 1000n;
  const low = value(cycle.yield_low_t_per_ha, cycle.price_low_per_tonne_kobo);
  const expected = value(cycle.yield_expected_t_per_ha, cycle.price_expected_per_tonne_kobo);
  const high = value(cycle.yield_high_t_per_ha, cycle.price_high_per_tonne_kobo);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            icon={<Coins />}
            label="Raised"
            value={formatNaira(data.raisedKobo, { compact: true })}
            sub={`of ${formatNaira(cycle.target_amount_kobo)}`}
          />
          <Stat
            icon={<MapPinned />}
            tone="blue"
            label="Land"
            value={formatHectares(hectares)}
            sub={`${data.farms.length} farms`}
          />
          <Stat
            icon={<CalendarDays />}
            tone="violet"
            label="Expected harvest"
            value={cycle.expected_harvest_date ? formatDate(cycle.expected_harvest_date) : '—'}
            sub={cycle.start_date ? `Starts ${formatDate(cycle.start_date)}` : 'Dates not set'}
          />
        </div>

        <Card>
          <SectionTitle
            title="Harvest value range"
            description="Mapped hectares × yield × farm-gate price. This is a projection from assumptions, not a guaranteed return."
          />
          {low === null || expected === null || high === null || hectares === 0 ? (
            <p className="text-sm text-zinc-500">
              Add farms and all three price assumptions to see the range.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  ['Low', low, cycle.yield_low_t_per_ha],
                  ['Expected', expected, cycle.yield_expected_t_per_ha],
                  ['High', high, cycle.yield_high_t_per_ha],
                ] as const
              ).map(([label, v, y]) => (
                <div
                  key={label}
                  className={
                    label === 'Expected'
                      ? 'rounded-xl bg-brand-50 p-4 ring-1 ring-brand-600/15'
                      : 'rounded-xl bg-zinc-50 p-4'
                  }
                >
                  <p className="text-xs font-medium text-zinc-500">{label}</p>
                  <p className="mt-1 text-lg font-semibold text-zinc-950 tabular-nums">
                    {formatNaira(v, { compact: true })}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {y} t/ha · {Math.round(ratio(v, cycle.target_amount_kobo) * 100)}% of budget
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle
            title="Details"
            actions={
              cycle.status === 'draft' &&
              can.manageCycles(role) && (
                <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden /> Edit
                </Button>
              )
            }
          />
          <DescriptionList
            items={[
              ['Target', formatNaira(cycle.target_amount_kobo)],
              ['Budget per hectare', formatNaira(cycle.budget_per_hectare_kobo)],
              [
                'Yield (t/ha)',
                `${cycle.yield_low_t_per_ha} – ${cycle.yield_expected_t_per_ha} – ${cycle.yield_high_t_per_ha}`,
              ],
              [
                'Price (per tonne)',
                cycle.price_expected_per_tonne_kobo
                  ? `${formatNaira(cycle.price_low_per_tonne_kobo, { compact: true })} – ${formatNaira(cycle.price_expected_per_tonne_kobo, { compact: true })} – ${formatNaira(cycle.price_high_per_tonne_kobo, { compact: true })}`
                  : '—',
              ],
              ['Funding deadline', formatDate(cycle.funding_deadline)],
              ['Approved', cycle.approved_at ? formatDate(cycle.approved_at) : '—'],
            ]}
          />
          {cycle.description && (
            <p className="mt-4 text-sm whitespace-pre-line text-zinc-600">{cycle.description}</p>
          )}
        </Card>
      </div>

      <div className="space-y-6">
        <NextStep data={data} reload={reload} goTo={goTo} />
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit cycle details" wide>
        <CycleForm
          cycle={cycle}
          onDone={(saved) => {
            setEditing(false);
            if (saved) reload();
          }}
        />
      </Modal>
    </div>
  );
}

/** What happens next, and the buttons for whoever can do it. */
function NextStep({ data, reload, goTo }: TabProps & { goTo: Goto }) {
  const { cycle } = data;
  const { profile } = useAuth();
  const role = profile?.role;
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'reject' | 'cancel' | null>(null);
  const [note, setNote] = useState('');

  const call = async (key: string, fn: string, args: Record<string, unknown>, done: string) => {
    setBusy(key);
    setError(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(null);
    if (error) {
      setError(errorMessage(error));
      return false;
    }
    toast.success(done);
    setDialog(null);
    setNote('');
    reload();
    return true;
  };

  const isManager = can.manageCycles(role);
  const ownCycle = cycle.manager_id === profile?.id;
  const checks = data.readiness ?? [];
  const ready = checks.length > 0 && checks.every((c) => c.ok);
  const fixTab: Record<string, Parameters<Goto>[0]> = {
    farms: 'farms',
    kyc: 'farms',
    one_cycle_per_farm: 'farms',
    budget: 'farms',
    milestones: 'milestones',
    offtake: 'contracts',
    insurance: 'contracts',
  };

  let body: ReactNode;
  switch (cycle.status) {
    case 'draft':
      body = (
        <>
          {cycle.review_note && (
            <Alert tone="warning" title="Returned by compliance">
              {cycle.review_note}
            </Alert>
          )}
          <p className="text-sm text-zinc-600">
            Complete every check, then submit for compliance approval.
          </p>
          <ReadinessList checks={checks} onFix={(key) => fixTab[key] && goTo(fixTab[key])} />
          {isManager && (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!ready}
                busy={busy === 'submit'}
                onClick={() =>
                  call('submit', 'submit_cycle', { p_cycle_id: cycle.id }, 'Submitted for approval')
                }
              >
                <Send aria-hidden /> Submit for approval
              </Button>
              <Button variant="ghost" onClick={() => setDialog('cancel')}>
                Cancel cycle
              </Button>
            </div>
          )}
        </>
      );
      break;
    case 'pending_approval':
      body = (
        <>
          <p className="text-sm text-zinc-600">
            Compliance checks the documents and farms, then approves or returns the cycle with a
            note.
          </p>
          <ReadinessList checks={checks} />
          {can.reviewCycles(role) && !ownCycle && (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!ready}
                busy={busy === 'approve'}
                onClick={() =>
                  call(
                    'approve',
                    'review_cycle',
                    { p_cycle_id: cycle.id, p_approve: true },
                    'Approved and opened for funding',
                  )
                }
              >
                <ShieldCheck aria-hidden /> Approve
              </Button>
              <Button variant="secondary" onClick={() => setDialog('reject')}>
                Return with note
              </Button>
            </div>
          )}
          {can.reviewCycles(role) && ownCycle && (
            <Alert tone="info">
              You manage this cycle, so another compliance officer must review it.
            </Alert>
          )}
        </>
      );
      break;
    case 'open_for_funding': {
      const deadlinePassed =
        !!cycle.funding_deadline && cycle.funding_deadline < new Date().toISOString().slice(0, 10);
      body = (
        <>
          <div>
            <div className="flex justify-between text-sm">
              <span className="font-medium text-zinc-900">{formatNaira(data.raisedKobo)}</span>
              <span className="text-zinc-500">
                {Math.round(ratio(data.raisedKobo, cycle.target_amount_kobo) * 100)}%
              </span>
            </div>
            <Progress value={ratio(data.raisedKobo, cycle.target_amount_kobo)} className="mt-2" />
          </div>
          <p className="text-sm text-zinc-600">
            {deadlinePassed
              ? 'The funding deadline has passed without the cycle filling. The trustee refunds every funder in full.'
              : `Funders pay the trustee directly. The trustee confirms each deposit here. Deadline: ${formatDate(cycle.funding_deadline)}.`}
          </p>
          {can.actAsTrustee(role) &&
            (deadlinePassed ? (
              <RefundButton cycleId={cycle.id} reload={reload} />
            ) : (
              <RecordFundingButton data={data} reload={reload} />
            ))}
          {isManager && !deadlinePassed && (
            <Button variant="ghost" onClick={() => setDialog('cancel')}>
              Cancel cycle
            </Button>
          )}
        </>
      );
      break;
    }
    case 'funded':
    case 'in_progress': {
      const next = data.milestones.find((m) => m.status !== 'released');
      body = next ? (
        <>
          <p className="text-sm text-zinc-600">
            Next: milestone {next.sequence},{' '}
            <span className="font-medium text-zinc-900">{next.name}</span> (
            {formatNaira(next.amount_kobo, { compact: true })}). Funds are released only after every
            farm passes a field visit.
          </p>
          <Button variant="secondary" onClick={() => goTo('milestones')}>
            Go to milestones
          </Button>
        </>
      ) : (
        <p className="text-sm text-zinc-600">
          All milestones are released. Harvest and settlement come next.
        </p>
      );
      break;
    }
    case 'cancelled': {
      const unrefunded = data.contributions.some((c) => !c.refund_entry_id);
      body = (
        <>
          <p className="text-sm text-zinc-600">
            This cycle was cancelled.
            {unrefunded && ' Funds received must be refunded by the trustee.'}
          </p>
          {unrefunded && can.actAsTrustee(role) && (
            <RefundButton cycleId={cycle.id} reload={reload} />
          )}
        </>
      );
      break;
    }
    default:
      body = <p className="text-sm text-zinc-600">This cycle is closed.</p>;
  }

  return (
    <Card className="lg:sticky lg:top-6">
      <SectionTitle title="Next step" />
      <div className="space-y-4">
        {body}
        {error && <Alert>{error}</Alert>}
      </div>

      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === 'reject' ? 'Return to the cycle manager' : 'Cancel this cycle'}
        description={
          dialog === 'reject'
            ? 'The cycle goes back to draft with your note.'
            : 'This cannot be undone. Any funds received will be refunded by the trustee.'
        }
      >
        <div className="space-y-4">
          <Field label={dialog === 'reject' ? 'What needs to change?' : 'Reason'}>
            <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          </Field>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Back
            </Button>
            <Button
              variant={dialog === 'cancel' ? 'danger' : 'primary'}
              disabled={!note.trim()}
              busy={busy === 'dialog'}
              onClick={() =>
                dialog === 'reject'
                  ? call(
                      'dialog',
                      'review_cycle',
                      { p_cycle_id: cycle.id, p_approve: false, p_note: note },
                      'Returned to draft',
                    )
                  : call(
                      'dialog',
                      'cancel_cycle',
                      { p_cycle_id: cycle.id, p_reason: note },
                      'Cycle cancelled',
                    )
              }
            >
              {dialog === 'reject' ? 'Return cycle' : 'Cancel cycle'}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

function ReadinessList({
  checks,
  onFix,
}: {
  checks: ReadinessCheck[];
  onFix?: (key: string) => void;
}) {
  const done = checks.filter((c) => c.ok).length;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-xs font-medium text-zinc-500">
        <span className="flex items-center gap-1.5">
          <Sprout className="size-3.5" aria-hidden /> Readiness
        </span>
        <span>
          {done} of {checks.length}
        </span>
      </div>
      <Progress value={checks.length ? done / checks.length : 0} className="mb-4" />
      <ul className="space-y-2.5">
        {checks.map((c) => (
          <li key={c.key} className="flex gap-2.5 text-sm">
            {c.ok ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-600" aria-label="Done" />
            ) : onFix ? (
              <Circle className="mt-0.5 size-4 shrink-0 text-zinc-300" aria-label="To do" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" aria-label="Failing" />
            )}
            <div className="min-w-0">
              {onFix && !c.ok ? (
                <button
                  onClick={() => onFix(c.key)}
                  className="text-left text-zinc-800 hover:text-brand-700 hover:underline"
                >
                  {c.label}
                </button>
              ) : (
                <span className={c.ok ? 'text-zinc-500' : 'text-zinc-800'}>{c.label}</span>
              )}
              {c.detail && <p className="text-xs text-zinc-500">{c.detail}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
