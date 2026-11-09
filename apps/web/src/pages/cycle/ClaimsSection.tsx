import { Check, CloudRain, FileText, ShieldAlert, Upload } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../components/Toast';
import {
  Alert,
  Badge,
  Button,
  Card,
  DescriptionList,
  EmptyState,
  Field,
  Input,
  Modal,
  SectionTitle,
  Select,
  Spinner,
  Textarea,
  cx,
} from '../../components/ui';
import {
  CLAIM_CAUSE,
  CLAIM_STATUS,
  CLAIM_STEPS,
  isOpen,
  loadClaims,
  stepReached,
  type ClaimCause,
  type InsuranceClaim,
} from '../../lib/claims';
import { isoDate, openFile, uploadFile } from '../../lib/cycles';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { formatNaira, nairaInput, parseNaira } from '../../lib/money';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import { useAsync } from '../../lib/useAsync';
import type { TabProps } from './useCycleData';

const BUCKET = 'claim-documents';

/** A cycle's insurance claims: report a loss, and follow each claim to payment. */
export function ClaimsSection({ data, reload }: TabProps) {
  const role = useAuth().profile?.role;
  const claims = useAsync(() => loadClaims(data.cycle.id), [data.cycle.id]);
  const [reporting, setReporting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const claimable = ['funded', 'in_progress', 'harvested'].includes(data.cycle.status);
  const refresh = () => {
    claims.reload();
    reload();
  };
  const open = claims.data?.find((c) => c.id === openId) ?? null;

  if (data.insurance.length === 0 || data.cycle.status === 'draft') return null;
  return (
    <section className="xl:col-span-2">
      <SectionTitle
        title="Insurance claims"
        description="Report a loss as soon as it's seen. The weather at the farms and their latest field visits are kept with the claim as evidence."
        actions={
          claimable && can.reportClaims(role) ? (
            <Button size="sm" onClick={() => setReporting(true)}>
              <ShieldAlert aria-hidden /> Report a loss
            </Button>
          ) : undefined
        }
      />
      {claims.loading && !claims.data ? (
        <Spinner />
      ) : claims.error ? (
        <Alert>{errorMessage(claims.error)}</Alert>
      ) : claims.data!.length === 0 ? (
        <EmptyState icon={<ShieldAlert />} title="No claims">
          Nothing has been claimed on this cycle's insurance.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {claims.data!.map((c) => (
            <Card key={c.id}>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-zinc-900">
                    {CLAIM_CAUSE[c.cause]}{' '}
                    <span className="font-mono text-xs font-normal text-zinc-500">
                      {c.reference}
                    </span>
                  </p>
                  <p className="text-xs text-zinc-500">
                    From {formatDate(c.loss_from)}
                    {c.loss_to ? ` to ${formatDate(c.loss_to)}` : ', still going on'} ·{' '}
                    {c.insurance_claim_farms.length} farm
                    {c.insurance_claim_farms.length === 1 ? '' : 's'}
                  </p>
                </div>
                <Badge tone={CLAIM_STATUS[c.status].tone} dot>
                  {CLAIM_STATUS[c.status].label}
                </Badge>
              </div>
              <Steps claim={c} />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-zinc-600 tabular-nums">
                  {c.paid_kobo
                    ? `${formatNaira(c.paid_kobo)} paid`
                    : c.approved_kobo
                      ? `${formatNaira(c.approved_kobo)} approved`
                      : c.estimated_loss_kobo
                        ? `About ${formatNaira(c.estimated_loss_kobo, { compact: true })} estimated`
                        : ''}
                </span>
                <Button size="sm" variant="secondary" onClick={() => setOpenId(c.id)}>
                  Open
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={reporting} onClose={() => setReporting(false)} title="Report a loss" wide>
        {reporting && (
          <ReportForm
            data={data}
            onDone={(id) => {
              setReporting(false);
              if (id) {
                refresh();
                setOpenId(id);
              }
            }}
          />
        )}
      </Modal>
      <Modal
        open={open !== null}
        onClose={() => setOpenId(null)}
        title={open ? `${CLAIM_CAUSE[open.cause]} claim ${open.reference}` : ''}
        wide
      >
        {open && <ClaimDetail claim={open} data={data} onChange={refresh} />}
      </Modal>
    </section>
  );
}

/** Reported → Insurer notified → Assessed → Paid, ticked as far as the claim got. */
function Steps({ claim }: { claim: InsuranceClaim }) {
  const reached = stepReached(claim);
  const closed = claim.status === 'rejected' || claim.status === 'withdrawn';
  return (
    <ol className="flex items-center gap-1 text-[11px] text-zinc-500" aria-label="Claim progress">
      {CLAIM_STEPS.map((s, i) => (
        <li key={s} className="flex min-w-0 flex-1 items-center gap-1">
          <span
            className={cx(
              'grid size-4 shrink-0 place-items-center rounded-full',
              i <= reached && !(closed && i > reached)
                ? 'bg-brand-600 text-white'
                : 'bg-zinc-100 text-zinc-400',
            )}
            aria-hidden
          >
            {i <= reached && <Check className="size-2.5" />}
          </span>
          <span className={cx('truncate', i <= reached && 'text-zinc-800')}>
            {CLAIM_STATUS[s].label}
          </span>
          {i < CLAIM_STEPS.length - 1 && <span className="h-px flex-1 bg-zinc-200" />}
        </li>
      ))}
    </ol>
  );
}

// ---------- Reporting ----------

function ReportForm({ data, onDone }: { data: TabProps['data']; onDone: (id?: string) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    cause: 'drought' as ClaimCause,
    loss_from: isoDate(),
    loss_to: '',
    ongoing: true,
    description: '',
    estimate: '',
  });
  const [loss, setLoss] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set =
    (k: 'cause' | 'loss_from' | 'loss_to' | 'description' | 'estimate') =>
    (e: { target: { value: string } }) =>
      setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const farms = Object.entries(loss)
      .filter(([, pct]) => pct.trim() !== '')
      .map(([farm_id, pct]) => ({ farm_id, loss_pct: Number(pct) }));
    if (farms.length === 0) {
      setError('Enter the estimated loss for at least one farm');
      return;
    }
    const estimate = form.estimate.trim() ? parseNaira(form.estimate) : null;
    if (form.estimate.trim() && estimate === null) {
      setError('Enter the estimated loss in naira');
      return;
    }
    setBusy(true);
    setError(null);
    const { data: id, error } = await supabase.rpc('report_insurance_claim', {
      p_cycle_id: data.cycle.id,
      p_cause: form.cause,
      p_loss_from: form.loss_from,
      p_loss_to: form.ongoing ? null : form.loss_to || null,
      p_description: form.description,
      p_farms: farms,
      p_estimated_loss_kobo: estimate?.toString() ?? null,
    });
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    toast.success('Loss reported. Next, tell the insurer.');
    onDone(id as string);
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Cause">
          <Select value={form.cause} onChange={set('cause')}>
            {(Object.keys(CLAIM_CAUSE) as ClaimCause[]).map((c) => (
              <option key={c} value={c}>
                {CLAIM_CAUSE[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Began on">
          <Input
            type="date"
            value={form.loss_from}
            max={isoDate()}
            onChange={set('loss_from')}
            required
          />
        </Field>
        <Field label="Ended on">
          {form.ongoing ? (
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => setForm({ ...form, ongoing: false })}
            >
              Still going on
            </Button>
          ) : (
            <Input
              type="date"
              value={form.loss_to}
              min={form.loss_from}
              max={isoDate()}
              onChange={set('loss_to')}
              required
            />
          )}
        </Field>
      </div>
      <Field label="What happened" hint="What was seen, where, and how bad. At least a sentence.">
        <Textarea
          rows={3}
          value={form.description}
          onChange={set('description')}
          required
          minLength={20}
          maxLength={3000}
          placeholder="e.g. No rain for five weeks during flowering; plants wilting by midday on every farm."
        />
      </Field>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-zinc-800">
          Farms hit, and the share of each crop thought lost
        </legend>
        {data.farms.length === 0 ? (
          <p className="text-sm text-zinc-500">Your role can't see this cycle's farms.</p>
        ) : (
          <div className="max-h-64 divide-y divide-zinc-950/5 overflow-y-auto rounded-xl ring-1 ring-zinc-950/10">
            {data.farms.map((f) => (
              <label
                key={f.id}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-medium text-zinc-900">{f.name ?? 'Farm'}</span>
                  <span className="block truncate text-xs text-zinc-500">{f.farmer_name}</span>
                </span>
                <span className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    inputMode="numeric"
                    value={loss[f.id] ?? ''}
                    onChange={(e) => setLoss({ ...loss, [f.id]: e.target.value })}
                    className="w-20 text-right"
                    aria-label={`Estimated loss on ${f.name ?? 'farm'}, percent`}
                  />
                  <span className="text-zinc-500">%</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <Field
        label="Estimated loss (₦)"
        hint="Optional. The insurer's assessor sets the figure that counts."
      >
        <Input
          inputMode="decimal"
          value={form.estimate}
          onChange={set('estimate')}
          placeholder="e.g. 450000"
        />
      </Field>
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          Report the loss
        </Button>
      </div>
    </form>
  );
}

// ---------- One claim ----------

function ClaimDetail({
  claim: c,
  data,
  onChange,
}: {
  claim: InsuranceClaim;
  data: TabProps['data'];
  onChange: () => void;
}) {
  const role = useAuth().profile?.role;
  const farmName = (id: string) => data.farms.find((f) => f.id === id)?.name ?? 'Farm';
  const policy = data.insurance.find((p) => p.id === c.policy_id);

  return (
    <div className="space-y-6">
      <Steps claim={c} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <p className="text-sm text-zinc-700">{c.description}</p>
          <DescriptionList
            items={[
              ['Policy', policy ? `${policy.insurer_name} · ${policy.policy_number}` : '—'],
              [
                'Loss',
                `${formatDate(c.loss_from)}${c.loss_to ? ` – ${formatDate(c.loss_to)}` : ', still going on'}`,
              ],
              ['Reported', formatDate(c.reported_at)],
              ...(c.estimated_loss_kobo
                ? ([['Estimated loss', formatNaira(c.estimated_loss_kobo)]] as [
                    string,
                    ReactNode,
                  ][])
                : []),
              ...(c.notified_on
                ? ([
                    [
                      'Insurer told',
                      `${formatDate(c.notified_on)}${c.insurer_claim_number ? ` · ${c.insurer_claim_number}` : ''}`,
                    ],
                  ] as [string, ReactNode][])
                : []),
              ...(c.assessed_on
                ? ([
                    ['Assessed', `${formatDate(c.assessed_on)} · ${c.assessor ?? ''}`],
                    ...(c.assessed_loss_kobo
                      ? [
                          ['Loss assessed', formatNaira(c.assessed_loss_kobo)] as [
                            string,
                            ReactNode,
                          ],
                        ]
                      : []),
                  ] as [string, ReactNode][])
                : []),
              ...(c.approved_kobo
                ? ([['Approved', formatNaira(c.approved_kobo)]] as [string, ReactNode][])
                : []),
              ...(c.paid_kobo
                ? ([['Paid', formatNaira(c.paid_kobo)]] as [string, ReactNode][])
                : []),
            ]}
          />
          {c.assessment_notes && (
            <p className="text-xs text-zinc-600">Assessor's notes: {c.assessment_notes}</p>
          )}
          {c.closed_reason && (
            <Alert
              tone={c.status === 'rejected' ? 'warning' : 'info'}
              title={CLAIM_STATUS[c.status].label}
            >
              {c.closed_reason}
            </Alert>
          )}
          <div>
            <p className="mb-1 text-sm font-medium text-zinc-800">Farms</p>
            <ul className="space-y-1 text-sm text-zinc-600">
              {c.insurance_claim_farms.map((f) => (
                <li key={f.farm_id} className="flex justify-between gap-3">
                  <span>{farmName(f.farm_id)}</span>
                  <span className="tabular-nums">about {f.estimated_loss_pct}% lost</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <Evidence claim={c} />
      </div>
      <Documents
        claim={c}
        canAdd={can.reportClaims(role) && isOpen(c.status)}
        onChange={onChange}
      />
      <NextStep claim={c} onChange={onChange} />
    </div>
  );
}

function Evidence({ claim: c }: { claim: InsuranceClaim }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-zinc-800">
          <CloudRain className="size-4 text-zinc-500" aria-hidden /> Weather over the loss
        </p>
        {c.weather_evidence.length === 0 ? (
          <p className="text-xs text-zinc-500">
            No weather was on record for these farms when the loss was reported.
          </p>
        ) : (
          <ul className="space-y-2">
            {c.weather_evidence.map((w) => (
              <li
                key={`${w.lat},${w.lon}`}
                className="rounded-xl bg-zinc-50 p-3 text-xs ring-1 ring-zinc-950/5"
              >
                <p className="text-zinc-500">
                  {w.farms} farm{w.farms === 1 ? '' : 's'} near {Number(w.lat).toFixed(1)}°N,{' '}
                  {Number(w.lon).toFixed(1)}°E · {formatDate(w.from)} – {formatDate(w.to)} ·{' '}
                  {w.days_with_data} day{w.days_with_data === 1 ? '' : 's'} on record
                </p>
                <p className="mt-1 text-sm text-zinc-900">
                  <span className="font-semibold tabular-nums">
                    {Math.round(Number(w.rain_mm))} mm
                  </span>{' '}
                  of rain
                  {w.normal_mm !== null && (
                    <span className="text-zinc-600">
                      {' '}
                      against a usual {Math.round(Number(w.normal_mm))} mm
                    </span>
                  )}
                </p>
                <p className="text-zinc-600">
                  Longest dry run: {w.longest_dry_run_days} day
                  {w.longest_dry_run_days === 1 ? '' : 's'}
                  {w.max_tmax_c !== null && ` · hottest ${Math.round(Number(w.max_tmax_c))} °C`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-zinc-800">Latest field visits</p>
        {c.visit_evidence.length === 0 ? (
          <p className="text-xs text-zinc-500">No visits to these farms around the loss.</p>
        ) : (
          <ul className="space-y-1.5 text-xs text-zinc-600">
            {c.visit_evidence.map((v) => (
              <li key={v.visit_id}>
                <span className="font-medium text-zinc-900">{v.farm}</span> ({v.farmer}),{' '}
                {formatDate(v.visited_at)}: crop {v.crop_condition}
                {v.photos > 0 && `, ${v.photos} photo${v.photos === 1 ? '' : 's'}`}
                {!v.passed && ' · visit failed'}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Documents({
  claim,
  canAdd,
  onChange,
}: {
  claim: InsuranceClaim;
  canAdd: boolean;
  onChange: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const add = async (file: File) => {
    setBusy(true);
    try {
      const path = await uploadFile(BUCKET, claim.id, file);
      const { error } = await supabase.rpc('add_claim_document', {
        p_claim_id: claim.id,
        p_path: path,
      });
      if (error) throw error;
      toast.success('Document added');
      onChange();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (claim.document_paths.length === 0 && !canAdd) return null;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-zinc-800">Documents</p>
        {canAdd && (
          <label
            className={cx(
              'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm ring-1 ring-zinc-950/10 hover:bg-zinc-50',
              busy && 'pointer-events-none opacity-50',
            )}
          >
            <Upload className="size-3.5" aria-hidden />{' '}
            {busy ? 'Uploading…' : 'Add photo or document'}
            <input
              type="file"
              accept="image/*,application/pdf"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void add(f);
              }}
            />
          </label>
        )}
      </div>
      {claim.document_paths.length === 0 ? (
        <p className="text-xs text-zinc-500">
          Photos of the damage, the assessor's report, letters from the insurer.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {claim.document_paths.map((p) => (
            <li key={p}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => openFile(BUCKET, p).catch((err) => toast.error(errorMessage(err)))}
              >
                <FileText aria-hidden />{' '}
                {p
                  .split('/')
                  .pop()!
                  .replace(/^[0-9a-f-]{36}-/, '')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- The next step ----------

function NextStep({ claim: c, onChange }: { claim: InsuranceClaim; onChange: () => void }) {
  const role = useAuth().profile?.role;
  const manages = can.manageClaims(role);
  const pays = can.actAsTrustee(role);
  if (!isOpen(c.status)) return null;
  return (
    <div className="space-y-4 border-t border-zinc-950/5 pt-5">
      {c.status === 'reported' && manages && <NotifyForm claim={c} onDone={onChange} />}
      {c.status === 'notified' && manages && <AssessForm claim={c} onDone={onChange} />}
      {c.status === 'assessed' && pays && <PayForm claim={c} onDone={onChange} />}
      {c.status === 'assessed' && !pays && (
        <p className="text-sm text-zinc-600">
          Waiting for the insurer's payment, which the trustee records.
        </p>
      )}
      {c.status !== 'assessed' && !manages && (
        <p className="text-sm text-zinc-600">The cycle manager deals with the insurer from here.</p>
      )}
      {manages && <CloseForm claim={c} onDone={onChange} />}
    </div>
  );
}

function useAction(onDone: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: string, args: Record<string, unknown>, success: string) => {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    if (typeof data === 'string' && data) toast.error(data);
    toast.success(success);
    onDone();
  };
  return { busy, error, run };
}

function NotifyForm({ claim, onDone }: { claim: InsuranceClaim; onDone: () => void }) {
  const [on, setOn] = useState(isoDate());
  const [number, setNumber] = useState('');
  const { busy, error, run } = useAction(onDone);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          'notify_insurance_claim',
          { p_claim_id: claim.id, p_notified_on: on, p_insurer_claim_number: number || null },
          'Insurer notified',
        );
      }}
    >
      <SectionTitle
        title="Tell the insurer"
        description="Most policies ask for notice within 14 days of the loss. Record when it was given, and the insurer's claim number."
      />
      <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
        <Field label="Notified on">
          <Input
            type="date"
            value={on}
            min={claim.loss_from}
            max={isoDate()}
            onChange={(e) => setOn(e.target.value)}
            required
          />
        </Field>
        <Field label="Insurer's claim number">
          <Input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="Optional"
            maxLength={100}
          />
        </Field>
        <Button type="submit" busy={busy}>
          Insurer notified
        </Button>
      </div>
      {error && <Alert>{error}</Alert>}
    </form>
  );
}

function AssessForm({ claim, onDone }: { claim: InsuranceClaim; onDone: () => void }) {
  const [form, setForm] = useState({
    on: isoDate(),
    assessor: '',
    loss: '',
    approved: '',
    notes: '',
  });
  const { busy, error, run } = useAction(onDone);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const approved = parseNaira(form.approved);
        const loss = form.loss.trim() ? parseNaira(form.loss) : null;
        if (!approved || (form.loss.trim() && loss === null)) {
          setProblem('Enter the amounts in naira');
          return;
        }
        setProblem(null);
        void run(
          'record_claim_assessment',
          {
            p_claim_id: claim.id,
            p_assessed_on: form.on,
            p_assessor: form.assessor,
            p_approved_kobo: approved.toString(),
            p_assessed_loss_kobo: loss?.toString() ?? null,
            p_notes: form.notes || null,
          },
          'Assessment recorded. The trustee records the payment when it arrives.',
        );
      }}
    >
      <SectionTitle
        title="Record the assessment"
        description="What the insurer's loss assessor found, and the amount the insurer approves."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Assessed on">
          <Input
            type="date"
            value={form.on}
            min={claim.notified_on ?? undefined}
            max={isoDate()}
            onChange={set('on')}
            required
          />
        </Field>
        <Field label="Assessor">
          <Input
            value={form.assessor}
            onChange={set('assessor')}
            required
            placeholder="Name or firm"
          />
        </Field>
        <Field label="Loss assessed (₦)" hint="Optional">
          <Input inputMode="decimal" value={form.loss} onChange={set('loss')} />
        </Field>
        <Field label="Approved (₦)">
          <Input inputMode="decimal" value={form.approved} onChange={set('approved')} required />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea rows={2} value={form.notes} onChange={set('notes')} maxLength={3000} />
      </Field>
      {(problem || error) && <Alert>{problem ?? error}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" busy={busy}>
          Record assessment
        </Button>
      </div>
    </form>
  );
}

function PayForm({ claim, onDone }: { claim: InsuranceClaim; onDone: () => void }) {
  const [form, setForm] = useState({
    amount: nairaInput(claim.approved_kobo),
    reference: '',
    on: isoDate(),
  });
  const { busy, error, run } = useAction(onDone);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const amount = parseNaira(form.amount);
        if (!amount) {
          setProblem('Enter the amount received in naira');
          return;
        }
        setProblem(null);
        void run(
          'record_claim_payout',
          {
            p_claim_id: claim.id,
            p_amount_kobo: amount.toString(),
            p_trustee_reference: form.reference,
            p_received_on: form.on,
          },
          'Payment recorded on the cycle',
        );
      }}
    >
      <SectionTitle
        title="Record the insurer's payment"
        description={`Once it has arrived in the escrow account. Up to the ${formatNaira(claim.approved_kobo)} approved.`}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Amount (₦)">
          <Input
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
          />
        </Field>
        <Field label="Bank reference">
          <Input
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
            required
          />
        </Field>
        <Field label="Received on">
          <Input
            type="date"
            value={form.on}
            max={isoDate()}
            onChange={(e) => setForm({ ...form, on: e.target.value })}
            required
          />
        </Field>
      </div>
      {(problem || error) && <Alert>{problem ?? error}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" busy={busy}>
          Record payment
        </Button>
      </div>
    </form>
  );
}

function CloseForm({ claim, onDone }: { claim: InsuranceClaim; onDone: () => void }) {
  const [outcome, setOutcome] = useState<'rejected' | 'withdrawn' | null>(null);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction(onDone);
  const canReject = claim.status === 'notified' || claim.status === 'assessed';
  const canWithdraw = claim.status === 'reported' || claim.status === 'notified';
  if (!outcome) {
    return (
      <div className="flex flex-wrap gap-2">
        {canReject && (
          <Button size="sm" variant="ghost" onClick={() => setOutcome('rejected')}>
            The insurer rejected it
          </Button>
        )}
        {canWithdraw && (
          <Button size="sm" variant="ghost" onClick={() => setOutcome('withdrawn')}>
            Withdraw the claim
          </Button>
        )}
      </div>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          'close_insurance_claim',
          { p_claim_id: claim.id, p_outcome: outcome, p_reason: reason },
          outcome === 'rejected' ? 'Claim recorded as rejected' : 'Claim withdrawn',
        );
      }}
    >
      <Field label={outcome === 'rejected' ? "The insurer's reason" : 'Why withdraw it?'}>
        <Textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          maxLength={1000}
        />
      </Field>
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOutcome(null)}>
          Cancel
        </Button>
        <Button type="submit" variant="danger" busy={busy}>
          {outcome === 'rejected' ? 'Record rejection' : 'Withdraw'}
        </Button>
      </div>
    </form>
  );
}
