import {
  BadgeCheck,
  ClipboardCheck,
  CloudOff,
  Hourglass,
  MapPin,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { MilestoneStatusBadge } from '../components/StatusBadges';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Skeleton } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatHectares, titleCase } from '../lib/format';
import { loadWorkList, warmUpVisitPage } from '../lib/offline/assignments';
import { useOffline } from '../lib/offline/OfflineProvider';
import type { QueuedVisit } from '../lib/offline/types';
import { useAsync } from '../lib/useAsync';
import { OutboxList } from './field/OutboxList';

const time = (iso: string) =>
  new Date(iso).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });

export function FieldWorkPage() {
  const { profile } = useAuth();
  const { online, visits } = useOffline();
  // Reload when the connection comes back, so the list (and the saved copy) is current.
  const list = useAsync(() => loadWorkList(profile!.id), [profile?.id, online]);

  useEffect(() => {
    if (online) warmUpVisitPage();
  }, [online]);

  const queuedFor = (milestoneId: string, farmId: string): QueuedVisit | undefined =>
    [...visits]
      .reverse()
      .find((v) => v.milestoneId === milestoneId && v.farmId === farmId && v.state !== 'synced');

  return (
    <>
      <PageHeader
        title="Field visits"
        description="Farms waiting for a verification visit. A milestone's money is released only after every farm passes. Visits you record with no signal are saved on this phone and sent when you're back in coverage."
        actions={
          online && (
            <Button variant="secondary" onClick={list.reload} busy={list.loading}>
              <RefreshCw aria-hidden /> Refresh
            </Button>
          )
        }
      />

      {list.data && (
        <div className="mb-6">
          {list.data.fromPhone ? (
            <Alert tone="warning" title="Working offline">
              Showing the list saved on this phone at {time(list.data.savedAt)}. Map imagery needs a
              connection; farm boundaries and your GPS position still show.
            </Alert>
          ) : (
            <p className="flex items-center gap-2 text-xs text-zinc-500">
              <CloudOff className="size-3.5" aria-hidden /> Saved on this phone for offline use at{' '}
              {time(list.data.savedAt)}.
            </p>
          )}
        </div>
      )}

      <OutboxList />

      {list.loading && !list.data ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : list.error ? (
        <Alert>{errorMessage(list.error)}</Alert>
      ) : list.data!.assignments.length === 0 ? (
        <EmptyState icon={<ClipboardCheck />} title="No visits due">
          When a cycle manager requests verification for a milestone, its farms appear here.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {list.data!.assignments.map(({ milestone: m, farms }) => {
            const todo = farms.filter((f) => !f.latest?.passed);
            return (
              <Card key={m.id}>
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-zinc-500">{m.cycle.code}</p>
                    <p className="mt-1 font-semibold text-zinc-950">
                      {titleCase(m.cycle.crop)} · milestone {m.sequence}: {m.name}
                    </p>
                    <p className="mt-0.5 text-sm text-zinc-500">
                      {todo.length} of {farms.length} farms still to pass
                    </p>
                  </div>
                  <MilestoneStatusBadge status={m.status} />
                </div>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {farms.map((f) => {
                    const queued = queuedFor(m.id, f.id);
                    return (
                      <li
                        key={f.id}
                        className="flex items-center gap-3 rounded-xl bg-zinc-50 px-3 py-2.5"
                      >
                        {queued ? (
                          <Hourglass
                            className="size-4 shrink-0 text-amber-600"
                            aria-label="Saved on this phone"
                          />
                        ) : f.latest?.passed ? (
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
                        {queued ? (
                          <Badge tone={queued.state === 'failed' ? 'red' : 'amber'}>
                            {queued.state === 'failed' ? 'Not accepted' : 'Waiting to send'}
                          </Badge>
                        ) : (
                          !f.latest?.passed && (
                            <Link to={`/field/visit?milestone=${m.id}&farm=${f.id}`}>
                              <Button size="sm">{f.latest ? 'Revisit' : 'Visit'}</Button>
                            </Link>
                          )
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
