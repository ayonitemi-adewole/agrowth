import type { Outbox } from './store';
import {
  visitKind,
  type CheckResult,
  type QueuedPhoto,
  type QueuedVisit,
  type VisitResult,
} from './types';

/** What syncing needs from the server. */
export interface Remote {
  /** Uploads a photo. Uploading the same path twice must succeed (it's already there). */
  upload(path: string, photo: { blob: Blob; type: string }): Promise<void>;
  /** Records a milestone visit or a routine check, by the visit's kind. */
  recordVisit(
    visit: QueuedVisit,
    photoPaths: string[],
    portraitPath: string | null,
  ): Promise<VisitResult | CheckResult>;
}

export interface SyncReport {
  synced: QueuedVisit[];
  failed: QueuedVisit[];
  /** True if the connection dropped part-way; what's left is still queued. */
  interrupted: boolean;
}

/** Synced visits are kept this long so the agent can see their results, then forgotten. */
export const KEEP_SYNCED_MS = 7 * 86_400_000;

/**
 * The folder for a visit's photos in "field-photos": <milestone id>/<farm id> for a
 * milestone visit, checks/<cycle id>/<farm id> for a routine check.
 */
const folder = (v: QueuedVisit) =>
  visitKind(v) === 'check' ? `checks/${v.cycleId}/${v.farmId}` : `${v.milestoneId}/${v.farmId}`;

const safeName = (p: QueuedPhoto) => p.name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(-60);

/** Where a queued visit's photo goes. Fixed per visit, so a retry overwrites nothing new. */
export const photoPath = (v: QueuedVisit, i: number) =>
  `${folder(v)}/${v.id}-${i}-${safeName(v.photos[i])}`;

/** Where a queued visit's portrait of the farmer goes. */
export const portraitPath = (v: QueuedVisit & { portrait: QueuedPhoto }) =>
  `${folder(v)}/${v.id}-portrait-${safeName(v.portrait)}`;

/**
 * A connection problem (try again later) rather than the database refusing the visit
 * (which won't change by retrying, and needs the agent's attention).
 */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const e = err as {
    name?: string;
    message?: string;
    code?: string;
    status?: number;
    originalError?: unknown;
  } | null;
  if (!e) return false;
  if (e.originalError && isNetworkError(e.originalError)) return true;
  // A sign-in that expired while offline: it refreshes once back online.
  if (e.code === 'PGRST301' || e.code === 'PGRST303') return true;
  if (e.name === 'TypeError' || e.name === 'AbortError') return true;
  if (/failed to fetch|network|load failed|timed? ?out/i.test(e.message ?? '')) return true;
  // Server hiccups are worth retrying too; refusals carry a PT4xx or a PostgreSQL code.
  return typeof e.status === 'number' && (e.status === 0 || e.status >= 500);
}

const messageOf = (err: unknown) =>
  (err as { message?: string } | null)?.message || 'The server refused this visit';

/**
 * Sends every queued visit for this user, oldest first: the portrait and photos, then the
 * visit itself.
 * Stops at the first connection problem, leaving the rest queued. A visit the database
 * refuses is marked failed with its reason. Old synced visits are tidied away.
 */
export async function syncOutbox(
  box: Outbox,
  remote: Remote,
  userId: string,
  now: () => Date = () => new Date(),
): Promise<SyncReport> {
  const report: SyncReport = { synced: [], failed: [], interrupted: false };
  const all = await box.list(userId);

  for (const old of all) {
    if (old.state === 'synced' && old.syncedAt) {
      if (now().getTime() - new Date(old.syncedAt).getTime() > KEEP_SYNCED_MS) {
        await box.remove(old.id);
      }
    }
  }

  for (const queued of all.filter((v) => v.state === 'queued')) {
    const v: QueuedVisit = {
      ...queued,
      attempts: queued.attempts + 1,
      uploaded: [...queued.uploaded],
    };
    try {
      const paths = v.photos.map((_, i) => photoPath(v, i));
      const portrait = v.portrait ? portraitPath({ ...v, portrait: v.portrait }) : null;
      const files: [string, QueuedPhoto][] = [
        ...(portrait && v.portrait ? [[portrait, v.portrait] as [string, QueuedPhoto]] : []),
        ...paths.map((p, i) => [p, v.photos[i]] as [string, QueuedPhoto]),
      ];
      for (const [path, photo] of files) {
        if (v.uploaded.includes(path)) continue;
        await remote.upload(path, photo);
        v.uploaded.push(path);
        await box.put(v);
      }
      const result = await remote.recordVisit(v, paths, portrait);
      // The photos have done their job; keep the record of what happened, not the files.
      const done: QueuedVisit = {
        ...v,
        photos: [],
        portrait: null,
        state: 'synced',
        result,
        syncedAt: now().toISOString(),
        error: undefined,
      };
      await box.put(done);
      report.synced.push(done);
    } catch (err) {
      if (isNetworkError(err)) {
        await box.put(v);
        report.interrupted = true;
        break;
      }
      const failed: QueuedVisit = { ...v, state: 'failed', error: messageOf(err) };
      await box.put(failed);
      report.failed.push(failed);
    }
  }
  return report;
}
