import { CalendarDays, MapPinned, Plus, Wheat } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { CycleForm } from '../components/CycleForm';
import { CycleStatusBadge } from '../components/StatusBadges';
import {
  Alert,
  Button,
  EmptyState,
  Modal,
  PageHeader,
  Progress,
  Skeleton,
  Tabs,
} from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatDate, formatHectares, titleCase } from '../lib/format';
import { formatNaira, ratio } from '../lib/money';
import { can } from '../lib/roles';
import { supabase } from '../lib/supabase';
import type { CycleStatus, CycleSummary } from '../lib/types';
import { useAsync } from '../lib/useAsync';

type Filter = 'all' | 'building' | 'funding' | 'active' | 'closed';

const FILTERS: Record<Filter, CycleStatus[] | null> = {
  all: null,
  building: ['draft', 'pending_approval'],
  funding: ['open_for_funding'],
  active: ['funded', 'in_progress', 'harvested'],
  closed: ['settled', 'cancelled', 'refunded'],
};

export function CyclesPage() {
  const { profile } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);

  const data = useAsync(async () => {
    const [cycles, funding] = await Promise.all([
      supabase.from('cycle_summaries').select('*').order('created_at', { ascending: false }),
      supabase.from('cycle_funding').select('cycle_id, raised_kobo'),
    ]);
    if (cycles.error) throw cycles.error;
    if (funding.error) throw funding.error;
    const raised = new Map(
      funding.data.map((f) => [f.cycle_id as string, f.raised_kobo as number]),
    );
    return (cycles.data as CycleSummary[]).map((c) => ({ ...c, raised: raised.get(c.id) ?? 0 }));
  }, []);

  const all = data.data ?? [];
  const shown = FILTERS[filter] ? all.filter((c) => FILTERS[filter]!.includes(c.status)) : all;
  const count = (f: Filter) =>
    FILTERS[f] ? all.filter((c) => FILTERS[f]!.includes(c.status)).length : all.length;

  return (
    <>
      <PageHeader
        title="Funding cycles"
        description="Each cycle funds one season on a set of verified farms, against a signed offtake and an insurance policy."
        actions={
          can.manageCycles(profile?.role) && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> New cycle
            </Button>
          )
        }
      />

      <Tabs
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: 'all', label: 'All', count: count('all') },
          { id: 'building', label: 'Being built', count: count('building') },
          { id: 'funding', label: 'Raising funds', count: count('funding') },
          { id: 'active', label: 'Active', count: count('active') },
          { id: 'closed', label: 'Closed', count: count('closed') },
        ]}
      />

      {data.loading && !data.data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-48 rounded-2xl" />
          ))}
        </div>
      ) : data.error ? (
        <Alert>{errorMessage(data.error)}</Alert>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<Wheat />}
          title={filter === 'all' ? 'No cycles yet' : 'Nothing here'}
          action={
            filter === 'all' &&
            can.manageCycles(profile?.role) && (
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden /> Create the first cycle
              </Button>
            )
          }
        >
          {filter === 'all'
            ? 'A cycle groups farms, a budget and a buyer for one season.'
            : 'No cycles in this stage.'}
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((c) => (
            <Link
              key={c.id}
              to={`/cycles/${c.id}`}
              className="group flex flex-col rounded-2xl bg-white p-5 shadow-card ring-1 ring-zinc-950/5 transition hover:shadow-pop hover:ring-brand-600/20"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-zinc-500">{c.code}</p>
                  <p className="mt-1 truncate text-base font-semibold text-zinc-950 group-hover:text-brand-800">
                    {titleCase(c.crop)} · {c.season}
                  </p>
                </div>
                <CycleStatusBadge status={c.status} />
              </div>

              <div className="mt-5">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-semibold text-zinc-900 tabular-nums">
                    {formatNaira(c.raised, { compact: true })}
                  </span>
                  <span className="text-zinc-500">
                    of {formatNaira(c.target_amount_kobo, { compact: true })}
                  </span>
                </div>
                <Progress value={ratio(c.raised, c.target_amount_kobo)} className="mt-2" />
              </div>

              <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-zinc-950/5 pt-4 text-xs text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <MapPinned className="size-3.5" aria-hidden />
                  {c.farm_count} farms · {formatHectares(c.hectares)}
                </span>
                {c.expected_harvest_date && (
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="size-3.5" aria-hidden />
                    Harvest {formatDate(c.expected_harvest_date)}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New funding cycle"
        description="Start with the basics. You'll add farms, milestones and contracts next."
        wide
      >
        <CycleForm onDone={() => setCreating(false)} />
      </Modal>
    </>
  );
}
