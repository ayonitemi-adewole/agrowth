import { CalendarClock, MapPinned } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { FarmMap } from '../../components/FarmMap';
import { StoredPhotos } from '../../components/Photos';
import { useToast } from '../../components/Toast';
import {
  Alert,
  Badge,
  Button,
  Card,
  DescriptionList,
  EmptyState,
  Input,
  Modal,
  SectionTitle,
  Skeleton,
} from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatDate, titleCase } from '../../lib/format';
import { daysUntil, dueLabel } from '../../lib/offline/due';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { CropCondition, FarmCheck, FarmCheckDue } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';
import type { CycleFarm, TabProps } from './useCycleData';

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });

const CONDITION_TONE: Record<CropCondition, 'green' | 'blue' | 'amber' | 'red'> = {
  good: 'green',
  fair: 'blue',
  poor: 'amber',
  failed: 'red',
};

/** Checks run while the season is under way; the record stays afterwards. */
const RUNNING = ['funded', 'in_progress'];
const ENDED = ['harvested', 'settled', 'cancelled', 'refunded'];

async function loadChecks(cycleId: string) {
  const [due, checks] = await Promise.all([
    supabase.from('farm_check_schedule').select('*').eq('cycle_id', cycleId),
    supabase
      .from('farm_check_evidence')
      .select('*')
      .eq('cycle_id', cycleId)
      .order('visited_at', { ascending: false }),
  ]);
  if (due.error) throw due.error;
  if (checks.error) throw checks.error;
  return { due: due.data as FarmCheckDue[], checks: checks.data as FarmCheck[] };
}

/**
 * Routine farm checks: every farm is visited every N days once the season has begun, to
 * track its condition. Separate from milestones; nothing here holds back or releases money.
 */
export function FarmChecksTab({ data, reload }: TabProps) {
  const { cycle, farms } = data;
  const role = useAuth().profile?.role;
  const state = useAsync(() => loadChecks(cycle.id), [cycle.id, cycle.monitoring_interval_days]);
  const [shown, setShown] = useState<FarmCheck | null>(null);
  const farmById = new Map(farms.map((f) => [f.id, f]));
  const running = RUNNING.includes(cycle.status);

  const due = state.data?.due ?? [];
  const checks = state.data?.checks ?? [];
  const overdue = due.filter((d) => daysUntil(d.next_due_on) < 0).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle
            title="Routine farm checks"
            description="Once the season has begun, a field agent visits every farm on this schedule to record its condition, with a portrait of the farmer and photos of the farm. These checks are separate from milestones: they don't hold back or release any money."
          />
          <DescriptionList
            items={[
              ['Schedule', `Every ${cycle.monitoring_interval_days} days`],
              [
                'Checks',
                ENDED.includes(cycle.status)
                  ? 'Ended with the season'
                  : running && due[0]
                    ? `Started ${formatDate(due[0].starts_on)}`
                    : `Start when the season does${cycle.start_date ? ` (${formatDate(cycle.start_date)})` : ''}`,
              ],
              ...(running && due.length
                ? [
                    [
                      'Farms overdue',
                      overdue ? (
                        <span className="text-red-700">
                          {overdue} of {due.length}
                        </span>
                      ) : (
                        'None'
                      ),
                    ] as [string, ReactNode],
                  ]
                : []),
              ['Checks recorded', String(checks.length)],
            ]}
          />
        </Card>
        {can.manageCycles(role) && !ENDED.includes(cycle.status) && (
          <IntervalForm cycleId={cycle.id} days={cycle.monitoring_interval_days} onSaved={reload} />
        )}
      </div>

      {state.error ? (
        <Alert>{errorMessage(state.error)}</Alert>
      ) : state.loading && !state.data ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : (
        <>
          {running && due.length > 0 && (
            <Card>
              <SectionTitle
                title="Schedule"
                description="Only a check made at the farm (a precise GPS fix inside the boundary) moves a farm's next check on."
              />
              <div className="-mx-6 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-zinc-500">
                    <tr className="border-b border-zinc-950/5">
                      <th className="px-6 py-2 font-medium">Farmer</th>
                      <th className="px-3 py-2 font-medium">Last check</th>
                      <th className="px-3 py-2 font-medium">Next due</th>
                      <th className="px-6 py-2 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-950/5">
                    {[...due]
                      .sort((a, b) => a.next_due_on.localeCompare(b.next_due_on))
                      .map((d) => {
                        const farm = farmById.get(d.farm_id);
                        const days = daysUntil(d.next_due_on);
                        return (
                          <tr key={d.farm_id}>
                            <td className="px-6 py-3">
                              <p className="font-medium text-zinc-900">
                                {farm ? (
                                  <Link to={`/farmers/${farm.farmer_id}`} className="link">
                                    {farm.farmer_name}
                                  </Link>
                                ) : (
                                  'Farm'
                                )}
                              </p>
                              <p className="text-xs text-zinc-500">{farm?.name ?? 'Farm'}</p>
                            </td>
                            <td className="px-3 py-3 text-zinc-600">
                              {d.last_check_at ? (
                                <span className="flex flex-wrap items-center gap-2">
                                  {formatDate(d.last_check_at)}
                                  {d.last_condition && (
                                    <Badge tone={CONDITION_TONE[d.last_condition]}>
                                      {titleCase(d.last_condition)}
                                    </Badge>
                                  )}
                                </span>
                              ) : (
                                'Not checked yet'
                              )}
                            </td>
                            <td className="px-3 py-3 text-zinc-600">{formatDate(d.next_due_on)}</td>
                            <td className="px-6 py-3 text-right">
                              <Badge tone={days < 0 ? 'red' : days <= 2 ? 'amber' : 'neutral'}>
                                {dueLabel(d.next_due_on)}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {checks.length === 0 ? (
            <EmptyState icon={<CalendarClock />} title="No checks yet">
              {running
                ? 'Checks recorded by field agents appear here, with their photos and GPS position.'
                : 'Field agents start checking farms once the season begins.'}
            </EmptyState>
          ) : (
            <Card>
              <SectionTitle
                title="Checks"
                description="Newest first. Select one for its evidence."
              />
              <ul className="divide-y divide-zinc-950/5">
                {checks.map((k) => {
                  const farm = farmById.get(k.farm_id);
                  return (
                    <li key={k.id}>
                      <button
                        type="button"
                        onClick={() => setShown(k)}
                        className="flex w-full flex-wrap items-center gap-3 py-3 text-left first:pt-0 last:pb-0 hover:bg-zinc-50/60"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-zinc-900">
                            {farm?.farmer_name ?? 'Farm'} · {farm?.name ?? 'Farm'}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {dateTime(k.visited_at)}
                            {k.notes &&
                              ` · ${k.notes.slice(0, 80)}${k.notes.length > 80 ? '…' : ''}`}
                          </p>
                        </div>
                        <Badge tone={CONDITION_TONE[k.crop_condition]}>
                          {titleCase(k.crop_condition)}
                        </Badge>
                        {!k.gps_ok && (
                          <Badge tone="red">
                            <MapPinned className="size-3.5" aria-hidden />
                            {Math.round(Number(k.distance_from_boundary_m))} m away · not counted
                          </Badge>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </>
      )}

      <Modal
        open={!!shown && !!farmById.get(shown.farm_id)}
        onClose={() => setShown(null)}
        wide
        title={
          shown
            ? `${farmById.get(shown.farm_id)?.farmer_name ?? 'Farm'} · ${farmById.get(shown.farm_id)?.name ?? 'Farm'}`
            : 'Farm check'
        }
        description="Routine farm check"
      >
        {shown && farmById.get(shown.farm_id) && (
          <CheckEvidence key={shown.id} check={shown} farm={farmById.get(shown.farm_id)!} />
        )}
      </Modal>
    </div>
  );
}

function IntervalForm({
  cycleId,
  days,
  onSaved,
}: {
  cycleId: string;
  days: number;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [value, setValue] = useState(String(days));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('set_monitoring_interval', {
      p_cycle_id: cycleId,
      p_days: Number(value),
    });
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    toast.success(`Farms are now checked every ${value} days`);
    onSaved();
  };

  return (
    <Card>
      <form onSubmit={save} className="space-y-3">
        <SectionTitle
          title="Check interval"
          description="How many days between checks of each farm. Recorded in the history."
        />
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={90}
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-24"
            aria-label="Days between checks"
          />
          <span className="text-sm text-zinc-600">days</span>
        </div>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" busy={busy} disabled={Number(value) === days}>
          Save
        </Button>
      </form>
    </Card>
  );
}

function CheckEvidence({ check: k, farm }: { check: FarmCheck; farm: CycleFarm }) {
  // The dialog opens after this renders; the map waits a frame so it has a size to draw in.
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOnScreen(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const inside = Number(k.distance_from_boundary_m) === 0;
  const late = new Date(k.created_at).getTime() - new Date(k.visited_at).getTime() > 15 * 60_000;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={CONDITION_TONE[k.crop_condition]}>Crop: {titleCase(k.crop_condition)}</Badge>
        {k.gps_ok ? (
          <Badge tone="green">At the farm</Badge>
        ) : (
          <Badge tone="red">Not at the farm · not counted</Badge>
        )}
        <span className="text-sm text-zinc-500">
          Checked {dateTime(k.visited_at)}
          {late && ` · recorded offline, received ${dateTime(k.created_at)}`}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <div>
          <p className="mb-1.5 text-xs font-medium text-zinc-500">Farmer</p>
          <StoredPhotos
            bucket="field-photos"
            paths={[k.portrait_path]}
            alt={`Portrait of ${farm.farmer_name}`}
            imgClassName="aspect-[3/4]"
          />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-zinc-500">Farm</p>
          <StoredPhotos
            bucket="field-photos"
            paths={k.photo_paths}
            alt={`Photo of ${farm.name ?? 'the farm'}`}
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          />
        </div>
      </div>

      {onScreen ? (
        <FarmMap
          farms={[farm]}
          highlightId={farm.id}
          position={{ lon: k.lon, lat: k.lat, accuracy: Number(k.gps_accuracy_m) }}
          positionLabel="Check-in"
          fitPosition
          className="aspect-[16/9] w-full rounded-xl ring-1 ring-zinc-950/5"
        />
      ) : (
        <Skeleton className="aspect-[16/9] rounded-xl" />
      )}

      <DescriptionList
        items={[
          [
            'GPS check-in',
            <span className={k.gps_ok ? undefined : 'text-red-700'}>
              {inside
                ? 'Inside the boundary'
                : `${Math.round(Number(k.distance_from_boundary_m))} m outside the boundary`}{' '}
              · ±{Math.round(Number(k.gps_accuracy_m))} m
            </span>,
          ],
          ['Position', `${k.lat.toFixed(5)}, ${k.lon.toFixed(5)}`],
        ]}
      />
      {k.notes && (
        <div className="rounded-xl bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
          <p className="mb-1 text-xs font-medium text-zinc-500">Agent&apos;s notes</p>
          {k.notes}
        </div>
      )}
    </div>
  );
}
