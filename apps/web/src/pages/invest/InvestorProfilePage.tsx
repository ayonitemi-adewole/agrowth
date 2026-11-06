import { BadgeCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../components/Toast';
import {
  Alert,
  Button,
  Card,
  DescriptionList,
  Field,
  Input,
  KycBadge,
  PageHeader,
  SectionTitle,
  Select,
  Spinner,
} from '../../components/ui';
import { formatBps, uploadFile } from '../../lib/cycles';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { INVESTOR_CLASS } from '../../lib/investing';
import { formatNaira, nairaInput, parseNaira } from '../../lib/money';
import { supabase } from '../../lib/supabase';
import type { InvestorClass, InvestorProfile } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';
import { loadInvestorSettings, loadMyInvestorProfile } from './data';

export function InvestorProfilePage() {
  const state = useAsync(() => Promise.all([loadMyInvestorProfile(), loadInvestorSettings()]), []);
  const [editing, setEditing] = useState(false);

  if (state.loading && !state.data) return <Spinner />;
  if (state.error) return <Alert>{errorMessage(state.error)}</Alert>;
  const [profile, settings] = state.data!;
  const showForm = !profile || editing || profile.kyc_status === 'rejected';

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Profile and KYC"
        description="The operator must know who its investors are. Your NIN and BVN are checked, then stored only as a one-way fingerprint that can't be turned back into the number."
      />

      {profile && (
        <Card>
          <SectionTitle
            title={profile.legal_name}
            description={`Submitted ${formatDate(profile.submitted_at)}`}
            actions={
              <>
                <KycBadge status={profile.kyc_status} />
                {!showForm && (
                  <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                    Update details
                  </Button>
                )}
              </>
            }
          />
          {profile.kyc_status === 'rejected' && profile.review_note && (
            <div className="mb-4">
              <Alert title="Compliance could not accept your KYC">{profile.review_note}</Alert>
            </div>
          )}
          {profile.kyc_status === 'pending' && (
            <div className="mb-4">
              <Alert tone="info">
                Compliance is reviewing your details. You can invest once they are verified.
              </Alert>
            </div>
          )}
          <DescriptionList
            items={[
              [
                'Investor type',
                profile.classification
                  ? INVESTOR_CLASS[profile.classification]
                  : `${INVESTOR_CLASS[profile.declared_class]} (declared)`,
              ],
              ['Annual income', formatNaira(profile.annual_income_kobo)],
              [
                'Crowdfunding elsewhere, last 12 months',
                formatNaira(profile.other_crowdfunding_kobo),
              ],
              [
                'Payouts to',
                `${profile.bank_name} · ${profile.account_number} · ${profile.account_name}`,
              ],
            ]}
          />
        </Card>
      )}

      {showForm && (
        <KycForm
          profile={profile}
          capBps={settings.retail_cap_bps}
          onCancel={
            profile && profile.kyc_status !== 'rejected' ? () => setEditing(false) : undefined
          }
          onDone={() => {
            setEditing(false);
            state.reload();
          }}
        />
      )}
    </div>
  );
}

function KycForm({
  profile,
  capBps,
  onCancel,
  onDone,
}: {
  profile: InvestorProfile | null;
  capBps: number;
  onCancel?: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { session, profile: account } = useAuth();
  const [form, setForm] = useState({
    legal_name: profile?.legal_name ?? account?.full_name ?? '',
    declared_class: (profile?.declared_class ?? 'retail') as InvestorClass,
    nin: '',
    bvn: '',
    income: profile ? nairaInput(profile.annual_income_kobo) : '',
    other: profile ? nairaInput(profile.other_crowdfunding_kobo) : '0',
    bank_name: profile?.bank_name ?? '',
    account_number: profile?.account_number ?? '',
    account_name: profile?.account_name ?? '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const income = parseNaira(form.income);
    const other = parseNaira(form.other || '0');
    if (income === null || other === null) {
      setError('Enter income and other investments in naira');
      return;
    }
    if (!file && !profile) {
      setError('Attach a photo or scan of your ID');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const path = file
        ? await uploadFile('investor-documents', session!.user.id, file)
        : profile!.id_document_path;
      const { error } = await supabase.rpc('submit_investor_kyc', {
        p_legal_name: form.legal_name,
        p_declared_class: form.declared_class,
        p_nin: form.nin,
        p_bvn: form.bvn,
        p_annual_income_kobo: income.toString(),
        p_other_crowdfunding_kobo: other.toString(),
        p_id_document_path: path,
        p_bank_name: form.bank_name,
        p_account_number: form.account_number,
        p_account_name: form.account_name,
      });
      if (error) throw error;
      toast.success('Sent to compliance for review');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionTitle
        title={profile ? 'Update your KYC' : 'Verify your identity'}
        description={
          profile?.kyc_status === 'verified'
            ? 'Changing your details sends them back to compliance. You can’t make new pledges until they are verified again; existing investments are not affected.'
            : 'Compliance checks these details before you can invest.'
        }
      />
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full legal name" hint="As it appears on your ID" className="sm:col-span-2">
            <Input value={form.legal_name} onChange={set('legal_name')} required maxLength={200} />
          </Field>
          <Field label="NIN" hint="11 digits">
            <Input
              value={form.nin}
              onChange={set('nin')}
              required
              inputMode="numeric"
              pattern="[0-9 -]{11,13}"
              autoComplete="off"
            />
          </Field>
          <Field label="BVN" hint="11 digits">
            <Input
              value={form.bvn}
              onChange={set('bvn')}
              required
              inputMode="numeric"
              pattern="[0-9 -]{11,13}"
              autoComplete="off"
            />
          </Field>
          <Field
            label="ID document"
            hint={
              profile
                ? 'Leave empty to keep the one on file'
                : 'Passport, driver’s licence or national ID card'
            }
            className="sm:col-span-2"
          >
            <Input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="pt-1.5"
            />
          </Field>
        </div>

        <div className="grid gap-4 border-t border-zinc-950/5 pt-5 sm:grid-cols-2">
          <Field
            label="Investor type"
            hint="High-net-worth and institutional investors have no limit; compliance checks the claim."
            className="sm:col-span-2"
          >
            <Select value={form.declared_class} onChange={set('declared_class')}>
              {(Object.keys(INVESTOR_CLASS) as InvestorClass[]).map((c) => (
                <option key={c} value={c}>
                  {INVESTOR_CLASS[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Net annual income (₦)"
            hint={`Retail investors may put up to ${formatBps(capBps)} of this into crowdfunding a year`}
          >
            <Input value={form.income} onChange={set('income')} required inputMode="decimal" />
          </Field>
          <Field
            label="Crowdfunding elsewhere, last 12 months (₦)"
            hint="Counts towards the same limit"
          >
            <Input value={form.other} onChange={set('other')} inputMode="decimal" />
          </Field>
        </div>

        <div className="grid gap-4 border-t border-zinc-950/5 pt-5 sm:grid-cols-3">
          <p className="text-sm text-zinc-600 sm:col-span-3">
            Where the trustee pays your capital and returns. It must be in your own name.
          </p>
          <Field label="Bank">
            <Input value={form.bank_name} onChange={set('bank_name')} required maxLength={120} />
          </Field>
          <Field label="Account number">
            <Input
              value={form.account_number}
              onChange={set('account_number')}
              required
              inputMode="numeric"
              pattern="[0-9]{10}"
              maxLength={10}
            />
          </Field>
          <Field label="Account name">
            <Input
              value={form.account_name}
              onChange={set('account_name')}
              required
              maxLength={200}
            />
          </Field>
        </div>

        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" busy={busy}>
            <BadgeCheck aria-hidden /> Submit for review
          </Button>
        </div>
      </form>
    </Card>
  );
}
