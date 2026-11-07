import { describe, expect, it } from 'vitest';
import type { Outbox } from './store';
import { isNetworkError, KEEP_SYNCED_MS, photoPath, syncOutbox, type Remote } from './sync';
import type { QueuedVisit, VisitResult } from './types';

const memoryBox = (visits: QueuedVisit[]): Outbox & { all: Map<string, QueuedVisit> } => {
  const all = new Map(visits.map((v) => [v.id, structuredClone(v)]));
  return {
    all,
    list: async (userId) =>
      [...all.values()]
        .filter((v) => v.userId === userId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    put: async (v) => void all.set(v.id, structuredClone(v)),
    remove: async (id) => void all.delete(id),
  };
};

const queued = (id: string, over: Partial<QueuedVisit> = {}): QueuedVisit => ({
  id,
  userId: 'agent',
  farmId: 'farm',
  milestoneId: 'ms',
  farmLabel: 'Amina Ibrahim',
  milestoneLabel: 'KD-MAIZE #1',
  fix: { lon: 7.6, lat: 11.1, accuracy: 5, at: '2027-05-01T09:00:00Z' },
  condition: 'good',
  checklistPassed: true,
  notes: null,
  photos: [
    { name: 'IMG 1.jpg', type: 'image/jpeg', blob: new Blob(['a']) },
    { name: 'IMG 2.jpg', type: 'image/jpeg', blob: new Blob(['b']) },
  ],
  createdAt: `2027-05-01T09:00:0${id.length}Z`,
  state: 'queued',
  attempts: 0,
  uploaded: [],
  ...over,
});

const pass: VisitResult = {
  visit_id: 'v1',
  passed: true,
  gps_ok: true,
  distance_from_boundary_m: 0,
  milestone_status: 'verified',
};

/** A server that records calls and can be made to fail. */
function remote(fail?: { onUpload?: number; onRecord?: unknown }) {
  const uploads: string[] = [];
  const records: { id: string; paths: string[] }[] = [];
  let n = 0;
  const r: Remote = {
    upload: async (path) => {
      if (fail?.onUpload !== undefined && n++ === fail.onUpload) {
        throw new TypeError('Failed to fetch');
      }
      uploads.push(path);
    },
    recordVisit: async (v, paths) => {
      if (fail?.onRecord) throw fail.onRecord;
      records.push({ id: v.id, paths });
      return pass;
    },
  };
  return { r, uploads, records };
}

describe('syncOutbox', () => {
  it('uploads the photos, records the visit with them, and keeps the result without the photos', async () => {
    const box = memoryBox([queued('a')]);
    const { r, uploads, records } = remote();
    const report = await syncOutbox(box, r, 'agent');
    expect(report.synced).toHaveLength(1);
    expect(uploads).toEqual(['ms/farm/a-0-IMG-1.jpg', 'ms/farm/a-1-IMG-2.jpg']);
    expect(records).toEqual([{ id: 'a', paths: uploads }]);
    expect(box.all.get('a')).toMatchObject({ state: 'synced', result: pass, photos: [] });
  });

  it('stops at a dropped connection, keeping what was uploaded so a retry skips it', async () => {
    const box = memoryBox([queued('a'), queued('bb')]);
    const first = remote({ onUpload: 1 });
    const report = await syncOutbox(box, first.r, 'agent');
    expect(report).toMatchObject({ interrupted: true, synced: [], failed: [] });
    expect(box.all.get('a')).toMatchObject({
      state: 'queued',
      attempts: 1,
      uploaded: ['ms/farm/a-0-IMG-1.jpg'],
    });
    // The second visit wasn't tried.
    expect(box.all.get('bb')!.attempts).toBe(0);

    const second = remote();
    await syncOutbox(box, second.r, 'agent');
    expect(second.uploads).toEqual([
      'ms/farm/a-1-IMG-2.jpg',
      'ms/farm/bb-0-IMG-1.jpg',
      'ms/farm/bb-1-IMG-2.jpg',
    ]);
    expect(box.all.get('a')!.state).toBe('synced');
    expect(box.all.get('bb')!.state).toBe('synced');
  });

  it('marks a visit the database refuses as failed, with its reason, and carries on', async () => {
    const box = memoryBox([queued('a')]);
    const refused = { code: 'PT409', message: 'This milestone is not awaiting verification' };
    const report = await syncOutbox(box, remote({ onRecord: refused }).r, 'agent');
    expect(report.failed).toHaveLength(1);
    expect(box.all.get('a')).toMatchObject({
      state: 'failed',
      error: 'This milestone is not awaiting verification',
    });
  });

  it("only sends the signed-in agent's visits, and forgets results after a week", async () => {
    const now = new Date('2027-06-01T00:00:00Z');
    const box = memoryBox([
      queued('mine'),
      queued('theirs', { userId: 'someone-else' }),
      queued('old', {
        state: 'synced',
        syncedAt: new Date(now.getTime() - KEEP_SYNCED_MS - 1).toISOString(),
      }),
    ]);
    const { records } = await (async () => {
      const x = remote();
      await syncOutbox(box, x.r, 'agent', () => now);
      return x;
    })();
    expect(records.map((r) => r.id)).toEqual(['mine']);
    expect(box.all.has('old')).toBe(false);
    expect(box.all.get('theirs')!.state).toBe('queued');
  });
});

describe('isNetworkError and photoPath', () => {
  it('tells connection problems from refusals', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError({ message: 'Load failed' })).toBe(true);
    expect(isNetworkError({ status: 503, message: 'Service unavailable' })).toBe(true);
    expect(isNetworkError({ code: 'PT400', message: 'A valid GPS position is required' })).toBe(
      false,
    );
  });

  it('keeps photo names safe and tied to the visit', () => {
    expect(
      photoPath(
        queued('a', { photos: [{ name: 'my photo (1).JPG', type: '', blob: new Blob() }] }),
        0,
      ),
    ).toBe('ms/farm/a-0-my-photo-1-.JPG');
  });
});
