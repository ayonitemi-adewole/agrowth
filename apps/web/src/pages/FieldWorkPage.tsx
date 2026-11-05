import { BadgeCheck, ClipboardCheck, MapPin, XCircle } from 'lucide-react';
import { Link } from 'react-router';
import { MilestoneStatusBadge } from '../components/StatusBadges';
import { Alert, Button, Card, EmptyState, PageHeader, Skeleton } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatHectares, titleCase } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { FieldVisit, Milestone } from '../lib/types';
import { useAsync } from '../lib/useAsync';

interface Task {
  milestone: Milestone & { cycles: { code: string; crop: string; season: string } };
  farms: {
    id: string;
    name: string | null;
    area_hectares: number;
    farmer: string;
    latest: Pick<FieldVisit, 'passed' | 'visited_at'> | undefined;
  }[];
}

async function loadTasks(): Promise<Task[]> {
  const { data: milestones, error } = await supabase
    .from('milestones')
    .select('*, cycles(code, crop, season)')
    .in('status', ['awaiting_verification', 'blocked'])
    .order('verification_requested_at');
  if (error) throw error;
  if (!milestones.length) return [];

  const cycleIds = [...new Set(milestones.map((m) => m.cycle_id as string))];
  const [links, visits] = await Promise.all([
    supabase
      .from('cycle_farms')
      .select('cycle_id, farms(id, name, area_hectares, farmers(full_name))')
      .in('cycle_id', cycleIds),
    supabase
      .from('field_visits')
      .select('farm_id, milestone_id, passed, visited_at')
      .in(
        'milestone_id',
        milestones.map((m) => m.id as string),
      )
      .order('visited_at', { ascending: false }),
  ]);
  if (links.error) throw links.error;
  if (visits.error) throw visits.error;

  type Link = {
    cycle_id: string;
    farms: {
      id: string;
      name: string | null;
      area_hectares: number;
      farmers: { full_name: string };
    };
  };
  return (milestones as Task['milestone'][]).map((m) => ({
    milestone: m,
    farms: (links.data as unknown as Link[])
      .filter((l) => l.cycle_id === m.cycle_id)
      .map(({ farms: f }) => ({
        id: f.id,
        name: f.name,
        area_hectares: f.area_hectares,
        farmer: f.farmers.full_name,
        latest: visits.data.find(
          (v) =>
            v.milestone_id === m.id &&
            v.farm_id === f.id &&
            (!m.verification_requested_at || v.visited_at >= m.verification_requested_at),
        ),
      })),
  }));
}

export function FieldWorkPage() {
  const tasks = useAsync(loadTasks, []);

  return (
    <>
      <PageHeader
        title="Field visits"
        description="Farms waiting for a verification visit. A milestone's money is released only after every farm passes."
      />
      {tasks.loading && !tasks.data ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : tasks.error ? (
        <Alert>{errorMessage(tasks.error)}</Alert>
      ) : tasks.data!.length === 0 ? (
        <EmptyState icon={<ClipboardCheck />} title="No visits due">
          When a cycle manager requests verification for a milestone, its farms appear here.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {tasks.data!.map(({ milestone: m, farms }) => {
            const todo = farms.filter((f) => !f.latest?.passed);
            return (
              <Card key={m.id}>
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-zinc-500">{m.cycles.code}</p>
                    <p className="mt-1 font-semibold text-zinc-950">
                      {titleCase(m.cycles.crop)} · milestone {m.sequence}: {m.name}
                    </p>
                    <p className="mt-0.5 text-sm text-zinc-500">
                      {todo.length} of {farms.length} farms still to pass
                    </p>
                  </div>
                  <MilestoneStatusBadge status={m.status} />
                </div>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {farms.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center gap-3 rounded-xl bg-zinc-50 px-3 py-2.5"
                    >
                      {f.latest?.passed ? (
                        <BadgeCheck
                          className="size-4 shrink-0 text-brand-600"
                          aria-label="Passed"
                        />
                      ) : f.latest ? (
                        <XCircle className="size-4 shrink-0 text-red-500" aria-label="Failed" />
                      ) : (
                        <MapPin
                          className="size-4 shrink-0 text-zinc-400"
                          aria-label="Not visited"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-zinc-900">{f.farmer}</p>
                        <p className="truncate text-xs text-zinc-500">
                          {f.name ?? 'Farm'} · {formatHectares(f.area_hectares)}
                        </p>
                      </div>
                      {!f.latest?.passed && (
                        <Link to={`/field/visit?milestone=${m.id}&farm=${f.id}`}>
                          <Button size="sm">{f.latest ? 'Revisit' : 'Visit'}</Button>
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
