import { Sprout } from 'lucide-react';
import { Link } from 'react-router';
import { Alert, EmptyState, PageHeader, Skeleton } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import type { Listing } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';
import { loadMyInvestorProfile } from './data';
import { ListingCard } from './shared';

export function MarketplacePage() {
  const state = useAsync(async () => {
    const [listings, profile] = await Promise.all([
      supabase.rpc('investor_marketplace'),
      loadMyInvestorProfile(),
    ]);
    if (listings.error) throw listings.error;
    return { listings: listings.data as Listing[], profile };
  }, []);

  return (
    <div>
      <PageHeader
        title="Farm cycles open for investment"
        description="Each cycle funds inputs for mapped, verified farms, with the harvest already sold to a contracted buyer and the crop insured. Returns are a share of what the harvest earns, so they can be lower than expected, or a loss."
      />
      <KycNotice profile={state.data?.profile} loading={state.loading && !state.data} />
      {state.error ? (
        <Alert>{errorMessage(state.error)}</Alert>
      ) : !state.data ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-96 rounded-2xl" />
          ))}
        </div>
      ) : state.data.listings.length === 0 ? (
        <EmptyState icon={<Sprout />} title="No cycles are open right now">
          New cycles open when a cooperative's farms are mapped, an offtaker has signed and
          compliance has approved them. Check back soon.
        </EmptyState>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {state.data.listings.map((l) => (
            <ListingCard key={l.id} listing={l} to={`/invest/${l.id}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function KycNotice({
  profile,
  loading,
}: {
  profile: Awaited<ReturnType<typeof loadMyInvestorProfile>> | undefined;
  loading: boolean;
}) {
  if (loading || profile?.kyc_status === 'verified') return null;
  const message = !profile
    ? 'Before you can invest, verify your identity and tell us where to pay your returns.'
    : profile.kyc_status === 'pending'
      ? 'Compliance is checking your details. You can browse cycles in the meantime.'
      : `Your KYC was not accepted: ${profile.review_note ?? 'see your profile'}.`;
  return (
    <div className="mb-6">
      <Alert
        tone={profile?.kyc_status === 'rejected' ? 'error' : profile ? 'info' : 'warning'}
        title={!profile ? 'Complete your KYC' : undefined}
      >
        {message}{' '}
        <Link to="/profile" className="font-medium underline underline-offset-2">
          {profile ? 'View your profile' : 'Start KYC'}
        </Link>
      </Alert>
    </div>
  );
}
