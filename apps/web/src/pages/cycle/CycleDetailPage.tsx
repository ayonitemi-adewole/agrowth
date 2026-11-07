import { Link, useParams, useSearchParams } from 'react-router';
import { CycleStatusBadge } from '../../components/StatusBadges';
import { Alert, EmptyState, PageHeader, Skeleton, Tabs } from '../../components/ui';
import { FUNDING_SOURCE } from '../../lib/cycles';
import { errorMessage } from '../../lib/errors';
import { titleCase } from '../../lib/format';
import { ContractsTab } from './ContractsTab';
import { FarmsTab } from './FarmsTab';
import { FundingTab } from './FundingTab';
import { HarvestTab } from './HarvestTab';
import { HistoryTab } from './HistoryTab';
import { MilestonesTab } from './MilestonesTab';
import { OverviewTab } from './OverviewTab';
import { SettlementTab } from './SettlementTab';
import { useCycleData } from './useCycleData';

const TABS = [
  'overview',
  'farms',
  'milestones',
  'contracts',
  'funding',
  'harvest',
  'settlement',
  'history',
] as const;
type Tab = (typeof TABS)[number];

export function CycleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const state = useCycleData(id!);
  // The open tab lives in the URL (?tab=milestones), so it survives a reload and can be linked to.
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('tab') as Tab | null;
  const tab: Tab = fromUrl && TABS.includes(fromUrl) ? fromUrl : 'overview';
  const setTab = (t: Tab) =>
    setParams(t === 'overview' ? {} : { tab: t }, { replace: true, preventScrollReset: true });

  if (state.loading && !state.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (state.error) return <Alert>{errorMessage(state.error)}</Alert>;
  const data = state.data;
  if (!data)
    return (
      <EmptyState title="Cycle not found">It may not exist, or you don't have access.</EmptyState>
    );

  const { cycle } = data;
  const props = { data, reload: state.reload };
  const underway = ['in_progress', 'harvested', 'settled'].includes(cycle.status);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/cycles" className="hover:text-zinc-800">
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
          </>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'farms', label: 'Farms', count: data.farms.length },
          { id: 'milestones', label: 'Milestones', count: data.milestones.length },
          {
            id: 'contracts',
            label: 'Offtake & insurance',
            count: data.offtake.length + data.insurance.length,
          },
          { id: 'funding', label: 'Funding', count: data.contributions.length },
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
          { id: 'history', label: 'History', count: data.events.length },
        ]}
      />

      <div key={tab} className="animate-fade-in">
        {tab === 'overview' && <OverviewTab {...props} goTo={setTab} />}
        {tab === 'farms' && <FarmsTab {...props} />}
        {tab === 'milestones' && <MilestonesTab {...props} />}
        {tab === 'contracts' && <ContractsTab {...props} />}
        {tab === 'funding' && <FundingTab {...props} />}
        {tab === 'harvest' && <HarvestTab {...props} />}
        {tab === 'settlement' && <SettlementTab {...props} />}
        {tab === 'history' && <HistoryTab {...props} />}
      </div>
    </>
  );
}

export type { TabProps } from './useCycleData';
