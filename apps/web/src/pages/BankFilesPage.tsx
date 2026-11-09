import { Download, FileUp, Landmark, RotateCcw, Upload } from 'lucide-react';
import { useState, type ChangeEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../components/Toast';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  SectionTitle,
  Spinner,
  Table,
  Tabs,
  Textarea,
} from '../components/ui';
import {
  LINE_STATUS,
  PAYMENT_KIND,
  parseStatement,
  paymentFileCsv,
  simulatedStatementCsv,
  type BatchItem,
  type StatementLine,
  type StatementLineStatus,
  type TrusteePayment,
} from '../lib/bankfiles';
import { demo } from '../lib/demo';
import { errorMessage } from '../lib/errors';
import { formatDate } from '../lib/format';
import { formatNaira, toKobo } from '../lib/money';
import { download } from '../lib/programmes';
import { can } from '../lib/roles';
import { supabase } from '../lib/supabase';
import { useAsync } from '../lib/useAsync';

type Tab = 'payments' | 'statements';

interface Line {
  id: string;
  value_date: string;
  narration: string;
  bank_reference: string | null;
  amount_kobo: string;
  status: StatementLineStatus;
  note: string | null;
}

interface Import {
  id: string;
  file_name: string;
  imported_at: string;
  summary: Record<string, number>;
}

const fileDate = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

async function batchItems(batchId: string): Promise<BatchItem[]> {
  const { data, error } = await supabase
    .from('payment_batch_items')
    .select('*')
    .eq('batch_id', batchId)
    .is('withdrawn_at', null)
    .order('reference');
  if (error) throw error;
  return data as BatchItem[];
}

async function downloadBatch(batchId: string) {
  download(
    `agrowth-payments-${fileDate()}-${batchId.slice(0, 6)}.csv`,
    paymentFileCsv(await batchItems(batchId)),
  );
}

/**
 * The trustee's bank desk: payment files out to the bank, statements back in. Auditors and
 * compliance can look; only the trustee acts.
 */
export function BankFilesPage() {
  const role = useAuth().profile?.role;
  const isTrustee = can.actAsTrustee(role);
  const [tab, setTab] = useState<Tab>('payments');

  const payments = useAsync(async () => {
    const { data, error } = await supabase.rpc('trustee_payments');
    if (error) throw error;
    return data as TrusteePayment[];
  }, []);
  const lines = useAsync(async () => {
    const { data, error } = await supabase
      .from('bank_statement_lines')
      .select('id, value_date, narration, bank_reference, amount_kobo, status, note')
      .in('status', ['needs_review', 'unmatched'])
      .order('value_date');
    if (error) throw error;
    return data as Line[];
  }, []);
  const reload = () => {
    payments.reload();
    lines.reload();
  };

  const waiting = (payments.data ?? []).filter((p) => !p.problem && !p.batch_id);
  const attention = lines.data?.length ?? 0;

  return (
    <>
      <PageHeader
        title="Bank files"
        description="Payments go to the bank as a bulk-payment file; the bank's statement comes back and confirms them. Deposits that quote a pledge reference are matched to the pledge."
        actions={
          isTrustee && demo.enabled ? (
            <SimulatedStatement payments={payments.data ?? []} />
          ) : undefined
        }
      />
      <Tabs
        tabs={[
          { id: 'payments', label: 'Payments', count: waiting.length },
          { id: 'statements', label: 'Statements', count: attention },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'payments' ? (
        payments.loading && !payments.data ? (
          <Spinner />
        ) : payments.error ? (
          <Alert>{errorMessage(payments.error)}</Alert>
        ) : (
          <Payments payments={payments.data!} isTrustee={isTrustee} onChange={reload} />
        )
      ) : (
        <Statements
          lines={lines.data}
          error={lines.error}
          isTrustee={isTrustee}
          onChange={reload}
        />
      )}
    </>
  );
}

// ---------- Payments ----------

function Payments({
  payments,
  isTrustee,
  onChange,
}: {
  payments: TrusteePayment[];
  isTrustee: boolean;
  onChange: () => void;
}) {
  const toast = useToast();
  const waiting = payments.filter((p) => !p.problem && !p.batch_id);
  const withBank = payments.filter((p) => p.batch_id);
  const byHand = payments.filter((p) => p.problem && !p.batch_id);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = waiting.filter((p) => picked.has(p.item_id));
  const total = chosen.reduce((s, p) => s + toKobo(p.amount_kobo), 0n);
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const createFile = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data, error } = await supabase.rpc('create_payment_batch', {
        p_items: chosen.map((p) => ({ kind: p.kind, item_id: p.item_id })),
      });
      if (error) throw error;
      await downloadBatch(data as string);
      toast.success(`Payment file made: ${chosen.length} payment(s), ${formatNaira(total)}`);
      setPicked(new Set());
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const batches = [...new Set(withBank.map((p) => p.batch_id!))];

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle
          title="Waiting for a payment file"
          description="Choose payments, make the file, and upload it to the trustee account's bulk payments. Each narration starts with the payment's AGP reference, which is how the statement confirms it."
          actions={
            isTrustee && waiting.length > 0 ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setPicked(
                      picked.size === waiting.length
                        ? new Set()
                        : new Set(waiting.map((p) => p.item_id)),
                    )
                  }
                >
                  {picked.size === waiting.length ? 'Clear' : 'Select all'}
                </Button>
                <Button busy={busy} disabled={chosen.length === 0} onClick={createFile}>
                  <Download aria-hidden /> Make payment file
                  {chosen.length > 0 &&
                    ` (${chosen.length}, ${formatNaira(total, { compact: true })})`}
                </Button>
              </>
            ) : undefined
          }
        />
        {error && (
          <div className="mb-3">
            <Alert>{error}</Alert>
          </div>
        )}
        {waiting.length === 0 ? (
          <EmptyState>Nothing waiting. New payments appear here when they're due.</EmptyState>
        ) : (
          <PaymentTable
            rows={waiting}
            lead={(p) =>
              isTrustee ? (
                <input
                  type="checkbox"
                  className="size-4 rounded text-brand-600"
                  checked={picked.has(p.item_id)}
                  onChange={() => toggle(p.item_id)}
                  aria-label={`Include ${p.reference}`}
                />
              ) : null
            }
          />
        )}
      </section>

      <section>
        <SectionTitle
          title="With the bank"
          description="In a payment file, not yet on a statement. If the bank rejects one, withdraw it and it goes back to waiting."
        />
        {batches.length === 0 ? (
          <EmptyState>No payment files out.</EmptyState>
        ) : (
          <div className="space-y-4">
            {batches.map((b) => {
              const rows = withBank.filter((p) => p.batch_id === b);
              return (
                <div key={b} className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-zinc-600">
                      File of {formatDate(rows[0].batch_created_at)} · {rows.length} payment(s) ·{' '}
                      {formatNaira(rows.reduce((s, p) => s + toKobo(p.amount_kobo), 0n))}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        downloadBatch(b).catch((err) => toast.error(errorMessage(err)))
                      }
                    >
                      <Download aria-hidden /> Download again
                    </Button>
                  </div>
                  <PaymentTable
                    rows={rows}
                    action={(p) =>
                      isTrustee ? <WithdrawButton payment={p} onDone={onChange} /> : null
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <SectionTitle
          title="Pay by hand"
          description="These can't go in a file. Pay them directly and confirm each on its cycle, as before."
        />
        {byHand.length === 0 ? (
          <EmptyState>None.</EmptyState>
        ) : (
          <PaymentTable rows={byHand} showProblem />
        )}
      </section>
    </div>
  );
}

function PaymentTable({
  rows,
  lead,
  action,
  showProblem = false,
}: {
  rows: TrusteePayment[];
  lead?: (p: TrusteePayment) => ReactNode;
  action?: (p: TrusteePayment) => ReactNode;
  showProblem?: boolean;
}) {
  return (
    <Table
      head={[
        ...(lead ? [''] : []),
        'Reference',
        'Payee',
        showProblem ? 'Why by hand' : 'Account',
        'Cycle',
        'Amount',
        ...(action ? [''] : []),
      ]}
    >
      {rows.map((p) => (
        <tr key={`${p.kind}:${p.item_id}`}>
          {lead && <td className="w-8">{lead(p)}</td>}
          <td className="font-mono text-xs whitespace-nowrap">{p.reference}</td>
          <td>
            <span className="font-medium text-zinc-900">{p.payee_name}</span>
            <span className="block text-xs text-zinc-500">{PAYMENT_KIND[p.kind]}</span>
          </td>
          <td className="text-zinc-600">
            {showProblem ? (
              <span className="text-amber-800">{p.problem}</span>
            ) : (
              <>
                {p.bank_name} <span className="font-mono">{p.account_number}</span>
                <span className="block text-xs text-zinc-500">{p.account_name}</span>
              </>
            )}
          </td>
          <td>
            <Link to={`/cycles/${p.cycle_id}`} className="hover:underline">
              {p.cycle_code}
            </Link>
          </td>
          <td className="text-right whitespace-nowrap tabular-nums">
            {formatNaira(p.amount_kobo)}
          </td>
          {action && <td className="text-right">{action(p)}</td>}
        </tr>
      ))}
    </Table>
  );
}

function WithdrawButton({ payment, onDone }: { payment: TrusteePayment; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withdraw = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('withdraw_batch_payment', {
      p_batch_id: payment.batch_id,
      p_kind: payment.kind,
      p_item_id: payment.item_id,
      p_reason: reason,
    });
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    toast.success(`${payment.reference} is back with the payments waiting for a file`);
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
        title={`Withdraw ${payment.reference}`}
        description={`Only if the bank did not pay ${payment.payee_name}. It goes back to the payments waiting for a file.`}
      >
        <div className="space-y-4">
          <Field label="Why">
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. The bank rejected it: account name mismatch"
            />
          </Field>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button busy={busy} disabled={!reason.trim()} onClick={withdraw}>
              Withdraw
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ---------- Statements ----------

function Statements({
  lines,
  error,
  isTrustee,
  onChange,
}: {
  lines: Line[] | undefined;
  error: unknown;
  isTrustee: boolean;
  onChange: () => void;
}) {
  const imports = useAsync(async () => {
    const { data, error } = await supabase
      .from('bank_statement_imports')
      .select('id, file_name, imported_at, summary')
      .order('imported_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    return data as Import[];
  }, []);
  const changed = () => {
    imports.reload();
    onChange();
  };

  return (
    <div className="space-y-8">
      {isTrustee && <ImportStatement onDone={changed} />}

      <section>
        <SectionTitle
          title="Needs attention"
          description="Lines the statement couldn't settle on its own. Record a deposit or receipt on its cycle with the bank reference, then try again; or dismiss the line with a note."
        />
        {error ? (
          <Alert>{errorMessage(error)}</Alert>
        ) : !lines ? (
          <Spinner />
        ) : lines.length === 0 ? (
          <EmptyState>Every imported line is accounted for.</EmptyState>
        ) : (
          <Table head={['Date', 'Narration', 'Amount', 'Status', '']}>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap">{formatDate(l.value_date)}</td>
                <td className="min-w-64">
                  <span className="text-zinc-900">{l.narration}</span>
                  {l.bank_reference && (
                    <span className="block font-mono text-xs text-zinc-500">
                      {l.bank_reference}
                    </span>
                  )}
                  {l.note && <span className="mt-1 block text-xs text-zinc-600">{l.note}</span>}
                </td>
                <td
                  className={`text-right whitespace-nowrap tabular-nums ${
                    toKobo(l.amount_kobo) < 0n ? 'text-zinc-900' : 'text-brand-800'
                  }`}
                >
                  {formatNaira(l.amount_kobo)}
                </td>
                <td>
                  <Badge tone={LINE_STATUS[l.status].tone} dot>
                    {LINE_STATUS[l.status].label}
                  </Badge>
                </td>
                <td className="text-right whitespace-nowrap">
                  {isTrustee && <LineActions line={l} onDone={changed} />}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section>
        <SectionTitle title="Recent imports" />
        {imports.loading && !imports.data ? (
          <Spinner />
        ) : imports.error ? (
          <Alert>{errorMessage(imports.error)}</Alert>
        ) : imports.data!.length === 0 ? (
          <EmptyState>No statements imported yet.</EmptyState>
        ) : (
          <Table
            head={['File', 'Imported', 'New lines', 'Confirmed', 'Needs attention', 'Skipped']}
          >
            {imports.data!.map((i) => (
              <tr key={i.id}>
                <td className="font-medium text-zinc-900">{i.file_name}</td>
                <td className="whitespace-nowrap">{formatDate(i.imported_at)}</td>
                <td className="tabular-nums">{i.summary.lines ?? 0}</td>
                <td className="tabular-nums">
                  {(i.summary.confirmed ?? 0) + (i.summary.already_recorded ?? 0)}
                </td>
                <td className="tabular-nums">
                  {(i.summary.needs_review ?? 0) + (i.summary.unmatched ?? 0)}
                </td>
                <td className="tabular-nums" title="Already imported from an earlier statement">
                  {i.summary.duplicates ?? 0}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}

function ImportStatement({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<{
    name: string;
    lines: StatementLine[];
    problems: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    setError(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) {
      setError('Export the statement from the bank as CSV (Excel can save a statement as CSV).');
      return;
    }
    setFile({ name: f.name, ...parseStatement(await f.text()) });
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc('import_bank_statement', {
      p_file_name: file.name,
      p_lines: file.lines,
    });
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    const s = data as Record<string, number>;
    const done = s.confirmed + s.already_recorded;
    const open = s.needs_review + s.unmatched;
    toast.success(
      `${s.lines} new line(s): ${done} confirmed or already recorded, ${open} need attention` +
        (s.duplicates ? `, ${s.duplicates} already imported` : ''),
    );
    setFile(null);
    onDone();
  };

  const moneyIn = file?.lines.reduce(
    (s, l) => (toKobo(l.amount_kobo) > 0n ? s + toKobo(l.amount_kobo) : s),
    0n,
  );
  const moneyOut = file?.lines.reduce(
    (s, l) => (toKobo(l.amount_kobo) < 0n ? s - toKobo(l.amount_kobo) : s),
    0n,
  );

  return (
    <Card>
      <SectionTitle
        title="Import a statement"
        description="The trustee account's statement as CSV, from the bank's internet banking. Overlapping statements are fine: lines already imported are skipped."
        actions={
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-zinc-800 shadow-sm ring-1 ring-zinc-950/10 hover:bg-zinc-50 [&_svg]:size-4">
            <FileUp aria-hidden /> Choose CSV
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={pick} />
          </label>
        }
      />
      {file && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-700">
            <span className="font-medium">{file.name}</span>: {file.lines.length} transaction(s),{' '}
            {formatNaira(moneyIn)} in, {formatNaira(moneyOut)} out.
          </p>
          {file.problems.length > 0 && (
            <Alert tone="warning" title="Some rows couldn't be read and will be left out">
              <ul className="list-disc pl-5">
                {file.problems.slice(0, 5).map((p) => (
                  <li key={p}>{p}</li>
                ))}
                {file.problems.length > 5 && <li>and {file.problems.length - 5} more</li>}
              </ul>
            </Alert>
          )}
          <div className="flex gap-2">
            <Button busy={busy} disabled={file.lines.length === 0} onClick={run}>
              <Upload aria-hidden /> Import and match
            </Button>
            <Button variant="ghost" onClick={() => setFile(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
    </Card>
  );
}

function LineActions({ line, onDone }: { line: Line; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'retry' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const retry = async () => {
    setBusy('retry');
    const { data, error } = await supabase.rpc('retry_statement_line', { p_line_id: line.id });
    setBusy(null);
    if (error) toast.error(errorMessage(error));
    else {
      const s = data as StatementLineStatus;
      (s === 'confirmed' || s === 'already_recorded' ? toast.success : toast.error)(
        `Tried again: ${LINE_STATUS[s].label.toLowerCase()}`,
      );
      onDone();
    }
  };
  const dismiss = async () => {
    setBusy('dismiss');
    setError(null);
    const { error } = await supabase.rpc('dismiss_statement_line', {
      p_line_id: line.id,
      p_note: note,
    });
    setBusy(null);
    if (error) setError(errorMessage(error));
    else {
      setOpen(false);
      onDone();
    }
  };

  return (
    <span className="inline-flex gap-1">
      <Button size="sm" variant="secondary" busy={busy === 'retry'} onClick={retry}>
        <RotateCcw aria-hidden /> Try again
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Dismiss
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Dismiss this line"
        description={`${formatNaira(line.amount_kobo)} on ${formatDate(line.value_date)}: ${line.narration}`}
      >
        <div className="space-y-4">
          <Field label="What is it?" hint="Kept with the line, for the auditors.">
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Bank charges; or: transfer between the trustee's own accounts"
            />
          </Field>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button busy={busy === 'dismiss'} disabled={!note.trim()} onClick={dismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      </Modal>
    </span>
  );
}

// ---------- Simulated bank ----------

/**
 * Demo and development only: a statement as the bank would send it after paying every
 * payment that's with the bank and receiving every pending pledge, to import back.
 */
function SimulatedStatement({ payments }: { payments: TrusteePayment[] }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from('investment_pledges')
        .select('reference, amount_kobo, investor_profiles(legal_name)')
        .eq('status', 'pending');
      if (error) throw error;
      const pledges = (
        data as unknown as {
          reference: string;
          amount_kobo: string;
          investor_profiles: { legal_name: string } | null;
        }[]
      ).map((p) => ({
        reference: p.reference,
        amount_kobo: String(p.amount_kobo),
        investor: p.investor_profiles?.legal_name ?? 'Investor',
      }));
      const out = payments
        .filter((p) => p.batch_id)
        .map((p) => ({
          reference: p.reference,
          account_name: p.account_name ?? p.payee_name,
          amount_kobo: String(p.amount_kobo),
        }));
      if (out.length === 0 && pledges.length === 0) {
        toast.error('Nothing for the simulated bank to pay or receive: make a payment file first.');
        return;
      }
      download(`simulated-bank-statement-${fileDate()}.csv`, simulatedStatementCsv(out, pledges));
      toast.success(
        `Simulated statement: ${out.length} payment(s) made, ${pledges.length} pledge payment(s) received. Import it under Statements.`,
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="secondary" busy={busy} onClick={make} title="Demo only: no bank involved">
      <Landmark aria-hidden /> Simulated bank statement
    </Button>
  );
}
