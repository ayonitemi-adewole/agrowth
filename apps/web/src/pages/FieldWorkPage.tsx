import {
  BadgeCheck,
  CalendarClock,
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
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SectionTitle,
  Skeleton,
} from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatHectares, titleCase } from '../lib/format';
import { loadWorkList, warmUpVisitPage } from '../lib/offline/assignments';
import { daysUntil, dueLabel } from '../lib/offline/due';
import { useOffline } from '../lib/offline/OfflineProvider';
import { visitKind, type CheckAssignment, type QueuedVisit } from '../lib/offline/types';
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

  /** The latest visit on this phone for a milestone or cycle and farm, not yet sent. */
  const queuedFor = (match: (v: QueuedVisit) => boolean): QueuedVisit | undefined =>
    [...visits].reverse().find((v) => match(v) && v.state !== 'synced');

  const nothingDue =
    list.data && list.data.assignments.length === 0 && list.data.checks.length === 0;

  return (
    <>
      <PageHeader
        title="Field visits"
        description="Milestone visits release money only after every farm passes. Routine checks track each farm's progress on a schedule, separate from the money. Visits you record with no signal are saved on this phone and sent when you're back in coverage."
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
      ) : nothingDue ? (
        <EmptyState icon={<ClipboardCheck />} title="No visits due">
          Farms appear here when a cycle manager requests verification for a milestone, and for
          routine checks once a cycle&apos;s season has begun.
        </EmptyState>
      ) : (
        <div className="space-y-10">
          {list.data!.assignments.length > 0 && (
            <section>
              <SectionTitle
                title="Milestone verification"
                description="A milestone's money is released only after every farm passes."
              />
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
                          const queued = queuedFor(
                            (v) =>
                              visitKind(v) === 'milestone' &&
                              v.milestoneId === m.id &&
                              v.farmId === f.id,
                          );
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
                                <XCircle
                                  className="size-4 shrink-0 text-red-500"
                                  aria-label="Failed"
                                />
                              ) : (
                                <MapPin
                                  className="size-4 shrink-0 text-zinc-400"
                                  aria-label="Not visited"
                                />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-zinc-900">
                                  {f.farmer}
                                </p>
                                <p className="truncate text-xs text-zinc-500">
                                  {f.name ?? 'Farm'} · {formatHectares(f.area_hectares)}
                                </p>
                              </div>
                              {queued ? (
                                <QueuedBadge v={queued} />
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
            </section>
          )}

          {list.data!.checks.length > 0 && (
            <section>
              <SectionTitle
                title="Routine farm checks"
                description="Visit each farm on schedule to record how it's doing. These don't hold back or release any money."
              />
              <div className="space-y-6">
                {list.data!.checks.map((c) => (
                  <CheckCard key={c.cycle.id} assignment={c} queuedFor={queuedFor} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}

function QueuedBadge({ v }: { v: QueuedVisit }) {
  return (
    <Badge tone={v.state === 'failed' ? 'red' : 'amber'}>
      {v.state === 'failed' ? 'Not accepted' : 'Waiting to send'}
    </Badge>
  );
}

function CheckCard({
  assignment: { cycle, farms },
  queuedFor,
}: {
  assignment: CheckAssignment;
  queuedFor: (match: (v: QueuedVisit) => boolean) => QueuedVisit | undefined;
}) {
  const sorted = [...farms].sort((a, b) => a.next_due_on.localeCompare(b.next_due_on));
  const overdue = farms.filter((f) => daysUntil(f.next_due_on) < 0).length;
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-zinc-500">{cycle.code}</p>
          <p className="mt-1 font-semibold text-zinc-950">
            {titleCase(cycle.crop)} · {cycle.season}
          </p>
          <p className="mt-0.5 text-sm text-zinc-500">
            Every {cycle.interval_days} days · {farms.length} farm{farms.length === 1 ? '' : 's'}
          </p>
        </div>
        {overdue > 0 ? (
          <Badge tone="red">{overdue} overdue</Badge>
        ) : (
          <Badge tone="green">On schedule</Badge>
        )}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((f) => {
          const queued = queuedFor(
            (v) => visitKind(v) === 'check' && v.cycleId === cycle.id && v.farmId === f.id,
          );
          const days = daysUntil(f.next_due_on);
          return (
            <li key={f.id} className="flex items-center gap-3 rounded-xl bg-zinc-50 px-3 py-2.5">
              {queued ? (
                <Hourglass
                  className="size-4 shrink-0 text-amber-600"
                  aria-label="Saved on this phone"
                />
              ) : (
                <CalendarClock
                  className={`size-4 shrink-0 ${days < 0 ? 'text-red-500' : days <= 2 ? 'text-amber-600' : 'text-zinc-400'}`}
                  aria-hidden
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-900">{f.farmer}</p>
                <p
                  className={`truncate text-xs ${days < 0 && !queued ? 'font-medium text-red-700' : 'text-zinc-500'}`}
                >
                  {f.name ?? 'Farm'} · {queued ? 'checked, not sent yet' : dueLabel(f.next_due_on)}
                </p>
              </div>
              {queued ? (
                <QueuedBadge v={queued} />
              ) : (
                <Link to={`/field/visit?cycle=${cycle.id}&farm=${f.id}`}>
                  <Button size="sm" variant={days <= 0 ? 'primary' : 'secondary'}>
                    Check
                  </Button>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
