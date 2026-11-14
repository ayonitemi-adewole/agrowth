import { Camera, ImageOff, ImagePlus, UserRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { signedUrls } from '../lib/cycles';
import { useAsync } from '../lib/useAsync';
import { Skeleton, cx } from './ui';

/** Object URLs for image previews, revoked when they're no longer shown. */
export function usePreviews(files: File[]) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const next = files.map((f) => URL.createObjectURL(f));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrls(next);
    return () => next.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  return urls;
}

const tile =
  'grid cursor-pointer place-items-center rounded-xl border border-dashed border-zinc-300 text-zinc-500 hover:border-brand-400 hover:text-brand-700';

/** One portrait of the farmer, taken with the phone's camera. */
export function PortraitPicker({
  value,
  onChange,
}: {
  value: File | null;
  onChange: (file: File | null) => void;
}) {
  const files = value ? [value] : [];
  const [preview] = usePreviews(files);
  return (
    <div className="flex items-center gap-4">
      {value && preview ? (
        <div className="relative aspect-[3/4] w-28 shrink-0 overflow-hidden rounded-xl bg-zinc-100">
          <img src={preview} alt="Portrait of the farmer" className="size-full object-cover" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute top-1 right-1 rounded-full bg-zinc-950/60 p-1 text-white"
            aria-label="Retake portrait"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <label className={cx(tile, 'aspect-[3/4] w-28 shrink-0')}>
          <span className="flex flex-col items-center gap-1 text-xs">
            <UserRound className="size-6" aria-hidden />
            Take portrait
          </span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          />
        </label>
      )}
      <p className="text-xs text-zinc-500">
        Head and shoulders, face clearly visible, in daylight. It shows the farmer was there.
      </p>
    </div>
  );
}

/** Photos of the farm: at least one, up to `max`. */
export function PhotoPicker({
  value,
  onChange,
  max = 6,
}: {
  value: File[];
  onChange: (files: File[]) => void;
  max?: number;
}) {
  const previews = usePreviews(value);
  return (
    <div className="grid grid-cols-3 gap-2">
      {previews.map((src, i) => (
        <div key={src} className="relative aspect-square overflow-hidden rounded-xl bg-zinc-100">
          <img src={src} alt={`Farm photo ${i + 1}`} className="size-full object-cover" />
          <button
            type="button"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            className="absolute top-1 right-1 rounded-full bg-zinc-950/60 p-1 text-white"
            aria-label={`Remove photo ${i + 1}`}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      {value.length < max && (
        <label className={cx(tile, 'aspect-square')}>
          <span className="flex flex-col items-center gap-1 text-xs">
            {value.length ? <ImagePlus className="size-5" /> : <Camera className="size-5" />}
            {value.length ? 'Add' : 'Take photo'}
          </span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="sr-only"
            onChange={(e) =>
              onChange([...value, ...Array.from(e.target.files ?? [])].slice(0, max))
            }
          />
        </label>
      )}
    </div>
  );
}

/** Photos kept in a private bucket, shown through short-lived signed links. */
export function StoredPhotos({
  bucket,
  paths,
  alt,
  className,
  imgClassName = 'aspect-square',
}: {
  bucket: string;
  paths: string[];
  alt: string;
  className?: string;
  imgClassName?: string;
}) {
  const urls = useAsync(() => signedUrls(bucket, paths), [bucket, paths.join('|')]);
  if (paths.length === 0) {
    return (
      <div
        className={cx(
          'grid place-items-center rounded-xl bg-zinc-100 text-xs text-zinc-500',
          imgClassName,
          className,
        )}
      >
        <span className="flex items-center gap-1.5">
          <ImageOff className="size-4" aria-hidden /> No photo
        </span>
      </div>
    );
  }
  if (urls.loading && !urls.data) {
    return (
      <div className={className}>
        {paths.map((p) => (
          <Skeleton key={p} className={cx('rounded-xl', imgClassName)} />
        ))}
      </div>
    );
  }
  return (
    <div className={className}>
      {(urls.data ?? []).map((url, i) =>
        url ? (
          <a
            key={paths[i]}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block overflow-hidden rounded-xl bg-zinc-100 ring-1 ring-zinc-950/5"
          >
            <img
              src={url}
              alt={paths.length > 1 ? `${alt} ${i + 1}` : alt}
              className={cx('w-full object-cover', imgClassName)}
            />
          </a>
        ) : (
          <div
            key={paths[i]}
            className={cx('grid place-items-center rounded-xl bg-zinc-100', imgClassName)}
          >
            <ImageOff className="size-4 text-zinc-400" aria-label="Photo unavailable" />
          </div>
        ),
      )}
    </div>
  );
}
