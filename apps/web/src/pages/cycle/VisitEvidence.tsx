import { BadgeCheck, ImageOff, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FarmMap } from '../../components/FarmMap';
import { Badge, DescriptionList, Modal, Skeleton } from '../../components/ui';
import { signedUrls } from '../../lib/cycles';
import { formatHectares, titleCase } from '../../lib/format';
import type { FieldVisit, Milestone } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';
import type { CycleFarm } from './useCycleData';

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Everything a field visit recorded, so anyone reviewing a release can see why it passed or
 * failed: the photo, the GPS check-in against the mapped boundary, and the agent's notes.
 */
export function VisitEvidence({
  visit,
  farm,
  milestone,
  history,
  onClose,
}: {
  visit: FieldVisit | null;
  farm: CycleFarm | undefined;
  milestone: Milestone | undefined;
  /** Every visit to this farm for this milestone, newest first. */
  history: FieldVisit[];
  onClose: () => void;
}) {
  const open = !!visit && !!farm;
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={farm ? `${farm.farmer_name} · ${farm.name ?? 'Farm'}` : 'Field visit'}
      description={milestone && `Milestone ${milestone.sequence}: ${milestone.name}`}
    >
      {open && <Evidence key={visit.id} visit={visit} farm={farm} history={history} />}
    </Modal>
  );
}

function Evidence({
  visit: v,
  farm,
  history,
}: {
  visit: FieldVisit;
  farm: CycleFarm;
  history: FieldVisit[];
}) {
  const photos = useAsync(() => signedUrls('field-photos', v.photo_paths), [v.id]);
  // The dialog opens after this renders. A map created while it's still hidden has no size and
  // draws nothing, so the map waits one frame, until the dialog is on screen.
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOnScreen(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const inside = Number(v.distance_from_boundary_m) === 0;
  const earlier = history.filter((h) => h.id !== v.id);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {v.passed ? (
          <Badge tone="green">
            <BadgeCheck className="size-3.5" aria-hidden /> Passed
          </Badge>
        ) : (
          <Badge tone="red">
            <XCircle className="size-3.5" aria-hidden /> Failed
          </Badge>
        )}
        <span className="text-sm text-zinc-500">Visited {dateTime(v.visited_at)}</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="overflow-hidden rounded-xl bg-zinc-100 ring-1 ring-zinc-950/5">
          {photos.loading && !photos.data ? (
            <Skeleton className="aspect-[4/3] rounded-none" />
          ) : photos.data?.[0] ? (
            <a href={photos.data[0]} target="_blank" rel="noopener noreferrer">
              <img
                src={photos.data[0]}
                alt={`Photo taken at ${farm.name ?? 'the farm'}`}
                className="aspect-[4/3] w-full object-cover"
              />
            </a>
          ) : (
            <div className="grid aspect-[4/3] place-items-center text-sm text-zinc-500">
              <span className="flex items-center gap-2">
                <ImageOff className="size-4" aria-hidden /> No photo
              </span>
            </div>
          )}
        </div>
        {onScreen ? (
          <FarmMap
            farms={[farm]}
            highlightId={farm.id}
            position={{ lon: v.lon, lat: v.lat, accuracy: Number(v.gps_accuracy_m) }}
            positionLabel="Check-in"
            fitPosition
            className="aspect-[4/3] w-full rounded-xl ring-1 ring-zinc-950/5"
          />
        ) : (
          <Skeleton className="aspect-[4/3] rounded-xl" />
        )}
      </div>
      {photos.data && photos.data.length > 1 && (
        <p className="text-xs text-zinc-500">
          {photos.data.length - 1} more photo{photos.data.length > 2 ? 's' : ''}:{' '}
          {photos.data.slice(1).map((url, i) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="mr-2 font-medium text-brand-700 hover:underline"
            >
              Photo {i + 2}
            </a>
          ))}
        </p>
      )}

      <DescriptionList
        items={[
          [
            'GPS check-in',
            <span className={v.gps_ok ? undefined : 'text-red-700'}>
              {inside
                ? 'Inside the boundary'
                : `${Math.round(Number(v.distance_from_boundary_m))} m outside the boundary`}{' '}
              · ±{Math.round(Number(v.gps_accuracy_m))} m
            </span>,
          ],
          ['Position', `${v.lat.toFixed(5)}, ${v.lon.toFixed(5)}`],
          [
            'Farm',
            `${formatHectares(farm.area_hectares)} · ${titleCase(farm.primary_crop ?? '—')}`,
          ],
          ['Crop condition', titleCase(v.crop_condition)],
          ['Checklist', v.checklist_passed ? 'All items passed' : 'Not passed'],
        ]}
      />
      {v.notes && (
        <div className="rounded-xl bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
          <p className="mb-1 text-xs font-medium text-zinc-500">Agent's notes</p>
          {v.notes}
        </div>
      )}
      {earlier.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-zinc-500">
            Earlier visits for this milestone
          </p>
          <ul className="space-y-1 text-sm">
            {earlier.map((h) => (
              <li key={h.id} className="flex items-center gap-2 text-zinc-600">
                {h.passed ? (
                  <BadgeCheck className="size-4 text-brand-600" aria-label="Passed" />
                ) : (
                  <XCircle className="size-4 text-red-500" aria-label="Failed" />
                )}
                {dateTime(h.visited_at)}
                {!h.gps_ok && ` · ${Math.round(Number(h.distance_from_boundary_m))} m outside`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
