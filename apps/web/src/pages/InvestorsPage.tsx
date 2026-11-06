import { FileText, Landmark } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../components/Toast';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  KycBadge,
  Modal,
  PageHeader,
  SectionTitle,
  Select,
  Spinner,
  Table,
  Tabs,
  Textarea,
} from '../components/ui';
import { formatBps, openFile } from '../lib/cycles';
import { errorMessage } from '../lib/errors';
import { formatDate } from '../lib/format';
import { INVESTOR_CLASS } from '../lib/investing';
import { formatNaira, nairaInput, parseNaira } from '../lib/money';
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
  canReview,
  onChange,
  empty,
}: {
  investors: InvestorProfile[];
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
                <ReviewButton investor={i} onDone={onChange} />
              )}
            </div>
          </td>
        </tr>
      ))}
    </Table>
  );
}

function ReviewButton({ investor, onDone }: { investor: InvestorProfile; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [classification, setClassification] = useState<InvestorClass>(investor.declared_class);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <Button size="sm" onClick={() => setOpen(true)}>
        Review
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Review ${investor.legal_name}`}
        description="Check the ID document against the name, NIN and BVN before verifying."
      >
        <div className="space-y-4">
          <Field
            label="Classification"
            hint={`Declared ${INVESTOR_CLASS[investor.declared_class].toLowerCase()}. Only confirm high-net-worth or institutional with evidence; otherwise classify as retail.`}
          >
            <Select
              value={classification}
              onChange={(e) => setClassification(e.target.value as InvestorClass)}
            >
              {(Object.keys(INVESTOR_CLASS) as InvestorClass[]).map((c) => (
                <option key={c} value={c}>
                  {INVESTOR_CLASS[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note" hint="Required to reject: the investor sees it.">
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="danger" busy={busy === 'reject'} onClick={() => review(false)}>
              Reject
            </Button>
            <Button busy={busy === 'approve'} onClick={() => review(true)}>
              Verify
            </Button>
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
