import { Link, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { CycleStatusBadge } from '../../components/StatusBadges';
import { Alert, EmptyState, PageHeader, PageSkeleton, Tabs } from '../../components/ui';
import { FUNDING_SOURCE } from '../../lib/cycles';
import { errorMessage } from '../../lib/errors';
import { titleCase } from '../../lib/format';
import { can } from '../../lib/roles';
import { ContractsTab } from './ContractsTab';
import { FarmChecksTab } from './FarmChecksTab';
import { FarmsTab } from './FarmsTab';
import { FundingTab } from './FundingTab';
import { HarvestTab } from './HarvestTab';
import { HistoryTab } from './HistoryTab';
import { MilestonesTab } from './MilestonesTab';
import { OverviewTab } from './OverviewTab';
import { SettlementTab } from './SettlementTab';
import { useCycleData } from './useCycleData';
import { VouchersTab } from './VouchersTab';
import { WeatherTab } from './WeatherTab';

const TABS = [
  'overview',
  'farms',
  'milestones',
  'checks',
  'contracts',
  'funding',
  'vouchers',
  'harvest',
  'settlement',
  'weather',
  'history',
] as const;
type Tab = (typeof TABS)[number];

export function CycleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const state = useCycleData(id!);
  // The trustee doesn't see the farmer registry, so it gets no Farms tab.
  const role = useAuth().profile?.role;
  const seesFarms = can.readRegistry(role);
  // The open tab lives in the URL (?tab=milestones), so it survives a reload and can be linked to.
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('tab') as Tab | null;
  const tab: Tab = fromUrl && TABS.includes(fromUrl) ? fromUrl : 'overview';
  const setTab = (t: Tab) =>
    setParams(t === 'overview' ? {} : { tab: t }, { replace: true, preventScrollReset: true });

  if (state.loading && (!state.data || state.stale)) return <PageSkeleton variant="detail" />;
  if (state.error) return <Alert>{errorMessage(state.error)}</Alert>;
  const data = state.data;
  if (!data)
    return (
      <EmptyState title="Cycle not found">It may not exist, or you don't have access.</EmptyState>
    );

  const { cycle } = data;
  const props = { data, reload: state.reload };
  const underway = ['in_progress', 'harvested', 'settled'].includes(cycle.status);
  // Weather is watched from submission until the season is settled.
  const watched = [
    'pending_approval',
    'open_for_funding',
    'funded',
    'in_progress',
    'harvested',
    'settled',
  ].includes(cycle.status);
  // Routine farm checks run from when the season begins; their record stays afterwards.
  const checked =
    seesFarms && ['funded', 'in_progress', 'harvested', 'settled'].includes(cycle.status);
  const usesVouchers =
    data.vouchers.length > 0 || data.disbursements.some((d) => d.payee_kind === 'input_voucher');

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/cycles" className="link-back">
            ← Funding cycles
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {titleCase(cycle.crop)} · {cycle.season}
            <CycleStatusBadge status={cycle.status} />
          </span>
        }
        description={
          <>
            <span className="font-mono">{cycle.code}</span> · {FUNDING_SOURCE[cycle.funding_source]}
            {cycle.programme_id && can.readProgrammes(role) && (
              <>
                {' · '}
                <Link
                  to={`/programmes/${cycle.programme_id}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  View programme
                </Link>
              </>
            )}
          </>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          ...(seesFarms
            ? [{ id: 'farms' as const, label: 'Farms', count: data.farms.length }]
            : []),
          { id: 'milestones', label: 'Milestones', count: data.milestones.length },
          ...(checked ? [{ id: 'checks' as const, label: 'Farm checks' }] : []),
          {
            id: 'contracts',
            label: 'Offtake & insurance',
            count: data.offtake.length + data.insurance.length,
          },
          { id: 'funding', label: 'Funding', count: data.contributions.length },
          ...(usesVouchers
            ? [{ id: 'vouchers' as const, label: 'Vouchers', count: data.vouchers.length }]
            : []),
          ...(underway
            ? [
                {
                  id: 'harvest' as const,
                  label: 'Harvest',
                  count: data.deliveries.filter((d) => !d.voided_at).length,
                },
                { id: 'settlement' as const, label: 'Settlement', count: data.payouts.length },
              ]
            : []),
          ...(watched ? [{ id: 'weather' as const, label: 'Weather' }] : []),
          { id: 'history', label: 'History', count: data.events.length },
        ]}
      />

      <div key={tab} className="animate-fade-in">
        {tab === 'overview' && <OverviewTab {...props} goTo={setTab} />}
        {tab === 'farms' && <FarmsTab {...props} />}
        {tab === 'milestones' && <MilestonesTab {...props} />}
        {tab === 'checks' && <FarmChecksTab {...props} />}
        {tab === 'contracts' && <ContractsTab {...props} />}
        {tab === 'funding' && <FundingTab {...props} />}
        {tab === 'vouchers' && <VouchersTab {...props} />}
        {tab === 'harvest' && <HarvestTab {...props} />}
        {tab === 'settlement' && <SettlementTab {...props} />}
        {tab === 'weather' && <WeatherTab {...props} />}
        {tab === 'history' && <HistoryTab {...props} />}
      </div>
    </>
  );
}

export type { TabProps } from './useCycleData';
