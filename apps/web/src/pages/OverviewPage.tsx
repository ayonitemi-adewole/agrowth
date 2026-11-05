import { Clock, MapPinned, UsersRound, Warehouse } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Alert, Card, PageHeader } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatHectares } from '../lib/format';
import { can, ROLE_LABELS } from '../lib/roles';
import { supabase } from '../lib/supabase';
import { useAsync } from '../lib/useAsync';

async function loadStats() {
  const count = async (table: string, filter?: [string, string]) => {
    let q = supabase.from(table).select('*', { count: 'exact', head: true });
    if (filter) q = q.eq(filter[0], filter[1]);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  };
  const [cooperatives, farmers, pendingKyc, farms] = await Promise.all([
    count('cooperatives'),
    count('farmers'),
    count('farmers', ['kyc_status', 'pending']),
    supabase.from('farms').select('area_hectares'),
  ]);
  if (farms.error) throw farms.error;
  const hectares = farms.data.reduce((sum, f) => sum + Number(f.area_hectares), 0);
  return { cooperatives, farmers, pendingKyc, farmCount: farms.data.length, hectares };
}

export function OverviewPage() {
  const { profile } = useAuth();
  const stats = useAsync(loadStats, []);
  const role = profile?.role;

  return (
    <>
      <PageHeader
        title={`Welcome${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`}
        description={role ? `Signed in as ${ROLE_LABELS[role]}` : undefined}
      />
      {stats.error ? (
        <Alert>{errorMessage(stats.error)}</Alert>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            icon={<Warehouse />}
            label="Cooperatives"
            value={stats.data?.cooperatives}
            to="/cooperatives"
          />
          <Stat
            icon={<UsersRound />}
            label="Farmers enrolled"
            value={stats.data?.farmers}
            to="/farmers"
          />
          <Stat
            icon={<MapPinned />}
            label="Land mapped"
            value={stats.data && formatHectares(stats.data.hectares)}
            sub={stats.data && `${stats.data.farmCount} farms`}
          />
          <Stat
            icon={<Clock />}
            label="Awaiting KYC"
            value={stats.data?.pendingKyc}
            to={can.reviewKyc(role) ? '/farmers?kyc=pending' : undefined}
          />
        </div>
      )}
    </>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  to,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  to?: string;
}) {
  const body = (
    <Card className={to ? 'transition-colors hover:border-green-300' : undefined}>
      <div className="flex items-center gap-2 text-sm text-stone-600 [&_svg]:size-4">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold text-stone-900 tabular-nums">{value ?? '…'}</p>
      {sub && <p className="text-xs text-stone-500">{sub}</p>}
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}
