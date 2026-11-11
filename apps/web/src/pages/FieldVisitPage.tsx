import {
  Camera,
  CheckCircle2,
  CloudOff,
  Crosshair,
  FlaskConical,
  ImagePlus,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { FarmMap } from '../components/FarmMap';
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
import { formatHectares } from '../lib/format';
import { useOffline } from '../lib/offline/OfflineProvider';
import { snapshots } from '../lib/offline/store';
import { isNetworkError } from '../lib/offline/sync';
import type { QueuedVisit } from '../lib/offline/types';
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

type VisitFarm = Pick<
  Farm,
  'id' | 'name' | 'area_hectares' | 'primary_crop' | 'boundary' | 'centroid_lon' | 'centroid_lat'
> & { farmer: string };

interface VisitMilestone {
  id: string;
  sequence: number;
  name: string;
  code: string;
}

/** The farm and milestone from the server, or from the work list saved on the phone. */
async function loadVisit(
  userId: string,
  farmId: string,
  milestoneId: string,
): Promise<{ fromPhone: boolean; farm: VisitFarm | null; milestone: VisitMilestone | null }> {
  try {
    const [farm, milestone] = await Promise.all([
      supabase.from('farm_maps').select('*, farmers(full_name)').eq('id', farmId).maybeSingle(),
      supabase
        .from('milestones')
        .select('id, sequence, name, cycles(code)')
        .eq('id', milestoneId)
        .maybeSingle(),
    ]);
    if (farm.error) throw farm.error;
    if (milestone.error) throw milestone.error;
    const f = farm.data as (Farm & { farmers: { full_name: string } }) | null;
    const m = milestone.data as unknown as {
      id: string;
      sequence: number;
      name: string;
      cycles: { code: string };
    } | null;
    return {
      fromPhone: false,
      farm: f ? { ...f, farmer: f.farmers.full_name } : null,
      milestone: m ? { id: m.id, sequence: m.sequence, name: m.name, code: m.cycles.code } : null,
    };
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const saved = await snapshots.get(userId);
    const a = saved?.assignments.find((x) => x.milestone.id === milestoneId);
    return {
      fromPhone: true,
      farm: a?.farms.find((x) => x.id === farmId) ?? null,
      milestone: a
        ? {
            id: a.milestone.id,
            sequence: a.milestone.sequence,
            name: a.milestone.name,
            code: a.milestone.cycle.code,
          }
        : null,
    };
  }
}

export function FieldVisitPage() {
  const [params] = useSearchParams();
  const milestoneId = params.get('milestone')!;
  const farmId = params.get('farm')!;
  const { profile } = useAuth();
  const { queue, online } = useOffline();

  const info = useAsync(
    () => loadVisit(profile!.id, farmId, milestoneId),
    [profile?.id, farmId, milestoneId],
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
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueuedVisit | null>(null);

  const previews = usePreviews(photos);

  if (info.loading && (!info.data || info.stale)) return <PageSkeleton variant="detail" />;
  if (info.error) return <Alert>{errorMessage(info.error)}</Alert>;
  const { farm, milestone, fromPhone } = info.data!;
  if (!farm || !milestone)
    return (
      <Alert>
        {fromPhone
          ? "This farm isn't in the work list saved on this phone. Open Field visits with a connection to update it."
          : "Farm or milestone not found, or you don't have access."}
      </Alert>
    );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!fix || !condition) return;
    setBusy(true);
    setError(null);
    try {
      // Every visit is saved on the phone first, then sent: nothing is lost if the signal
      // drops part-way, and a resend can't record it twice.
      const saved = await queue({
        id: crypto.randomUUID(),
        userId: profile!.id,
        farmId,
        milestoneId,
        farmLabel: `${farm.farmer} · ${farm.name ?? 'Farm'}`,
        milestoneLabel: `${milestone.code}, milestone ${milestone.sequence}: ${milestone.name}`,
        fix,
        condition,
        checklistPassed: checks.every(Boolean),
        notes: notes.trim() || null,
        photos: photos.map((p) => ({ name: p.name || 'photo.jpg', type: p.type, blob: p })),
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
      <div className="mx-auto max-w-lg py-8 text-center">
        <div
          className={cx(
            'mx-auto grid size-16 place-items-center rounded-full',
            refused ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700',
          )}
        >
          {refused ? <XCircle className="size-8" /> : <CloudOff className="size-8" />}
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-zinc-950">
          {refused ? 'The visit was not accepted' : 'Saved on this phone'}
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          {refused
            ? result.error
            : 'No connection right now. The visit, its GPS fix and photos are stored on this phone and are sent automatically when you have signal. The database then decides whether it passes, using the time you were here.'}
        </p>
        <div className="mt-8 flex justify-center gap-2">
          <Link to="/field">
            <Button>Back to field visits</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (result?.result) {
    const r = result.result;
    return (
      <div className="mx-auto max-w-lg py-8 text-center">
        <div
          className={cx(
            'mx-auto grid size-16 place-items-center rounded-full',
            r.passed ? 'bg-brand-100 text-brand-700' : 'bg-red-100 text-red-600',
          )}
        >
          {r.passed ? <CheckCircle2 className="size-8" /> : <XCircle className="size-8" />}
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-zinc-950">
          {r.passed ? 'Visit passed' : 'Visit did not pass'}
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          {r.passed
            ? r.milestone_status === 'verified'
              ? 'Every farm has now passed. The cycle manager can release this milestone.'
              : 'Recorded. The milestone is released once every farm passes.'
            : !r.gps_ok
              ? `Your check-in was ${Math.round(r.distance_from_boundary_m)} m from the mapped boundary, or the GPS wasn't precise enough. The release is on hold until a passing visit.`
              : 'The release for this milestone is on hold until a passing visit.'}
        </p>
        <div className="mt-8 flex justify-center gap-2">
          <Link to="/field">
            <Button>Back to field visits</Button>
          </Link>
        </div>
      </div>
    );
  }

  const precise = !!fix && fix.accuracy <= MAX_ACCURACY_M;
  const canSubmit = !!fix && !!condition && photos.length > 0;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/field" className="link-back">
            ← Field visits
          </Link>
        }
        title={farm.farmer}
        description={`${farm.name ?? 'Farm'} · ${formatHectares(farm.area_hectares)} · ${milestone.code}, milestone ${milestone.sequence}: ${milestone.name}`}
      />

      {!online && (
        <div className="mb-6">
          <Alert tone="warning" title="No connection">
            You can still record this visit. It&apos;s saved on this phone and sent when you&apos;re
            back in coverage. GPS works without signal; the map imagery doesn&apos;t.
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
              title="1. Check in"
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
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <SectionTitle title="2. Crop condition" />
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

          <Card>
            <SectionTitle title="3. Checklist" description="Every item must be true to pass." />
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

          <Card>
            <SectionTitle
              title="4. Photos"
              description="At least one: the crop, and any issue you report."
            />
            <div className="grid grid-cols-3 gap-2">
              {previews.map((src, i) => (
                <div
                  key={src}
                  className="relative aspect-square overflow-hidden rounded-xl bg-zinc-100"
                >
                  <img src={src} alt={`Photo ${i + 1}`} className="size-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                    className="absolute top-1 right-1 rounded-full bg-zinc-950/60 p-1 text-white"
                    aria-label={`Remove photo ${i + 1}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              <label className="grid aspect-square cursor-pointer place-items-center rounded-xl border border-dashed border-zinc-300 text-zinc-500 hover:border-brand-400 hover:text-brand-700">
                <span className="flex flex-col items-center gap-1 text-xs">
                  {photos.length ? <ImagePlus className="size-5" /> : <Camera className="size-5" />}
                  {photos.length ? 'Add' : 'Take photo'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="sr-only"
                  onChange={(e) =>
                    setPhotos([...photos, ...Array.from(e.target.files ?? [])].slice(0, 6))
                  }
                />
              </label>
            </div>
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
            {online ? 'Submit visit' : 'Save visit on this phone'}
          </Button>
          {!canSubmit && (
            <p className="text-center text-xs text-zinc-500">
              Needs a GPS fix, a crop condition and at least one photo.
            </p>
          )}
        </div>
      </form>
    </>
  );
}

/** Object URLs for image previews, revoked when they're no longer shown. */
function usePreviews(files: File[]) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const next = files.map((f) => URL.createObjectURL(f));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrls(next);
    return () => next.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  return urls;
}
