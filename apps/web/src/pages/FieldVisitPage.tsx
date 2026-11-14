import { CheckCircle2, CloudOff, Crosshair, FlaskConical, XCircle } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { FarmMap } from '../components/FarmMap';
import { PhotoPicker, PortraitPicker } from '../components/Photos';
import {
  Alert,
  Button,
  Card,
  Field,
  PageHeader,
  PageSkeleton,
  SectionTitle,
  Textarea,
  cx,
} from '../components/ui';
import { demo } from '../lib/demo';
import { errorMessage } from '../lib/errors';
import { formatDate, formatHectares } from '../lib/format';
import { dueLabel } from '../lib/offline/due';
import { useOffline } from '../lib/offline/OfflineProvider';
import { snapshots } from '../lib/offline/store';
import { isNetworkError } from '../lib/offline/sync';
import { isCheckResult, type QueuedVisit, type VisitFarm } from '../lib/offline/types';
import { supabase } from '../lib/supabase';
import type { CropCondition, FarmMap as Farm } from '../lib/types';
import { useAsync } from '../lib/useAsync';

/** Must match private.max_checkin_metres() in the database. */
const MAX_ACCURACY_M = 20;

const CHECKLIST = [
  'The farmer or a family member was present',
  'The crop and work match what this milestone paid for',
  'Inputs from the last release were used on this farm',
  'No sign of the farm being shared with another programme',
];

const CONDITIONS: { value: CropCondition; label: string; hint: string }[] = [
  { value: 'good', label: 'Good', hint: 'On track' },
  { value: 'fair', label: 'Fair', hint: 'Minor issues' },
  { value: 'poor', label: 'Poor', hint: 'Serious issues' },
  { value: 'failed', label: 'Failed', hint: 'Crop lost' },
];

interface Fix {
  lon: number;
  lat: number;
  accuracy: number;
  at: string;
}

/** What the visit is for: verifying a milestone, or a routine check of the farm. */
type Purpose =
  | { kind: 'milestone'; id: string; sequence: number; name: string; code: string }
  | {
      kind: 'check';
      cycleId: string;
      code: string;
      intervalDays: number;
      /** When the farm's next check is due; null if it isn't on the schedule (yet). */
      nextDueOn: string | null;
    };

type Wanted = { kind: 'milestone'; id: string } | { kind: 'check'; cycleId: string };

type FarmRow = Farm & { farmers: { full_name: string } };

const toVisitFarm = (f: FarmRow): VisitFarm => ({ ...f, farmer: f.farmers.full_name });

async function fetchPurpose(wanted: Wanted, farmId: string): Promise<Purpose | null> {
  if (wanted.kind === 'milestone') {
    const { data, error } = await supabase
      .from('milestones')
      .select('id, sequence, name, cycles(code)')
      .eq('id', wanted.id)
      .maybeSingle();
    if (error) throw error;
    const m = data as unknown as {
      id: string;
      sequence: number;
      name: string;
      cycles: { code: string };
    } | null;
    return m
      ? { kind: 'milestone', id: m.id, sequence: m.sequence, name: m.name, code: m.cycles.code }
      : null;
  }
  const [cycle, due] = await Promise.all([
    supabase
      .from('cycles')
      .select('id, code, monitoring_interval_days')
      .eq('id', wanted.cycleId)
      .maybeSingle(),
    supabase
      .from('farm_check_schedule')
      .select('next_due_on')
      .eq('cycle_id', wanted.cycleId)
      .eq('farm_id', farmId)
      .maybeSingle(),
  ]);
  if (cycle.error) throw cycle.error;
  if (due.error) throw due.error;
  const c = cycle.data as { id: string; code: string; monitoring_interval_days: number } | null;
  return c
    ? {
        kind: 'check',
        cycleId: c.id,
        code: c.code,
        intervalDays: c.monitoring_interval_days,
        nextDueOn: (due.data?.next_due_on as string | undefined) ?? null,
      }
    : null;
}

/** The farm and what the visit is for, from the server or the work list saved on the phone. */
async function loadVisit(
  userId: string,
  farmId: string,
  wanted: Wanted,
): Promise<{ fromPhone: boolean; farm: VisitFarm | null; purpose: Purpose | null }> {
  try {
    const [farm, purpose] = await Promise.all([
      supabase.from('farm_maps').select('*, farmers(full_name)').eq('id', farmId).maybeSingle(),
      fetchPurpose(wanted, farmId),
    ]);
    if (farm.error) throw farm.error;
    const f = farm.data as FarmRow | null;
    return { fromPhone: false, farm: f ? toVisitFarm(f) : null, purpose };
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const saved = await snapshots.get(userId);
    if (wanted.kind === 'milestone') {
      const a = saved?.assignments.find((x) => x.milestone.id === wanted.id);
      return {
        fromPhone: true,
        farm: a?.farms.find((x) => x.id === farmId) ?? null,
        purpose: a
          ? {
              kind: 'milestone',
              id: a.milestone.id,
              sequence: a.milestone.sequence,
              name: a.milestone.name,
              code: a.milestone.cycle.code,
            }
          : null,
      };
    }
    const c = saved?.checks?.find((x) => x.cycle.id === wanted.cycleId);
    const f = c?.farms.find((x) => x.id === farmId);
    return {
      fromPhone: true,
      farm: f ?? null,
      purpose: c
        ? {
            kind: 'check',
            cycleId: c.cycle.id,
            code: c.cycle.code,
            intervalDays: c.cycle.interval_days,
            nextDueOn: f?.next_due_on ?? null,
          }
        : null,
    };
  }
}

export function FieldVisitPage() {
  const [params] = useSearchParams();
  const farmId = params.get('farm')!;
  const milestoneId = params.get('milestone');
  const cycleId = params.get('cycle');
  const wanted: Wanted = milestoneId
    ? { kind: 'milestone', id: milestoneId }
    : { kind: 'check', cycleId: cycleId! };
  const { profile } = useAuth();
  const { queue, online } = useOffline();

  const info = useAsync(
    () => loadVisit(profile!.id, farmId, wanted),
    [profile?.id, farmId, milestoneId, cycleId],
  );

  // Live GPS: keep the best fix while the page is open.
  const [fix, setFix] = useState<Fix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const watchId = useRef<number | null>(null);

  const startGps = () => {
    if (!navigator.geolocation) {
      setGpsError('This device cannot share its location.');
      return;
    }
    setGpsError(null);
    setWatching(true);
    watchId.current = navigator.geolocation.watchPosition(
      (pos) =>
        setFix((prev) => {
          const next = {
            lon: pos.coords.longitude,
            lat: pos.coords.latitude,
            accuracy: pos.coords.accuracy,
            at: new Date(pos.timestamp).toISOString(),
          };
          // Prefer a more precise fix; otherwise take the newest.
          return prev && prev.accuracy < next.accuracy && prev.accuracy <= MAX_ACCURACY_M
            ? prev
            : next;
        }),
      (err) => setGpsError(`Could not get your location: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );
  };
  useEffect(
    () => () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    },
    [],
  );

  // Development server only: pretend to stand at the farm's centre with a precise fix, for
  // testing farms mapped somewhere you can't go. A production build has no such button.
  const simulateAtFarm = (centre: { lon: number; lat: number }) => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setGpsError(null);
    setWatching(true);
    setSimulated(true);
    setFix({ ...centre, accuracy: 5, at: new Date().toISOString() });
  };

  const [checks, setChecks] = useState<boolean[]>(CHECKLIST.map(() => false));
  const [condition, setCondition] = useState<CropCondition | null>(null);
  const [notes, setNotes] = useState('');
  const [portrait, setPortrait] = useState<File | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueuedVisit | null>(null);

  if (info.loading && (!info.data || info.stale)) return <PageSkeleton variant="detail" />;
  if (info.error) return <Alert>{errorMessage(info.error)}</Alert>;
  const { farm, purpose, fromPhone } = info.data!;
  if (!farm || !purpose)
    return (
      <Alert>
        {fromPhone
          ? "This farm isn't in the work list saved on this phone. Open Field visits with a connection to update it."
          : wanted.kind === 'milestone'
            ? "Farm or milestone not found, or you don't have access."
            : "Farm or cycle not found, or you don't have access."}
      </Alert>
    );

  const isCheck = purpose.kind === 'check';
  const noun = isCheck ? 'check' : 'visit';
  const purposeLabel =
    purpose.kind === 'milestone'
      ? `${purpose.code}, milestone ${purpose.sequence}: ${purpose.name}`
      : `${purpose.code}, routine farm check`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!fix || !condition || !portrait || photos.length === 0) return;
    setBusy(true);
    setError(null);
    const photo = (p: File, fallback: string) => ({
      name: p.name || fallback,
      type: p.type,
      blob: p,
    });
    try {
      // Every visit is saved on the phone first, then sent: nothing is lost if the signal
      // drops part-way, and a resend can't record it twice.
      const saved = await queue({
        id: crypto.randomUUID(),
        userId: profile!.id,
        farmId,
        ...(purpose.kind === 'milestone'
          ? { kind: 'milestone' as const, milestoneId: purpose.id }
          : { kind: 'check' as const, cycleId: purpose.cycleId }),
        farmLabel: `${farm.farmer} · ${farm.name ?? 'Farm'}`,
        milestoneLabel: purposeLabel,
        fix,
        condition,
        checklistPassed: isCheck || checks.every(Boolean),
        notes: notes.trim() || null,
        portrait: photo(portrait, 'portrait.jpg'),
        photos: photos.map((p) => photo(p, 'photo.jpg')),
        createdAt: new Date().toISOString(),
        state: 'queued',
        attempts: 0,
        uploaded: [],
      });
      setResult(saved);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (result && !result.result) {
    const refused = result.state === 'failed';
    return (
      <Outcome
        tone={refused ? 'bad' : 'waiting'}
        title={refused ? `The ${noun} was not accepted` : 'Saved on this phone'}
      >
        {refused
          ? result.error
          : isCheck
            ? 'No connection right now. The check, its GPS fix and photos are stored on this phone and are sent automatically when you have signal, dated when you were here.'
            : 'No connection right now. The visit, its GPS fix and photos are stored on this phone and are sent automatically when you have signal. The database then decides whether it passes, using the time you were here.'}
      </Outcome>
    );
  }

  if (result?.result) {
    const r = result.result;
    if (isCheckResult(r)) {
      return (
        <Outcome
          tone={r.gps_ok ? 'good' : 'bad'}
          title={r.gps_ok ? 'Check recorded' : "Check recorded, but it doesn't count"}
        >
          {r.gps_ok
            ? r.next_due_on
              ? `The next check of this farm is due ${formatDate(r.next_due_on)}.`
              : 'Recorded with its photos and GPS position.'
            : `Your check-in was ${Math.round(r.distance_from_boundary_m)} m from the mapped boundary, or the GPS wasn't precise enough. It's kept, but the farm is still due a check made at the farm.`}
        </Outcome>
      );
    }
    return (
      <Outcome
        tone={r.passed ? 'good' : 'bad'}
        title={r.passed ? 'Visit passed' : 'Visit did not pass'}
      >
        {r.passed
          ? r.milestone_status === 'verified'
            ? 'Every farm has now passed. The cycle manager can release this milestone.'
            : 'Recorded. The milestone is released once every farm passes.'
          : !r.gps_ok
            ? `Your check-in was ${Math.round(r.distance_from_boundary_m)} m from the mapped boundary, or the GPS wasn't precise enough. The release is on hold until a passing visit.`
            : r.has_portrait === false
              ? 'There was no portrait of the farmer. The release is on hold until a passing visit.'
              : 'The release for this milestone is on hold until a passing visit.'}
      </Outcome>
    );
  }

  const precise = !!fix && fix.accuracy <= MAX_ACCURACY_M;
  const canSubmit = !!fix && !!condition && !!portrait && photos.length > 0;
  let step = 0;
  const n = () => ++step;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/field" className="link-back">
            ← Field visits
          </Link>
        }
        title={farm.farmer}
        description={
          purpose.kind === 'check'
            ? `${farm.name ?? 'Farm'} · ${formatHectares(farm.area_hectares)} · ${purpose.code} · routine check every ${purpose.intervalDays} days${purpose.nextDueOn ? ` · ${dueLabel(purpose.nextDueOn)}` : ''}`
            : `${farm.name ?? 'Farm'} · ${formatHectares(farm.area_hectares)} · ${purposeLabel}`
        }
      />

      {isCheck && (
        <div className="mb-6">
          <Alert tone="info" title="Routine farm check">
            A regular look at how the farm is doing. It isn&apos;t tied to a milestone and
            doesn&apos;t hold back or release any money.
          </Alert>
        </div>
      )}

      {!online && (
        <div className="mb-6">
          <Alert tone="warning" title="No connection">
            You can still record this {noun}. It&apos;s saved on this phone and sent when
            you&apos;re back in coverage. GPS works without signal; the map imagery doesn&apos;t.
          </Alert>
        </div>
      )}

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <FarmMap
            farms={[farm]}
            highlightId={farm.id}
            position={fix}
            className="h-80 w-full rounded-2xl ring-1 ring-zinc-950/5 sm:h-96"
          />
          <Card>
            <SectionTitle
              title={`${n()}. Check in`}
              description="Stand inside the farm and wait for a precise fix."
            />
            {!watching ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={startGps}>
                  <Crosshair aria-hidden /> Start GPS
                </Button>
                {demo.enabled && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      simulateAtFarm({ lon: farm.centroid_lon, lat: farm.centroid_lat })
                    }
                  >
                    <FlaskConical aria-hidden /> Simulate GPS at this farm
                  </Button>
                )}
              </div>
            ) : fix ? (
              <div
                className={cx(
                  'rounded-xl px-4 py-3 text-sm',
                  precise ? 'bg-brand-50 text-brand-900' : 'bg-amber-50 text-amber-900',
                )}
              >
                <p className="font-medium">
                  {demo.enabled && simulated
                    ? 'Simulated fix (demo)'
                    : precise
                      ? 'Precise fix'
                      : 'Waiting for a better signal'}{' '}
                  · ±{Math.round(fix.accuracy)} m
                </p>
                <p className="mt-0.5 text-xs opacity-80">
                  {precise
                    ? 'The database checks this position against the mapped boundary when you submit.'
                    : `Needs to be within ${MAX_ACCURACY_M} m. Move into the open, away from trees and buildings.`}
                </p>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">Finding your position…</p>
            )}
            {gpsError && (
              <div className="mt-3">
                <Alert>{gpsError}</Alert>
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle
              title={`${n()}. Portrait of the farmer`}
              description="Required at every visit."
            />
            <PortraitPicker value={portrait} onChange={setPortrait} />
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <SectionTitle title={`${n()}. Crop condition`} />
            <div className="grid grid-cols-2 gap-2">
              {CONDITIONS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCondition(c.value)}
                  className={cx(
                    'rounded-xl px-3 py-2.5 text-left ring-1 transition',
                    condition === c.value
                      ? c.value === 'failed'
                        ? 'bg-red-50 ring-red-500'
                        : 'bg-brand-50 ring-brand-600'
                      : 'ring-zinc-950/10 hover:bg-zinc-50',
                  )}
                >
                  <span className="block text-sm font-medium text-zinc-900">{c.label}</span>
                  <span className="block text-xs text-zinc-500">{c.hint}</span>
                </button>
              ))}
            </div>
          </Card>

          {!isCheck && (
            <Card>
              <SectionTitle
                title={`${n()}. Checklist`}
                description="Every item must be true to pass."
              />
              <ul className="space-y-3">
                {CHECKLIST.map((item, i) => (
                  <li key={item}>
                    <label className="flex cursor-pointer gap-3 text-sm text-zinc-800">
                      <input
                        type="checkbox"
                        checked={checks[i]}
                        onChange={(e) =>
                          setChecks(checks.map((c, j) => (i === j ? e.target.checked : c)))
                        }
                        className="mt-0.5 size-4 rounded accent-brand-700"
                      />
                      {item}
                    </label>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <SectionTitle
              title={`${n()}. Condition of the farm`}
              description="At least one photo: the crop, and any issue you report."
            />
            <PhotoPicker value={photos} onChange={setPhotos} />
          </Card>

          <Card>
            <Field label="Notes" hint="Pests, disease, anything unusual">
              <Textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={5000}
              />
            </Field>
          </Card>

          {error && <Alert>{error}</Alert>}
          <Button type="submit" busy={busy} disabled={!canSubmit} className="w-full">
            {online ? `Submit ${noun}` : `Save ${noun} on this phone`}
          </Button>
          {!canSubmit && (
            <p className="text-center text-xs text-zinc-500">
              Needs a GPS fix, a crop condition, a portrait of the farmer and at least one photo of
              the farm.
            </p>
          )}
        </div>
      </form>
    </>
  );
}

/** The screen after submitting: passed, saved for later, or refused. */
function Outcome({
  tone,
  title,
  children,
}: {
  tone: 'good' | 'bad' | 'waiting';
  title: string;
  children: ReactNode;
}) {
  const Icon = tone === 'good' ? CheckCircle2 : tone === 'bad' ? XCircle : CloudOff;
  return (
    <div className="mx-auto max-w-lg py-8 text-center">
      <div
        className={cx(
          'mx-auto grid size-16 place-items-center rounded-full',
          tone === 'good'
            ? 'bg-brand-100 text-brand-700'
            : tone === 'bad'
              ? 'bg-red-100 text-red-600'
              : 'bg-amber-100 text-amber-700',
        )}
      >
        <Icon className="size-8" />
      </div>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-zinc-950">{title}</h1>
      <p className="mt-2 text-sm text-zinc-600">{children}</p>
      <div className="mt-8 flex justify-center gap-2">
        <Link to="/field">
          <Button>Back to field visits</Button>
        </Link>
      </div>
    </div>
  );
}
