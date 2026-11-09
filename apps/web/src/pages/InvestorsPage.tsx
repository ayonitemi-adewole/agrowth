import { FileText, Landmark } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../components/Toast';
import {
  Alert,
  Badge,
  Button,
  Card,
  cx,
  EmptyState,
  Field,
  Input,
  KycBadge,
  Modal,
  PageHeader,
  SectionTitle,
  Spinner,
  Table,
  Tabs,
  Textarea,
} from '../components/ui';
import { formatBps, openFile } from '../lib/cycles';
import { IdentityChecks } from '../components/IdentityChecks';
import { errorMessage } from '../lib/errors';
import { formatDate } from '../lib/format';
import { identityConfirmed, loadIdentityChecks, type IdentityCheck } from '../lib/identity';
import { INVESTOR_CLASS } from '../lib/investing';
import { formatNaira, nairaInput, parseNaira, toKobo } from '../lib/money';
import { can } from '../lib/roles';
import { supabase } from '../lib/supabase';
import type { InvestorClass, InvestorProfile, InvestorSettings } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { loadInvestorSettings } from './invest/data';

type Tab = 'review' | 'all' | 'settings';

export function InvestorsPage() {
  const role = useAuth().profile?.role;
  const [tab, setTab] = useState<Tab>('review');
  const state = useAsync(async () => {
    const [investors, settings] = await Promise.all([
      supabase.from('investor_profiles').select('*').order('submitted_at', { ascending: false }),
      loadInvestorSettings(),
    ]);
    if (investors.error) throw investors.error;
    return { investors: investors.data as InvestorProfile[], settings };
  }, []);

  if (state.loading && !state.data) return <Spinner />;
  if (state.error) return <Alert>{errorMessage(state.error)}</Alert>;
  const { investors, settings } = state.data!;
  const pending = investors.filter((i) => i.kyc_status === 'pending');

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'review', label: 'Awaiting review', count: pending.length },
    { id: 'all', label: 'All investors', count: investors.length },
    ...(can.editInvestorSettings(role)
      ? [{ id: 'settings' as Tab, label: 'Investor settings' }]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Investors"
        description="Investor KYC and classification, which set who may invest and how much. Retail investors are limited to a share of their income; compliance confirms any claim to be high-net-worth or institutional."
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'settings' ? (
        <SettingsForm settings={settings} onSaved={state.reload} />
      ) : (
        <InvestorTable
          investors={tab === 'review' ? pending : investors}
          capBps={settings.retail_cap_bps}
          canReview={can.reviewInvestors(role)}
          onChange={state.reload}
          empty={tab === 'review' ? 'No investors are waiting for review.' : 'No investors yet.'}
        />
      )}
    </div>
  );
}

function InvestorTable({
  investors,
  capBps,
  canReview,
  onChange,
  empty,
}: {
  investors: InvestorProfile[];
  capBps: number;
  canReview: boolean;
  onChange: () => void;
  empty: string;
}) {
  const toast = useToast();
  if (investors.length === 0) {
    return <EmptyState icon={<Landmark />} title={empty} />;
  }
  const viewId = (path: string) =>
    openFile('investor-documents', path).catch((err) => toast.error(errorMessage(err)));
  return (
    <Table head={['Investor', 'Type', 'Income', 'Elsewhere (12 mo)', 'Payout account', 'KYC', '']}>
      {investors.map((i) => (
        <tr key={i.user_id}>
          <td>
            <p className="font-medium text-zinc-900">{i.legal_name}</p>
            <p className="text-xs text-zinc-500">Submitted {formatDate(i.submitted_at)}</p>
          </td>
          <td className="text-zinc-600">
            {i.classification ? (
              INVESTOR_CLASS[i.classification]
            ) : (
              <span>
                {INVESTOR_CLASS[i.declared_class]}{' '}
                <span className="text-xs text-zinc-400">(declared)</span>
              </span>
            )}
          </td>
          <td className="text-zinc-600 tabular-nums">
            {formatNaira(i.annual_income_kobo, { compact: true })}
          </td>
          <td className="text-zinc-600 tabular-nums">
            {formatNaira(i.other_crowdfunding_kobo, { compact: true })}
          </td>
          <td className="text-xs text-zinc-600">
            {i.bank_name} · <span className="font-mono">{i.account_number}</span>
            <br />
            {i.account_name}
          </td>
          <td>
            <KycBadge status={i.kyc_status} />
          </td>
          <td className="text-right whitespace-nowrap">
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => viewId(i.id_document_path)}>
                <FileText aria-hidden /> ID
              </Button>
              {canReview && i.kyc_status === 'pending' && (
                <ReviewButton investor={i} capBps={capBps} onDone={onChange} />
              )}
            </div>
          </td>
        </tr>
      ))}
    </Table>
  );
}

const CLASS_EFFECT: Record<InvestorClass, string> = {
  retail: 'Limited to a share of declared income each year',
  high_net_worth: 'No limit. Needs evidence of income or net worth',
  institutional: 'No limit. Needs evidence of a registered fund or company',
};

function ReviewButton({
  investor,
  capBps,
  onDone,
}: {
  investor: InvestorProfile;
  capBps: number;
  onDone: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [classification, setClassification] = useState<InvestorClass>(investor.declared_class);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<IdentityCheck[] | null>(null);

  const loadChecks = () =>
    loadIdentityChecks('investor', investor.user_id)
      .then(setChecks)
      .catch((err) => setError(errorMessage(err)));
  const start = () => {
    setClassification(investor.declared_class);
    setNote('');
    setError(null);
    setChecks(null);
    setOpen(true);
    void loadChecks();
  };
  const confirmed =
    checks !== null && identityConfirmed(['nin', 'bvn'], checks, investor.submitted_at);
  const needsNote = !confirmed && !note.trim();
  const viewId = () =>
    openFile('investor-documents', investor.id_document_path).catch((err) =>
      setError(errorMessage(err)),
    );
  const retailCap = (toKobo(investor.annual_income_kobo) * BigInt(capBps)) / 10_000n;
  const nameMismatch =
    investor.account_name.trim().toLowerCase() !== investor.legal_name.trim().toLowerCase();

  const review = async (approve: boolean) => {
    setBusy(approve ? 'approve' : 'reject');
    setError(null);
    const { error } = await supabase.rpc('review_investor_kyc', {
      p_user_id: investor.user_id,
      p_approve: approve,
      p_classification: approve ? classification : null,
      p_note: note || null,
    });
    setBusy(null);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    toast.success(approve ? `${investor.legal_name} verified` : 'KYC rejected');
    setOpen(false);
    onDone();
  };

  return (
    <>
      <Button size="sm" onClick={start}>
        Review
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        wide
        title={`Review ${investor.legal_name}`}
        description={`Submitted ${formatDate(investor.submitted_at)}. Check the ID document shows this name, and that the payout account is in the same name.`}
      >
        <div className="space-y-6">
          <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-950/5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium text-zinc-900">What the investor submitted</p>
              <Button size="sm" variant="secondary" onClick={viewId}>
                <FileText aria-hidden /> Open ID document
              </Button>
            </div>
            <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              {(
                [
                  ['Legal name', investor.legal_name],
                  ['Declared type', INVESTOR_CLASS[investor.declared_class]],
                  ['Net annual income', formatNaira(investor.annual_income_kobo)],
                  [
                    'Crowdfunding elsewhere (12 months)',
                    formatNaira(investor.other_crowdfunding_kobo),
                  ],
                  [
                    'Payout account',
                    <>
                      {investor.bank_name} ·{' '}
                      <span className="font-mono">{investor.account_number}</span>
                      <span className="block text-zinc-600">{investor.account_name}</span>
                    </>,
                  ],
                ] as [string, ReactNode][]
              ).map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs text-zinc-500">{label}</dt>
                  <dd className="mt-0.5 font-medium break-words text-zinc-900">{value}</dd>
                </div>
              ))}
            </dl>
            {nameMismatch && (
              <div className="mt-3">
                <Alert tone="warning">
                  The account name differs from the legal name. Payouts must go to the investor's
                  own account.
                </Alert>
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-zinc-900">Identity checks</p>
            {checks === null ? (
              <Spinner label="Loading checks…" />
            ) : (
              <IdentityChecks
                subject="investor"
                subjectId={investor.user_id}
                checks={checks}
                onRecord={[{ type: 'nin' }, { type: 'bvn' }]}
                since={investor.submitted_at}
                canRun
                onChecked={loadChecks}
              />
            )}
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-zinc-800">
              Classify as (if verifying)
            </legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {(Object.keys(INVESTOR_CLASS) as InvestorClass[]).map((c) => (
                <label
                  key={c}
                  className={cx(
                    'flex cursor-pointer flex-col rounded-xl p-3 ring-1 transition',
                    classification === c
                      ? 'bg-brand-50 ring-2 ring-brand-600'
                      : 'bg-white ring-zinc-950/10 hover:bg-zinc-50',
                  )}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <input
                      type="radio"
                      name={`class-${investor.user_id}`}
                      value={c}
                      checked={classification === c}
                      onChange={() => setClassification(c)}
                      className="size-4 text-brand-600"
                    />
                    <span className="text-sm font-medium text-zinc-900">{INVESTOR_CLASS[c]}</span>
                    {c === investor.declared_class && <Badge>Declared</Badge>}
                  </span>
                  <span className="mt-1.5 text-xs text-zinc-500">
                    {c === 'retail'
                      ? `Up to ${formatNaira(retailCap, { compact: true })} a year (${formatBps(capBps)} of income)`
                      : CLASS_EFFECT[c]}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <Field
            label="Note"
            hint={
              confirmed
                ? 'Needed to reject: the investor sees it, so they know what to fix. Optional when verifying.'
                : 'Needed to reject (the investor sees it). Also needed to verify, as the NIN and BVN don’t both have a matching check: say how you confirmed who they are.'
            }
          >
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. The ID photo is unreadable; please upload a clearer scan."
            />
          </Field>

          {error && <Alert>{error}</Alert>}

          <div className="flex flex-col-reverse gap-2 border-t border-zinc-950/5 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                variant="secondary"
                className="text-red-700"
                busy={busy === 'reject'}
                disabled={busy !== null || !note.trim()}
                title={note.trim() ? undefined : 'Add a note to reject'}
                onClick={() => review(false)}
              >
                Reject
              </Button>
              <Button
                busy={busy === 'approve'}
                disabled={busy !== null || needsNote}
                title={needsNote ? 'Add a note, or run the identity checks first' : undefined}
                onClick={() => review(true)}
              >
                Verify as {INVESTOR_CLASS[classification].toLowerCase()}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}

function SettingsForm({ settings, onSaved }: { settings: InvestorSettings; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    retail_cap_pct: String(settings.retail_cap_bps / 100),
    cooling_off_hours: String(settings.cooling_off_hours),
    payment_window_days: String(settings.payment_window_days),
    min_pledge: nairaInput(settings.min_pledge_kobo),
    escrow_bank_name: settings.escrow_bank_name,
    escrow_account_name: settings.escrow_account_name,
    escrow_account_number: settings.escrow_account_number,
    risk_disclosure: settings.risk_disclosure,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const min = parseNaira(form.min_pledge);
    if (!min) {
      setError('Enter the minimum investment in naira');
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from('investor_settings')
      .update({
        retail_cap_bps: Math.round(Number(form.retail_cap_pct) * 100),
        cooling_off_hours: Number(form.cooling_off_hours),
        payment_window_days: Number(form.payment_window_days),
        min_pledge_kobo: min.toString(),
        escrow_bank_name: form.escrow_bank_name,
        escrow_account_name: form.escrow_account_name,
        escrow_account_number: form.escrow_account_number,
        risk_disclosure: form.risk_disclosure,
      })
      .eq('id', true);
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    toast.success('Investor settings saved');
    onSaved();
  };

  const disclosureChanged = form.risk_disclosure !== settings.risk_disclosure;

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-6">
      <Card>
        <SectionTitle
          title="Limits and timing"
          description={`Retail investors may invest ${formatBps(settings.retail_cap_bps)} of their declared income across all crowdfunding in 12 months.`}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Retail limit (% of income)">
            <Input
              type="number"
              min={0.01}
              max={100}
              step={0.01}
              value={form.retail_cap_pct}
              onChange={set('retail_cap_pct')}
              required
            />
          </Field>
          <Field label="Minimum investment (₦)">
            <Input
              value={form.min_pledge}
              onChange={set('min_pledge')}
              required
              inputMode="decimal"
            />
          </Field>
          <Field
            label="Cooling-off (hours)"
            hint="The trustee can't add a payment to a cycle until this has passed."
          >
            <Input
              type="number"
              min={0}
              max={720}
              value={form.cooling_off_hours}
              onChange={set('cooling_off_hours')}
              required
            />
          </Field>
          <Field label="Days to pay a pledge" hint="Never later than the cycle's funding deadline.">
            <Input
              type="number"
              min={1}
              max={60}
              value={form.payment_window_days}
              onChange={set('payment_window_days')}
              required
            />
          </Field>
        </div>
      </Card>
      <Card>
        <SectionTitle
          title="Trustee escrow account"
          description="Shown to investors as where to pay their pledges."
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Bank">
            <Input value={form.escrow_bank_name} onChange={set('escrow_bank_name')} required />
          </Field>
          <Field label="Account name">
            <Input
              value={form.escrow_account_name}
              onChange={set('escrow_account_name')}
              required
            />
          </Field>
          <Field label="Account number">
            <Input
              value={form.escrow_account_number}
              onChange={set('escrow_account_number')}
              required
              pattern="[0-9]{10}"
              maxLength={10}
            />
          </Field>
        </div>
      </Card>
      <Card>
        <SectionTitle
          title="Risk disclosure"
          description={`Version ${settings.disclosure_version}, updated ${formatDate(settings.updated_at)}. Every investor acknowledges the current version before each pledge.`}
          actions={
            disclosureChanged ? <Badge tone="amber">Saving creates a new version</Badge> : undefined
          }
        />
        <Textarea
          rows={12}
          value={form.risk_disclosure}
          onChange={set('risk_disclosure')}
          required
          minLength={50}
        />
      </Card>
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" busy={busy}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
