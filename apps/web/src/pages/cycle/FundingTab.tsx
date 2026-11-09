import { Eye, Landmark, Plus, RotateCcw } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../components/Toast';
import { EditBankAccount } from '../../components/BankAccountForm';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Progress,
  SectionTitle,
  Select,
  Table,
} from '../../components/ui';
import { isoDate } from '../../lib/cycles';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { PLEDGE_STATUS } from '../../lib/investing';
import { formatNaira, parseNaira, ratio, toKobo } from '../../lib/money';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { PledgeRow, TabProps } from './useCycleData';

export function FundingTab({ data, reload }: TabProps) {
  const role = useAuth().profile?.role;
  const { cycle } = data;
  const remaining = toKobo(cycle.target_amount_kobo) - toKobo(data.raisedKobo);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-zinc-500">Held by the trustee for this cycle</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950 tabular-nums">
              {formatNaira(data.raisedKobo)}
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              of {formatNaira(cycle.target_amount_kobo)}
              {remaining > 0n &&
                cycle.status === 'open_for_funding' &&
                ` · ${formatNaira(remaining)} to go`}
            </p>
          </div>
          {can.actAsTrustee(role) && cycle.status === 'open_for_funding' && (
            <RecordFundingButton data={data} reload={reload} />
          )}
        </div>
        <Progress value={ratio(data.raisedKobo, cycle.target_amount_kobo)} className="mt-5 h-2.5" />
        <p className="mt-4 text-xs text-zinc-500">
          The platform never holds money. Funders pay the trustee's escrow account directly; the
          trustee confirms each deposit here, which records it in this cycle's ledger.
        </p>
        {cycle.funding_source !== 'programme' &&
          cycle.status !== 'draft' &&
          cycle.status !== 'pending_approval' && (
            <Link
              to={`/invest/${cycle.id}`}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
            >
              <Eye className="size-4" aria-hidden /> See the investor listing
            </Link>
          )}
      </Card>

      {data.pledges.length > 0 && <Pledges pledges={data.pledges} reload={reload} />}

      {data.contributions.length === 0 ? (
        <EmptyState icon={<Landmark />} title="No deposits yet">
          {cycle.status === 'open_for_funding'
            ? 'Deposits appear here once the trustee confirms them.'
            : 'The cycle opens for funding once compliance approves it.'}
        </EmptyState>
      ) : (
        <Table head={['Funder', 'Type', 'Received', 'Trustee reference', 'Amount', '']}>
          {data.contributions.map((c) => (
            <tr key={c.id}>
              <td>
                <span className="font-medium text-zinc-900">{c.funder_name}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  {c.investor_id
                    ? 'Paid back to the account in their investor profile'
                    : c.payout_account_number
                      ? `Paid back to ${c.payout_bank_name} ${c.payout_account_number}`
                      : 'No payout account on file'}
                  {!c.investor_id && !c.refund_entry_id && can.actAsTrustee(role) && (
                    <EditBankAccount
                      title={`Where ${c.funder_name} is paid back`}
                      description="The account their capital and returns are paid to at settlement."
                      current={{
                        bank_name: c.payout_bank_name,
                        account_number: c.payout_account_number,
                        account_name: c.payout_account_name,
                      }}
                      defaultName={c.funder_name}
                      rpc="set_contribution_payout_account"
                      args={{ p_contribution_id: c.id }}
                      onSaved={reload}
                    />
                  )}
                </span>
              </td>
              <td className="text-zinc-600">
                {c.funder_kind === 'programme' ? 'Programme' : 'Investor'}
              </td>
              <td className="text-zinc-600">{formatDate(c.received_on)}</td>
              <td className="font-mono text-xs text-zinc-600">{c.trustee_reference}</td>
              <td className="font-medium text-zinc-900 tabular-nums">
                {formatNaira(c.amount_kobo)}
              </td>
              <td className="text-right">
                {c.refund_entry_id && (
                  <Badge tone="red" dot>
                    Refunded
                  </Badge>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

/** Investors' pledges: the trustee matches each bank payment to its reference and confirms it. */
function Pledges({ pledges, reload }: { pledges: PledgeRow[]; reload: () => void }) {
  const role = useAuth().profile?.role;
  const today = isoDate();
  return (
    <div>
      <SectionTitle
        title="Investor pledges"
        description="Investors pledge in the portal and pay the escrow account quoting their reference. A pending pledge holds its share of the target until its pay-by date."
      />
      <Table head={['Investor', 'Reference', 'Pledged', 'Pay by', 'Amount', 'Status', '']}>
        {pledges.map((p) => {
          const lapsed = p.status === 'pending' && p.pay_by < today;
          const status = PLEDGE_STATUS[lapsed ? 'lapsed' : p.status];
          const coolingOff = new Date(p.cooling_off_ends_at) > new Date();
          return (
            <tr key={p.id}>
              <td className="font-medium text-zinc-900">
                {p.investor_profiles?.legal_name ?? 'Investor'}
              </td>
              <td className="font-mono text-xs text-zinc-600">{p.reference}</td>
              <td className="text-zinc-600">{formatDate(p.pledged_at)}</td>
              <td className="text-zinc-600">{formatDate(p.pay_by)}</td>
              <td className="font-medium text-zinc-900 tabular-nums">
                {formatNaira(p.amount_kobo)}
              </td>
              <td>
                <Badge tone={status.tone} dot>
                  {status.label}
                </Badge>
                {p.status === 'pending' && !lapsed && coolingOff && (
                  <p className="mt-1 text-xs text-zinc-500">
                    Cooling-off until{' '}
                    {new Date(p.cooling_off_ends_at).toLocaleString('en-NG', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                )}
              </td>
              <td className="text-right">
                {can.actAsTrustee(role) && p.status === 'pending' && !lapsed && (
                  <ConfirmPledgeButton pledge={p} disabled={coolingOff} reload={reload} />
                )}
              </td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}

function ConfirmPledgeButton({
  pledge,
  disabled,
  reload,
}: {
  pledge: PledgeRow;
  disabled: boolean;
  reload: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState('');
  const [receivedOn, setReceivedOn] = useState(isoDate());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('confirm_pledge_payment', {
      p_pledge_id: pledge.id,
      p_trustee_reference: reference,
      p_received_on: receivedOn,
    });
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    toast.success(`${formatNaira(pledge.amount_kobo)} added to the cycle`);
    setOpen(false);
    reload();
  };

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? 'The investor is still in their cooling-off period' : undefined}
      >
        Confirm payment
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Confirm ${formatNaira(pledge.amount_kobo)} from ${pledge.investor_profiles?.legal_name ?? 'the investor'}`}
        description={`Only once a transfer quoting ${pledge.reference} has arrived in the escrow account. This records it in the cycle's ledger.`}
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bank reference">
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                required
                maxLength={120}
                autoFocus
              />
            </Field>
            <Field label="Received on">
              <Input
                type="date"
                min={pledge.pledged_at.slice(0, 10)}
                max={pledge.pay_by < isoDate() ? pledge.pay_by : isoDate()}
                value={receivedOn}
                onChange={(e) => setReceivedOn(e.target.value)}
                required
              />
            </Field>
          </div>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" busy={busy}>
              Confirm payment
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function RecordFundingButton({ data, reload }: TabProps) {
  const toast = useToast();
  const { cycle } = data;
  const [open, setOpen] = useState(false);
  const fixedKind = cycle.funding_source === 'blended' ? null : cycle.funding_source;
  const [form, setForm] = useState({
    funder_name: '',
    funder_kind: fixedKind ?? 'investor',
    amount: '',
    reference: '',
    received_on: isoDate(),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = parseNaira(form.amount);
    if (!amount) {
      setError('Enter the amount received in naira');
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('record_funding', {
      p_cycle_id: cycle.id,
      p_funder_name: form.funder_name,
      p_funder_kind: form.funder_kind,
      p_amount_kobo: amount.toString(),
      p_trustee_reference: form.reference,
      p_received_on: form.received_on,
    });
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    toast.success(`${formatNaira(amount)} recorded`);
    setOpen(false);
    setForm({ ...form, funder_name: '', amount: '', reference: '' });
    reload();
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Record deposit
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record a deposit"
        description="Confirm money that has arrived in the escrow account for this cycle."
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Funder">
            <Input
              value={form.funder_name}
              onChange={set('funder_name')}
              required
              maxLength={200}
              autoFocus
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Funder type">
              <Select value={form.funder_kind} onChange={set('funder_kind')} disabled={!!fixedKind}>
                <option value="investor">Investor</option>
                <option value="programme">Programme</option>
              </Select>
            </Field>
            <Field label="Amount (₦)">
              <Input value={form.amount} onChange={set('amount')} required inputMode="decimal" />
            </Field>
            <Field label="Bank reference">
              <Input value={form.reference} onChange={set('reference')} required maxLength={120} />
            </Field>
            <Field label="Received on">
              <Input
                type="date"
                max={isoDate()}
                value={form.received_on}
                onChange={set('received_on')}
                required
              />
            </Field>
          </div>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" busy={busy}>
              Record deposit
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function RefundButton({ cycleId, reload }: { cycleId: string; reload: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refund = async () => {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc('refund_cycle', { p_cycle_id: cycleId });
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    toast.success(`${data} funder(s) refunded in full`);
    setOpen(false);
    reload();
  };

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden /> Refund all funders
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Refund every funder in full?"
        description="Confirm only after you have returned the money from escrow. Each deposit is reversed in the ledger and the cycle closes as refunded."
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
          <Button variant="danger" busy={busy} onClick={refund}>
            Confirm refunds
          </Button>
        </div>
      </Modal>
    </>
  );
}
