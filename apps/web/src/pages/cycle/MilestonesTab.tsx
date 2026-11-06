import {
  BadgeCheck,
  CircleDashed,
  ClipboardCheck,
  Flag,
  Landmark,
  Pencil,
  Plus,
  Ticket,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { MilestoneStatusBadge } from '../../components/StatusBadges';
import { useToast } from '../../components/Toast';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
} from '../../components/ui';
import { isoDate, PAYEE_KIND } from '../../lib/cycles';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { formatNaira, nairaInput, parseNaira, toKobo } from '../../lib/money';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { Disbursement, FieldVisit, Milestone, PayeeKind } from '../../lib/types';
import type { TabProps } from './useCycleData';
import { VisitEvidence } from './VisitEvidence';

export function MilestonesTab({ data, reload }: TabProps) {
  const role = useAuth().profile?.role;
  const toast = useToast();
  const { cycle, milestones } = data;
  const editable = cycle.status === 'draft' && can.manageCycles(role);
  const [editing, setEditing] = useState<Milestone | 'new' | null>(null);

  const total = milestones.reduce((s, m) => s + toKobo(m.amount_kobo), 0n);
  const target = toKobo(cycle.target_amount_kobo);

  const remove = async (m: Milestone) => {
    const { error } = await supabase.from('milestones').delete().eq('id', m.id);
    if (error) toast.error(errorMessage(error));
    else reload();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-600">
          Scheduled <span className="font-medium text-zinc-900">{formatNaira(total)}</span> of{' '}
          {formatNaira(target)}
          {total !== target && (
            <span className="ml-2 text-amber-700">
              (
              {total < target
                ? `${formatNaira(target - total)} left to schedule`
                : `${formatNaira(total - target)} over`}
              )
            </span>
          )}
        </p>
        {editable && (
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> Add milestone
          </Button>
        )}
      </div>

      {milestones.length === 0 ? (
        <EmptyState icon={<Flag />} title="No milestones yet">
          Split the budget into stages, e.g. land preparation, planting, mid-season inputs, harvest.
          Each stage is released only after field verification.
        </EmptyState>
      ) : (
        <ol className="relative space-y-4">
          {milestones.map((m, i) => (
            <li key={m.id}>
              <MilestoneCard
                milestone={m}
                previousReleased={i === 0 || milestones[i - 1].status === 'released'}
                data={data}
                reload={reload}
                onEdit={editable ? () => setEditing(m) : undefined}
                onDelete={editable ? () => remove(m) : undefined}
              />
            </li>
          ))}
        </ol>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add milestone' : 'Edit milestone'}
      >
        {editing !== null && (
          <MilestoneForm
            cycleId={cycle.id}
            milestone={editing === 'new' ? undefined : editing}
            nextSequence={Math.max(0, ...milestones.map((m) => m.sequence)) + 1}
            suggestedAmount={target > total ? target - total : 0n}
            onDone={(saved) => {
              setEditing(null);
              if (saved) reload();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function MilestoneCard({
  milestone: m,
  previousReleased,
  data,
  reload,
  onEdit,
  onDelete,
}: TabProps & {
  milestone: Milestone;
  previousReleased: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const role = useAuth().profile?.role;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const live = ['funded', 'in_progress'].includes(data.cycle.status);
  const payments = data.disbursements.filter(
    (d) => d.milestone_id === m.id && d.status !== 'cancelled',
  );
  const showVerification = ['awaiting_verification', 'blocked', 'verified', 'released'].includes(
    m.status,
  );

  const requestVerification = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('request_milestone_verification', {
      p_milestone_id: m.id,
    });
    setBusy(false);
    if (error) toast.error(errorMessage(error));
    else {
      toast.success('Field agents can now record visits for this milestone');
      reload();
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-zinc-100 text-sm font-semibold text-zinc-700">
            {m.sequence}
          </span>
          <div>
            <p className="font-semibold text-zinc-950">{m.name}</p>
            <p className="mt-0.5 text-sm text-zinc-500">
              {formatNaira(m.amount_kobo)}
              {m.planned_date && ` · planned ${formatDate(m.planned_date)}`}
            </p>
            {m.description && <p className="mt-2 text-sm text-zinc-600">{m.description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <MilestoneStatusBadge status={m.status} />
          {onEdit && (
            <Button variant="ghost" size="sm" onClick={onEdit} aria-label="Edit milestone">
              <Pencil aria-hidden />
            </Button>
          )}
          {onDelete && (
            <Button variant="ghost" size="sm" onClick={onDelete} aria-label="Delete milestone">
              <Trash2 aria-hidden />
            </Button>
          )}
        </div>
      </div>

      {live && m.status === 'pending' && can.manageCycles(role) && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-zinc-950/5 pt-4">
          <Button
            variant="subtle"
            busy={busy}
            disabled={!previousReleased}
            onClick={requestVerification}
          >
            <ClipboardCheck aria-hidden /> Request field verification
          </Button>
          {!previousReleased && (
            <span className="text-xs text-zinc-500">Release the previous milestone first.</span>
          )}
        </div>
      )}

      {showVerification && <Verification milestone={m} data={data} />}

      {m.status === 'verified' && payments.length === 0 && can.manageCycles(role) && (
        <div className="mt-4 border-t border-zinc-950/5 pt-4">
          <Button onClick={() => setReleasing(true)}>
            <Landmark aria-hidden /> Instruct release
          </Button>
        </div>
      )}

      {payments.length > 0 && (
        <Payments payments={payments} milestone={m} data={data} reload={reload} />
      )}

      <Modal
        open={releasing}
        onClose={() => setReleasing(false)}
        title={`Release milestone ${m.sequence}`}
        description={`Instruct the trustee to release ${formatNaira(m.amount_kobo)}, mostly as input vouchers or payments to vendors and service providers.`}
        wide
      >
        <ReleaseForm
          milestone={m}
          farmCount={data.farms.length}
          onDone={(saved) => {
            setReleasing(false);
            if (saved) {
              toast.success('Release instructions sent to the trustee');
              reload();
            }
          }}
        />
      </Modal>
    </Card>
  );
}

/** Each farm's latest visit for this milestone. */
function Verification({ milestone: m, data }: { milestone: Milestone; data: TabProps['data'] }) {
  const role = useAuth().profile?.role;
  const [shown, setShown] = useState<FieldVisit | null>(null);
  const rows = data.farms.map((farm) => {
    const latest = data.visits.find(
      (v) =>
        v.milestone_id === m.id &&
        v.farm_id === farm.id &&
        (!m.verification_requested_at || v.visited_at >= m.verification_requested_at),
    );
    return { farm, latest };
  });
  const passed = rows.filter((r) => r.latest?.passed).length;
  const canVisit =
    can.doFieldVisits(role) && ['awaiting_verification', 'blocked'].includes(m.status);

  return (
    <div className="mt-4 border-t border-zinc-950/5 pt-4">
      <p className="mb-3 text-xs font-medium text-zinc-500">
        Field verification · {passed} of {rows.length} farms passed
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map(({ farm, latest }) => (
          <li
            key={farm.id}
            className="flex items-center gap-3 rounded-xl bg-zinc-50 px-3 py-2.5 text-sm"
          >
            {!latest ? (
              <CircleDashed className="size-4 shrink-0 text-zinc-400" aria-label="Not visited" />
            ) : latest.passed ? (
              <BadgeCheck className="size-4 shrink-0 text-brand-600" aria-label="Passed" />
            ) : (
              <XCircle className="size-4 shrink-0 text-red-500" aria-label="Failed" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-zinc-900">{farm.farmer_name}</p>
              <p className="truncate text-xs text-zinc-500">
                {!latest
                  ? 'Not visited yet'
                  : latest.passed
                    ? `Passed ${formatDate(latest.visited_at)} · crop ${latest.crop_condition}`
                    : failReason(latest)}
              </p>
            </div>
            {latest && (
              <Button variant="ghost" size="sm" onClick={() => setShown(latest)}>
                Evidence
              </Button>
            )}
            {canVisit && (!latest || !latest.passed) && (
              <Link to={`/field/visit?milestone=${m.id}&farm=${farm.id}`}>
                <Button variant="secondary" size="sm">
                  {latest ? 'Revisit' : 'Visit'}
                </Button>
              </Link>
            )}
          </li>
        ))}
      </ul>
      <VisitEvidence
        visit={shown}
        farm={data.farms.find((f) => f.id === shown?.farm_id)}
        milestone={m}
        history={data.visits.filter((v) => v.milestone_id === m.id && v.farm_id === shown?.farm_id)}
        onClose={() => setShown(null)}
      />
    </div>
  );
}

function failReason(v: TabProps['data']['visits'][number]) {
  if (!v.gps_ok) {
    return v.gps_accuracy_m > 20
      ? `Failed: GPS only accurate to ${Math.round(v.gps_accuracy_m)} m`
      : `Failed: check-in ${Math.round(v.distance_from_boundary_m)} m outside the farm`;
  }
  if (v.crop_condition === 'failed') return 'Failed: crop reported as failed';
  if (!v.checklist_passed) return 'Failed: checklist not passed';
  if (v.photo_paths.length === 0) return 'Failed: no photo';
  return 'Failed';
}

function Payments({
  payments,
  milestone,
  data,
  reload,
}: {
  payments: Disbursement[];
  milestone: Milestone;
  data: TabProps['data'];
  reload: () => void;
}) {
  const role = useAuth().profile?.role;
  const toast = useToast();
  const [confirming, setConfirming] = useState<Disbursement | null>(null);
  const [issuing, setIssuing] = useState<Disbursement | null>(null);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('confirm_disbursement', {
      p_disbursement_id: confirming!.id,
      p_trustee_reference: reference,
    });
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    toast.success(`Payment to ${confirming!.payee_name} confirmed`);
    setConfirming(null);
    setReference('');
    reload();
  };

  return (
    <div className="mt-4 border-t border-zinc-950/5 pt-4">
      <p className="mb-3 text-xs font-medium text-zinc-500">Payments</p>
      <ul className="divide-y divide-zinc-950/5 rounded-xl ring-1 ring-zinc-950/5">
        {payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-zinc-900">
                {p.payee_kind === 'input_voucher' ? 'Input vouchers' : p.payee_name}
              </p>
              <p className="text-xs text-zinc-500">
                {p.payee_kind === 'input_voucher'
                  ? `${p.purpose} · redeemable at approved agro-dealers`
                  : `${PAYEE_KIND[p.payee_kind]} · ${p.purpose} · ${p.payee_account}`}
              </p>
            </div>
            <span className="font-medium text-zinc-900 tabular-nums">
              {formatNaira(p.amount_kobo)}
            </span>
            {p.payee_kind === 'input_voucher' ? (
              p.status === 'executed' ? (
                <Badge tone="green" dot>
                  {data.vouchers.filter((v) => v.disbursement_id === p.id).length} vouchers issued
                </Badge>
              ) : can.actAsTrustee(role) ? (
                <Button size="sm" onClick={() => setIssuing(p)}>
                  <Ticket aria-hidden /> Issue vouchers
                </Button>
              ) : (
                <Badge tone="amber" dot>
                  With trustee
                </Badge>
              )
            ) : p.status === 'executed' ? (
              <Badge tone="green" dot>
                Paid · {p.trustee_reference}
              </Badge>
            ) : can.actAsTrustee(role) ? (
              <Button size="sm" onClick={() => setConfirming(p)}>
                Confirm payment
              </Button>
            ) : (
              <Badge tone="amber" dot>
                With trustee
              </Badge>
            )}
          </li>
        ))}
      </ul>

      <Modal
        open={issuing !== null}
        onClose={() => setIssuing(null)}
        title="Issue input vouchers"
        description={
          issuing
            ? `Ring-fence ${formatNaira(issuing.amount_kobo)} of this cycle's cash and issue one voucher per farm (${data.farms.length}), split by area. Vendors are paid as farmers redeem them.`
            : undefined
        }
      >
        {issuing && (
          <IssueVouchersForm
            line={issuing}
            milestone={milestone}
            onDone={(n) => {
              setIssuing(null);
              if (n !== null) {
                toast.success(`${n} vouchers issued. Print the slips from the Vouchers tab.`);
                reload();
              }
            }}
          />
        )}
      </Modal>

      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Confirm payment"
        description={
          confirming
            ? `Confirm you have paid ${formatNaira(confirming.amount_kobo)} to ${confirming.payee_name} (${confirming.payee_account}). This posts to the ledger and cannot be undone.`
            : undefined
        }
      >
        <form onSubmit={confirm} className="space-y-4">
          <Field label="Bank transaction reference">
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              required
              autoFocus
            />
          </Field>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Back
            </Button>
            <Button type="submit" busy={busy}>
              Confirm payment
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function IssueVouchersForm({
  line,
  milestone,
  onDone,
}: {
  line: Disbursement;
  milestone: Milestone;
  onDone: (issued: number | null) => void;
}) {
  // Same default as the database: 60 days after the planned date, or after today if that's later.
  const start =
    milestone.planned_date && milestone.planned_date > isoDate()
      ? milestone.planned_date
      : isoDate();
  const [expires, setExpires] = useState(
    new Date(Date.parse(start) + 60 * 86_400_000).toISOString().slice(0, 10),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc('issue_vouchers', {
      p_disbursement_id: line.id,
      p_expires_on: expires,
    });
    setBusy(false);
    if (error) setError(errorMessage(error));
    else onDone(data as number);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Valid until" hint="Unused value returns to the cycle when vouchers are closed">
        <Input
          type="date"
          min={isoDate(1)}
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
          required
        />
      </Field>
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onDone(null)}>
          Back
        </Button>
        <Button type="submit" busy={busy}>
          Issue vouchers
        </Button>
      </div>
    </form>
  );
}

function MilestoneForm({
  cycleId,
  milestone,
  nextSequence,
  suggestedAmount,
  onDone,
}: {
  cycleId: string;
  milestone?: Milestone;
  nextSequence: number;
  suggestedAmount: bigint;
  onDone: (saved: boolean) => void;
}) {
  const [form, setForm] = useState({
    sequence: String(milestone?.sequence ?? nextSequence),
    name: milestone?.name ?? '',
    planned_date: milestone?.planned_date ?? '',
    amount: milestone
      ? nairaInput(milestone.amount_kobo)
      : suggestedAmount > 0n
        ? nairaInput(suggestedAmount)
        : '',
    description: milestone?.description ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = parseNaira(form.amount);
    if (amount === null) {
      setError('Enter the amount in naira, e.g. 2500000');
      return;
    }
    setBusy(true);
    setError(null);
    const row = {
      sequence: Number(form.sequence),
      name: form.name.trim(),
      planned_date: form.planned_date || null,
      amount_kobo: amount.toString(),
      description: form.description.trim() || null,
    };
    const { error } = milestone
      ? await supabase.from('milestones').update(row).eq('id', milestone.id)
      : await supabase.from('milestones').insert({ ...row, cycle_id: cycleId });
    setBusy(false);
    if (error) {
      setError(
        error.code === '23505' ? 'Another milestone already has this number' : errorMessage(error),
      );
      return;
    }
    onDone(true);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-[6rem_1fr] gap-4">
        <Field label="Order">
          <Input type="number" min={1} value={form.sequence} onChange={set('sequence')} required />
        </Field>
        <Field label="Name">
          <Input
            value={form.name}
            onChange={set('name')}
            required
            maxLength={100}
            placeholder="Land preparation"
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount (₦)">
          <Input value={form.amount} onChange={set('amount')} required inputMode="decimal" />
        </Field>
        <Field label="Planned date">
          <Input type="date" value={form.planned_date} onChange={set('planned_date')} />
        </Field>
      </div>
      <Field label="What it pays for" hint="Optional">
        <Textarea
          rows={3}
          value={form.description}
          onChange={set('description')}
          maxLength={2000}
        />
      </Field>
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          Save milestone
        </Button>
      </div>
    </form>
  );
}

interface Line {
  payee_kind: PayeeKind;
  payee_name: string;
  payee_account: string;
  purpose: string;
  amount: string;
}

const VOUCHER_PAYEE = 'Farmers (input vouchers)';
const VOUCHER_ACCOUNT = 'Redeemable at approved agro-dealers';

function ReleaseForm({
  milestone,
  farmCount,
  onDone,
}: {
  milestone: Milestone;
  farmCount: number;
  onDone: (saved: boolean) => void;
}) {
  const blank = (amount = ''): Line => ({
    payee_kind: 'input_vendor',
    payee_name: '',
    payee_account: '',
    purpose: '',
    amount,
  });
  const [lines, setLines] = useState<Line[]>([blank(nairaInput(milestone.amount_kobo))]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (i === j ? { ...l, ...patch } : l)));

  const amounts = lines.map((l) => parseNaira(l.amount) ?? 0n);
  const total = amounts.reduce((s, a) => s + a, 0n);
  const cash = lines.reduce((s, l, i) => (l.payee_kind === 'farmer_cash' ? s + amounts[i] : s), 0n);
  const target = toKobo(milestone.amount_kobo);
  const cashLimit = (target * 20n) / 100n;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (lines.some((l) => parseNaira(l.amount) === null)) {
      setError('Every amount must be in naira, e.g. 1500000');
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('instruct_milestone_release', {
      p_milestone_id: milestone.id,
      p_lines: lines.map((l, i) => ({
        payee_kind: l.payee_kind,
        payee_name: l.payee_kind === 'input_voucher' ? VOUCHER_PAYEE : l.payee_name,
        payee_account: l.payee_kind === 'input_voucher' ? VOUCHER_ACCOUNT : l.payee_account,
        purpose: l.purpose,
        amount_kobo: amounts[i].toString(),
      })),
    });
    setBusy(false);
    if (error) setError(errorMessage(error));
    else onDone(true);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-3">
        {lines.map((l, i) => (
          <div key={i} className="space-y-3 rounded-xl bg-zinc-50 p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_9rem]">
              <Select
                value={l.payee_kind}
                onChange={(e) => update(i, { payee_kind: e.target.value as PayeeKind })}
                aria-label="Payee type"
              >
                {Object.entries(PAYEE_KIND).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
              {l.payee_kind === 'input_voucher' ? (
                <p className="self-center text-xs text-zinc-500">
                  One voucher per farm ({farmCount}), split by area. Farmers redeem them at approved
                  agro-dealers, who are paid by the trustee.
                </p>
              ) : (
                <Input
                  placeholder="Payee name"
                  value={l.payee_name}
                  onChange={(e) => update(i, { payee_name: e.target.value })}
                  required
                />
              )}
              <Input
                placeholder="Amount (₦)"
                inputMode="decimal"
                value={l.amount}
                onChange={(e) => update(i, { amount: e.target.value })}
                required
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              {l.payee_kind !== 'input_voucher' && (
                <Input
                  placeholder="Bank and account number"
                  value={l.payee_account}
                  onChange={(e) => update(i, { payee_account: e.target.value })}
                  required
                />
              )}
              <Input
                placeholder={
                  l.payee_kind === 'input_voucher'
                    ? 'What the vouchers are for, e.g. certified seed and NPK'
                    : 'Purpose, e.g. seed and fertiliser'
                }
                value={l.purpose}
                onChange={(e) => update(i, { purpose: e.target.value })}
                required
                className={l.payee_kind === 'input_voucher' ? 'sm:col-span-2' : undefined}
              />
              {lines.length > 1 && (
                <Button
                  variant="ghost"
                  onClick={() => setLines(lines.filter((_, j) => j !== i))}
                  aria-label="Remove payee"
                >
                  <Trash2 aria-hidden />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      <Button variant="secondary" size="sm" onClick={() => setLines([...lines, blank()])}>
        <Plus aria-hidden /> Add payee
      </Button>

      <div className="space-y-1 rounded-xl px-4 py-3 text-sm ring-1 ring-zinc-950/10">
        <p className={total === target ? 'text-brand-700' : 'text-amber-700'}>
          Total {formatNaira(total)} of {formatNaira(target)}
        </p>
        <p className={cash > cashLimit ? 'text-red-600' : 'text-zinc-500'}>
          Cash to farmers {formatNaira(cash)} (limit {formatNaira(cashLimit)}, 20%)
        </p>
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
        <Button type="submit" busy={busy} disabled={total !== target || cash > cashLimit}>
          Send to trustee
        </Button>
      </div>
    </form>
  );
}
