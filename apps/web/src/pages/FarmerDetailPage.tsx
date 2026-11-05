import { MapPinPlus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { FarmMap } from '../components/FarmMap';
import { Alert, Button, Card, EmptyState, KycBadge, PageHeader, Spinner } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatDate, formatHectares, titleCase } from '../lib/format';
import { can } from '../lib/roles';
import { supabase } from '../lib/supabase';
import type { Farmer, FarmMap as Farm, KycStatus } from '../lib/types';
import { useAsync } from '../lib/useAsync';

type FarmerRow = Farmer & { cooperatives: { id: string; name: string } | null };

export function FarmerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const location = useLocation();
  const justEnrolled = (location.state as { justEnrolled?: boolean } | null)?.justEnrolled;
  const [kycBusy, setKycBusy] = useState<KycStatus | null>(null);
  const [kycError, setKycError] = useState<string | null>(null);

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
    const { error } = await supabase.rpc('set_farmer_kyc', { p_farmer_id: id, p_status: status });
    setKycBusy(null);
    if (error) setKycError(errorMessage(error));
    else farmer.reload();
  };

  if (farmer.loading && !farmer.data) return <Spinner />;
  if (farmer.error) return <Alert>{errorMessage(farmer.error)}</Alert>;
  const f = farmer.data;
  if (!f) return <EmptyState>Farmer not found, or you don't have access.</EmptyState>;

  const totalHa = (farms.data ?? []).reduce((s, x) => s + Number(x.area_hectares), 0);

  return (
    <>
      <Link to="/farmers" className="mb-2 inline-block text-sm text-zinc-500 hover:text-zinc-800">
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
                <Link to={`/farmers?cooperative=${f.cooperatives.id}`} className="hover:underline">
                  {f.cooperatives.name}
                </Link>
              ) : (
                '—'
              )}
            </Item>
            <Item label="Enrolled">{formatDate(f.created_at)}</Item>
          </dl>

          {can.reviewKyc(profile?.role) && (
            <div className="space-y-2 border-t border-zinc-200 pt-4">
              <p className="text-sm font-medium text-zinc-700">KYC decision</p>
              <div className="flex flex-wrap gap-2">
                {f.kyc_status !== 'verified' && (
                  <Button busy={kycBusy === 'verified'} onClick={() => setKyc('verified')}>
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
          {farms.loading ? (
            <Spinner />
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
