import { Banknote, Plus, Scale } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthProvider';
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
  SectionTitle,
  Select,
  Table,
  Textarea,
  cx,
} from '../../components/ui';
import { PAYOUT_KIND, formatBps, formatTonnes, isoDate } from '../../lib/cycles';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { formatNaira, parseNaira, toKobo } from '../../lib/money';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { ReceiptKind, SettlementPayout } from '../../lib/types';
import { PaymentActions, PaymentStatus } from '../../components/PaymentCells';
import { useGatewayPayouts } from '../../lib/payouts';
import type { CycleData, TabProps } from './useCycleData';

interface FunderLine {
  name: string;
  contributed: bigint;
  capital: bigint;
  return: bigint;
}

/** The waterfall's totals: from the live preview, or from the payouts once settlement ran. */
interface Waterfall {
  cash: bigint;
  fee: bigint;
  capitalReturned: bigint;
  capitalLoss: bigint;
  funderReturn: bigint;
  farmerSurplus: bigint;
  funders: FunderLine[];
  farmers: { name: string; kg: number | null; amount: bigint }[];
}

function waterfall(data: CycleData): Waterfall | null {
  const s = data.settlement;
  if (s) {
    return {
      cash: toKobo(s.cash),
      fee: toKobo(s.fee),
      capitalReturned: toKobo(s.capital_returned),
      capitalLoss: toKobo(s.capital_loss),
      funderReturn: toKobo(s.funder_return),
      farmerSurplus: toKobo(s.farmer_surplus),
      funders: s.funders.map((f) => ({
        name: f.name,
        contributed: toKobo(f.contributed),
        capital: toKobo(f.capital),
        return: toKobo(f.return),
      })),
      farmers: s.farmers.map((f) => ({ name: f.name, kg: f.kg, amount: toKobo(f.amount) })),
    };
  }
  if (!data.cycle.settlement_started_at) return null;

  const sum = (rows: SettlementPayout[], pick: (p: SettlementPayout) => bigint) =>
    rows.reduce((t, p) => t + pick(p), 0n);
  const of = (kind: SettlementPayout['kind']) => data.payouts.filter((p) => p.kind === kind);
  const live = data.contributions.filter((c) => !c.refund_entry_id);
  const funders = live.map((c) => {
    const p = data.payouts.find((x) => x.contribution_id === c.id);
    const capital = p ? toKobo(p.capital_kobo) : 0n;
    return {
      name: c.funder_name,
      contributed: toKobo(c.amount_kobo),
      capital,
      return: p ? toKobo(p.amount_kobo) - capital : 0n,
    };
  });
  const capitalReturned = funders.reduce((t, f) => t + f.capital, 0n);
  const fee = sum(of('platform_fee'), (p) => toKobo(p.amount_kobo));
  const funderReturn = funders.reduce((t, f) => t + f.return, 0n);
  const farmerSurplus = sum(of('farmer'), (p) => toKobo(p.amount_kobo));
  return {
    cash: fee + capitalReturned + funderReturn + farmerSurplus,
    fee,
    capitalReturned,
    capitalLoss: funders.reduce((t, f) => t + f.contributed - f.capital, 0n),
    funderReturn,
    farmerSurplus,
    funders,
    farmers: of('farmer').map((p) => ({
      name: p.payee_name,
      kg: null,
      amount: toKobo(p.amount_kobo),
    })),
  };
}

const percent = (part: bigint, whole: bigint) =>
  whole === 0n ? 0 : Number((part * 10000n) / whole) / 100;

export function SettlementTab({ data, reload }: TabProps) {
  const role = useAuth().profile?.role;
  const { cycle } = data;
  const trustee = can.actAsTrustee(role);
  const w = waterfall(data);
  const canReceive =
    trustee && ['in_progress', 'harvested'].includes(cycle.status) && !cycle.settlement_started_at;
  const pending = data.payouts.filter((p) => p.status === 'instructed');
  // Where each unpaid payout stands (in a payment file, out through Paystack, no account),
  // for those who can see the trustee's payments; and the trustee pays from it.
  const gateway = useGatewayPayouts(can.readBankFiles(role) && pending.length > 0, cycle.id);
  const refresh = () => {
    gateway.reload();
    reload();
  };

  if (!['in_progress', 'harvested', 'settled'].includes(cycle.status)) {
    return (
      <EmptyState icon={<Scale />} title="Nothing to settle yet">
        Settlement happens after the harvest, once the offtaker has paid the trustee.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      {cycle.status === 'settled' && (
        <Alert tone="success" title="Settled">
          Every payout was made on or before {formatDate(cycle.settled_at)}. The trustee holds
          nothing more for this cycle.
        </Alert>
      )}

      <Card>
        <SectionTitle
          title="Money received"
          description="Payments from the offtaker, and from the insurer after a claim, go to the trustee."
          actions={canReceive && <RecordReceiptButton data={data} reload={reload} />}
        />
        {data.receipts.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing received yet.</p>
        ) : (
          <div className="-mx-5 -mb-5 border-t border-zinc-950/5 sm:-mx-6 sm:-mb-6">
            <Table head={['Received', 'From', 'Type', 'Trustee reference', 'Amount']}>
              {data.receipts.map((r) => (
                <tr key={r.id}>
                  <td className="text-zinc-600">{formatDate(r.received_on)}</td>
                  <td className="font-medium text-zinc-900">{r.payer_name}</td>
                  <td>
                    <Badge tone={r.kind === 'offtake_payment' ? 'green' : 'violet'}>
                      {r.kind === 'offtake_payment' ? 'Harvest payment' : 'Insurance payout'}
                    </Badge>
                  </td>
                  <td className="font-mono text-xs text-zinc-600">{r.trustee_reference}</td>
                  <td className="font-medium text-zinc-900 tabular-nums">
                    {formatNaira(r.amount_kobo)}
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Card>

      {w && <WaterfallCard data={data} w={w} reload={reload} trustee={trustee} />}

      {data.payouts.length > 0 && (
        <Card>
          <SectionTitle
            title="Payouts"
            description={
              pending.length > 0
                ? `${pending.length} still to pay. ${gateway.data?.provider ? "Pay through Paystack where the payee's account is on file, or pay from the bank and record it with the bank's reference." : "Pay each from the bank, then record it with the bank's reference."} Payments in a bank payment file are confirmed from the bank statement.`
                : 'All paid.'
            }
          />
          <div className="-mx-5 -mb-5 border-t border-zinc-950/5 sm:-mx-6 sm:-mb-6">
            <Table head={['Payee', 'Type', 'Amount', 'Status', '']}>
              {data.payouts.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium text-zinc-900">{p.payee_name}</td>
                  <td className="text-zinc-600">
                    {PAYOUT_KIND[p.kind]}
                    {p.kind === 'funder' && toKobo(p.amount_kobo) > toKobo(p.capital_kobo) && (
                      <span className="block text-xs text-zinc-500">
                        {formatNaira(p.capital_kobo)} capital +{' '}
                        {formatNaira(toKobo(p.amount_kobo) - toKobo(p.capital_kobo))} return
                      </span>
                    )}
                  </td>
                  <td className="font-medium text-zinc-900 tabular-nums">
                    {formatNaira(p.amount_kobo)}
                  </td>
                  <td className="min-w-48">
                    <PaymentStatus
                      kind="settlement_payout"
                      id={p.id}
                      paidAt={p.status === 'executed' ? p.paid_at : null}
                      reference={p.trustee_reference}
                      gateway={gateway.data}
                    />
                  </td>
                  <td className="text-right">
                    {p.status === 'instructed' && (
                      <PaymentActions
                        kind="settlement_payout"
                        id={p.id}
                        gateway={gateway.data}
                        trustee={trustee}
                        reload={refresh}
                        record={{
                          rpc: 'confirm_settlement_payout',
                          args: { p_payout_id: p.id },
                          amountKobo: p.amount_kobo,
                          payee: p.payee_name,
                        }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>
      )}

      {w && w.funders.length > 0 && (
        <Card>
          <SectionTitle
            title="Funder statements"
            description={
              cycle.status === 'settled'
                ? 'Final.'
                : 'Estimated from what has been received so far.'
            }
          />
          <div className="-mx-5 -mb-5 border-t border-zinc-950/5 sm:-mx-6 sm:-mb-6">
            <Table head={['Funder', 'Put in', 'Capital back', 'Return', 'Total paid', 'Result']}>
              {w.funders.map((f, i) => {
                const result = f.capital + f.return - f.contributed;
                return (
                  <tr key={i}>
                    <td className="font-medium text-zinc-900">{f.name}</td>
                    <td className="tabular-nums">{formatNaira(f.contributed)}</td>
                    <td className="tabular-nums">{formatNaira(f.capital)}</td>
                    <td className="tabular-nums">{formatNaira(f.return)}</td>
                    <td className="font-medium text-zinc-900 tabular-nums">
                      {formatNaira(f.capital + f.return)}
                    </td>
                    <td
                      className={cx(
                        'font-medium tabular-nums',
                        result < 0n ? 'text-red-700' : 'text-brand-700',
                      )}
                    >
                      {result < 0n ? '−' : '+'}
                      {percent(result < 0n ? -result : result, f.contributed).toFixed(2)}%
                    </td>
                  </tr>
                );
              })}
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}

function WaterfallCard({
  data,
  w,
  reload,
  trustee,
}: {
  data: CycleData;
  w: Waterfall;
  reload: () => void;
  trustee: boolean;
}) {
  const { cycle } = data;
  const steps = [
    {
      label: `Management fee (${formatBps(cycle.management_fee_bps)} of capital)`,
      amount: w.fee,
      bar: 'bg-zinc-400',
    },
    { label: "Funders' capital back", amount: w.capitalReturned, bar: 'bg-sky-500' },
    {
      label: `Funders' return (${formatBps(cycle.funder_profit_share_bps)} of profit)`,
      amount: w.funderReturn,
      bar: 'bg-violet-500',
    },
    { label: 'Farmer surplus (by kg delivered)', amount: w.farmerSurplus, bar: 'bg-brand-500' },
  ];
  const harvestedNotStarted = cycle.status === 'harvested' && !cycle.settlement_started_at;

  return (
    <Card>
      <SectionTitle
        title="Settlement waterfall"
        description={
          cycle.settlement_started_at
            ? `Run on ${formatDate(cycle.settlement_started_at)}.`
            : 'What settlement would pay out if it ran now. Each step is paid in full before the next.'
        }
        actions={
          trustee &&
          harvestedNotStarted && <RunSettlementButton data={data} w={w} reload={reload} />
        }
      />
      <p className="text-sm text-zinc-500">Cash the trustee holds for the cycle</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950 tabular-nums">
        {formatNaira(w.cash)}
      </p>

      {w.cash > 0n && (
        <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-zinc-100">
          {steps.map(
            (s) =>
              s.amount > 0n && (
                <div
                  key={s.label}
                  className={s.bar}
                  style={{ width: `${percent(s.amount, w.cash)}%` }}
                  title={s.label}
                />
              ),
          )}
        </div>
      )}

      <ol className="mt-5 divide-y divide-zinc-950/5 text-sm">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center justify-between gap-4 py-2.5">
            <span className="flex items-center gap-2.5 text-zinc-600">
              <span className={cx('size-2.5 rounded-full', s.bar)} />
              {i + 1}. {s.label}
            </span>
            <span className="font-medium text-zinc-900 tabular-nums">{formatNaira(s.amount)}</span>
          </li>
        ))}
        {w.capitalLoss > 0n && (
          <li className="flex items-center justify-between gap-4 py-2.5 text-red-700">
            <span>Capital not covered: a loss the funders share in proportion</span>
            <span className="font-medium tabular-nums">−{formatNaira(w.capitalLoss)}</span>
          </li>
        )}
      </ol>

      {w.farmers.length > 0 && w.farmerSurplus > 0n && (
        <div className="mt-5 rounded-xl bg-zinc-50 p-4">
          <p className="mb-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Farmer surplus
          </p>
          <ul className="space-y-1.5 text-sm">
            {w.farmers.map((f, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span className="text-zinc-700">
                  {f.name}
                  {f.kg !== null && <span className="text-zinc-500"> · {formatTonnes(f.kg)}</span>}
                </span>
                <span className="font-medium text-zinc-900 tabular-nums">
                  {formatNaira(f.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {cycle.status === 'in_progress' && (
        <p className="mt-4 text-xs text-zinc-500">
          The trustee can settle once the cycle manager completes the harvest.
        </p>
      )}
    </Card>
  );
}

function RecordReceiptButton({ data, reload }: TabProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  // Insurance payouts are recorded on their claim (Offtake & insurance tab), not here.
  const sources = data.offtake.map((o) => ({
    value: `offtake_payment:${o.id}`,
    label: `Harvest payment · ${o.buyer_name}`,
  }));
  const blank = {
    source: sources[0]?.value ?? '',
    amount: '',
    reference: '',
    received_on: isoDate(),
    notes: '',
  };
  const [form, setForm] = useState(blank);
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
    const [kind, sourceId] = form.source.split(':') as [ReceiptKind, string];
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('record_cycle_receipt', {
      p_cycle_id: data.cycle.id,
      p_kind: kind,
      p_source_id: sourceId,
      p_amount_kobo: amount.toString(),
      p_trustee_reference: form.reference,
      p_received_on: form.received_on,
      p_notes: form.notes || null,
    });
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    toast.success(`${formatNaira(amount)} recorded`);
    setOpen(false);
    setForm(blank);
    reload();
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Record receipt
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record money received"
        description="Confirm a buyer's payment that has arrived in the escrow account for this cycle. Insurance payouts are recorded on their claim, under Offtake & insurance."
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="From">
            <Select value={form.source} onChange={set('source')} required>
              {sources.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount (₦)">
              <Input
                value={form.amount}
                onChange={set('amount')}
                required
                inputMode="decimal"
                autoFocus
              />
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
            <Field label="Bank reference" className="sm:col-span-2">
              <Input value={form.reference} onChange={set('reference')} required maxLength={120} />
            </Field>
            <Field label="Notes" hint="Optional" className="sm:col-span-2">
              <Textarea value={form.notes} onChange={set('notes')} rows={2} maxLength={1000} />
            </Field>
          </div>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" busy={busy}>
              Record receipt
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function RunSettlementButton({ data, w, reload }: TabProps & { w: Waterfall }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    const { data: n, error } = await supabase.rpc('settle_cycle', { p_cycle_id: data.cycle.id });
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    toast.success(n ? `Settlement run: ${n} payout(s) to make` : 'Settled');
    setOpen(false);
    reload();
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Banknote aria-hidden /> Run settlement
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Run settlement?"
        description="This fixes the payouts below. No more money can be recorded for the cycle afterwards."
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-600">
            {formatNaira(w.cash)} to pay out: {formatNaira(w.fee)} fee,{' '}
            {formatNaira(w.capitalReturned + w.funderReturn)} to {w.funders.length} funder(s) and{' '}
            {formatNaira(w.farmerSurplus)} to farmers.
            {w.capitalLoss > 0n &&
              ` Funders bear a loss of ${formatNaira(w.capitalLoss)} between them.`}
          </p>
          {data.receipts.length === 0 && (
            <Alert tone="warning">No payment from the offtaker has been recorded yet.</Alert>
          )}
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Back
            </Button>
            <Button busy={busy} onClick={run}>
              Run settlement
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
