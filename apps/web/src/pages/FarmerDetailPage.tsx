import { MapPinPlus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { FarmMap } from '../components/FarmMap';
import { EditBankAccount } from '../components/BankAccountForm';
import { IdentityChecks } from '../components/IdentityChecks';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  KycBadge,
  PageHeader,
  PageSkeleton,
  Skeleton,
  Textarea,
} from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatDate, formatHectares, titleCase } from '../lib/format';
import { identityConfirmed, loadIdentityChecks, type NumberType } from '../lib/identity';
import { can } from '../lib/roles';
import { supabase } from '../lib/supabase';
import type { Farmer, FarmMap as Farm, KycStatus } from '../lib/types';
import { useAsync } from '../lib/useAsync';

type FarmerRow = Farmer & { cooperatives: { id: string; name: string } | null };

export function FarmerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const location = useLocation();
  const { justEnrolled, identityNotice } =
    (location.state as {
      justEnrolled?: boolean;
      identityNotice?: { ok: boolean; message: string };
    } | null) ?? {};
  const [kycBusy, setKycBusy] = useState<KycStatus | null>(null);
  const [kycError, setKycError] = useState<string | null>(null);
  const [kycNote, setKycNote] = useState('');

  const checks = useAsync(() => loadIdentityChecks('farmer', id!), [id]);

  const farmer = useAsync(async () => {
    const { data, error } = await supabase
      .from('farmers')
      .select('*, cooperatives(id, name)')
      .eq('id', id!)
      .maybeSingle();
    if (error) throw error;
    return data as FarmerRow | null;
  }, [id]);

  const farms = useAsync(async () => {
    const { data, error } = await supabase
      .from('farm_maps')
      .select('*')
      .eq('farmer_id', id!)
      .order('created_at');
    if (error) throw error;
    return data as Farm[];
  }, [id]);

  const setKyc = async (status: KycStatus) => {
    setKycBusy(status);
    setKycError(null);
    const { error } = await supabase.rpc('set_farmer_kyc', {
      p_farmer_id: id,
      p_status: status,
      p_note: kycNote.trim() || null,
    });
    setKycBusy(null);
    if (error) setKycError(errorMessage(error));
    else {
      setKycNote('');
      farmer.reload();
    }
  };

  if (farmer.loading && (!farmer.data || farmer.stale)) return <PageSkeleton variant="detail" />;
  if (farmer.error) return <Alert>{errorMessage(farmer.error)}</Alert>;
  const f = farmer.data;
  if (!f) return <EmptyState>Farmer not found, or you don't have access.</EmptyState>;

  const totalHa = (farms.data ?? []).reduce((s, x) => s + Number(x.area_hectares), 0);
  const onRecord = (
    [
      ['nin', f.nin_last4],
      ['bvn', f.bvn_last4],
    ] as [NumberType, string | null][]
  )
    .filter(([, last4]) => last4)
    .map(([type, last4]) => ({ type, last4 }));
  const confirmed = identityConfirmed(
    onRecord.map((r) => r.type),
    checks.data ?? [],
  );
  const needsNote = !confirmed && !kycNote.trim();

  return (
    <>
      <Link to="/farmers" className="link-back mb-2">
        ← Farmers
      </Link>
      <PageHeader
        title={f.full_name}
        description={`${f.lga}, ${f.state}${f.ward ? ` · ${f.ward} ward` : ''}`}
        actions={
          can.enrol(profile?.role) ? (
            <Link to={`/farmers/${f.id}/map`}>
              <Button>
                <MapPinPlus className="size-4" aria-hidden /> Map a farm
              </Button>
            </Link>
          ) : null
        }
      />

      {justEnrolled && (
        <div className="mb-4">
          <Alert tone="success">Farmer enrolled. Next, walk or trace their farm boundary.</Alert>
        </div>
      )}
      {identityNotice && !identityNotice.ok && (
        <div className="mb-4">
          <Alert tone="warning" title="Identity not confirmed yet">
            {identityNotice.message}. Compliance will see this when reviewing KYC; you can check
            again below.
          </Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="space-y-4 lg:col-span-1">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-zinc-900">Details</h2>
            <KycBadge status={f.kyc_status} />
          </div>
          <dl className="space-y-3 text-sm">
            <Item label="Phone">{f.phone}</Item>
            <Item label="Gender">{f.gender ? titleCase(f.gender) : '—'}</Item>
            <Item label="Date of birth">{formatDate(f.date_of_birth)}</Item>
            <Item label="NIN">{f.nin_last4 ? `•••••••${f.nin_last4}` : '—'}</Item>
            <Item label="BVN">{f.bvn_last4 ? `•••••••${f.bvn_last4}` : '—'}</Item>
            <Item label="Cooperative">
              {f.cooperatives ? (
                <Link to={`/farmers?cooperative=${f.cooperatives.id}`} className="link">
                  {f.cooperatives.name}
                </Link>
              ) : (
                '—'
              )}
            </Item>
            <Item label="Enrolled">{formatDate(f.created_at)}</Item>
          </dl>

          <div className="space-y-2 border-t border-zinc-200 pt-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-zinc-700">Payout account</p>
              {(can.enrol(profile?.role) || can.reviewKyc(profile?.role)) && (
                <EditBankAccount
                  title={`Payout account for ${f.full_name}`}
                  description="Where the farmer's share of a harvest is paid. It must be in the farmer's own name; before paying through Paystack, the bank's name for the account is checked too."
                  current={f}
                  defaultName={f.full_name}
                  rpc="set_farmer_bank_account"
                  args={{ p_farmer_id: f.id }}
                  onSaved={farmer.reload}
                />
              )}
            </div>
            <p className="text-sm text-zinc-600">
              {f.account_number ? (
                <>
                  {f.bank_name} <span className="font-mono">{f.account_number}</span>
                  <span className="block text-xs text-zinc-500">{f.account_name}</span>
                </>
              ) : (
                'None on file. Their harvest surplus is paid by hand.'
              )}
            </p>
          </div>

          <div className="space-y-2 border-t border-zinc-200 pt-4">
            <p className="text-sm font-medium text-zinc-700">Identity checks</p>
            {checks.error ? (
              <Alert>{errorMessage(checks.error)}</Alert>
            ) : checks.loading && (!checks.data || checks.stale) ? (
              <Skeleton className="h-16 rounded-xl" />
            ) : (
              <IdentityChecks
                subject="farmer"
                subjectId={f.id}
                checks={checks.data ?? []}
                onRecord={onRecord}
                canRun={can.enrol(profile?.role) || can.reviewKyc(profile?.role)}
                onChecked={checks.reload}
              />
            )}
          </div>

          {f.kyc_note && (
            <div className="border-t border-zinc-200 pt-4 text-sm">
              <p className="font-medium text-zinc-700">Compliance note</p>
              <p className="mt-1 text-zinc-600">{f.kyc_note}</p>
              {f.kyc_reviewed_at && (
                <p className="mt-1 text-xs text-zinc-500">{formatDate(f.kyc_reviewed_at)}</p>
              )}
            </div>
          )}

          {can.reviewKyc(profile?.role) && (
            <div className="space-y-2 border-t border-zinc-200 pt-4">
              <p className="text-sm font-medium text-zinc-700">KYC decision</p>
              <Field
                label="Note"
                hint={
                  confirmed
                    ? 'Optional. Kept with the decision.'
                    : 'Needed to verify: not every number has a matching check. Say how you confirmed who they are.'
                }
              >
                <Textarea
                  rows={2}
                  value={kycNote}
                  onChange={(e) => setKycNote(e.target.value)}
                  maxLength={2000}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                {f.kyc_status !== 'verified' && (
                  <Button
                    busy={kycBusy === 'verified'}
                    disabled={needsNote}
                    title={needsNote ? 'Add a note, or run the identity checks first' : undefined}
                    onClick={() => setKyc('verified')}
                  >
                    Verify
                  </Button>
                )}
                {f.kyc_status !== 'rejected' && (
                  <Button
                    variant="danger"
                    busy={kycBusy === 'rejected'}
                    onClick={() => setKyc('rejected')}
                  >
                    Reject
                  </Button>
                )}
                {f.kyc_status !== 'pending' && (
                  <Button
                    variant="secondary"
                    busy={kycBusy === 'pending'}
                    onClick={() => setKyc('pending')}
                  >
                    Reset to pending
                  </Button>
                )}
              </div>
              {kycError && <Alert>{kycError}</Alert>}
            </div>
          )}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold text-zinc-900">Farms</h2>
            {farms.data && farms.data.length > 0 && (
              <span className="text-sm text-zinc-600">
                {farms.data.length} farm{farms.data.length === 1 ? '' : 's'} ·{' '}
                {formatHectares(totalHa)}
              </span>
            )}
          </div>
          {farms.loading && (!farms.data || farms.stale) ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : farms.error ? (
            <Alert>{errorMessage(farms.error)}</Alert>
          ) : farms.data!.length === 0 ? (
            <EmptyState>No farms mapped yet.</EmptyState>
          ) : (
            <>
              <FarmMap farms={farms.data} />
              <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white text-sm">
                {farms.data!.map((farm) => (
                  <li key={farm.id} className="flex flex-wrap justify-between gap-2 px-4 py-3">
                    <span className="font-medium text-zinc-900">{farm.name ?? 'Unnamed farm'}</span>
                    <span className="text-zinc-600">
                      {formatHectares(farm.area_hectares)}
                      {farm.primary_crop && ` · ${farm.primary_crop}`} ·{' '}
                      {titleCase(farm.tenure_type)} tenure
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right text-zinc-900">{children}</dd>
    </div>
  );
}
