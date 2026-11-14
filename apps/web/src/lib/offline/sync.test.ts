import { describe, expect, it } from 'vitest';
import type { Outbox } from './store';
import { daysUntil, dueLabel, lagosToday } from './due';
import { isNetworkError, KEEP_SYNCED_MS, photoPath, syncOutbox, type Remote } from './sync';
import type { CheckResult, QueuedVisit, VisitResult } from './types';

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
  const records: { id: string; paths: string[]; portrait?: string | null; kind?: string }[] = [];
  let n = 0;
  const r: Remote = {
    upload: async (path) => {
      if (fail?.onUpload !== undefined && n++ === fail.onUpload) {
        throw new TypeError('Failed to fetch');
      }
      uploads.push(path);
    },
    recordVisit: async (v, paths, portrait) => {
      if (fail?.onRecord) throw fail.onRecord;
      records.push({
        id: v.id,
        paths,
        ...(portrait ? { portrait } : {}),
        ...(v.kind ? { kind: v.kind } : {}),
      });
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

describe('portraits and routine checks', () => {
  const portrait = { name: 'face.jpg', type: 'image/jpeg', blob: new Blob(['p']) };

  it('uploads the portrait first, records it with the visit, and drops the file once sent', async () => {
    const box = memoryBox([queued('a', { kind: 'milestone', portrait })]);
    const { r, uploads, records } = remote();
    await syncOutbox(box, r, 'agent');
    expect(uploads).toEqual([
      'ms/farm/a-portrait-face.jpg',
      'ms/farm/a-0-IMG-1.jpg',
      'ms/farm/a-1-IMG-2.jpg',
    ]);
    expect(records).toEqual([
      {
        id: 'a',
        kind: 'milestone',
        paths: ['ms/farm/a-0-IMG-1.jpg', 'ms/farm/a-1-IMG-2.jpg'],
        portrait: 'ms/farm/a-portrait-face.jpg',
      },
    ]);
    expect(box.all.get('a')).toMatchObject({ state: 'synced', photos: [], portrait: null });
  });

  it("files a routine check's photos under its cycle, apart from milestone photos", async () => {
    const check = queued('c', {
      kind: 'check',
      milestoneId: undefined,
      cycleId: 'cyc',
      checklistPassed: true,
      portrait,
    });
    const box = memoryBox([check]);
    const checkResult: CheckResult = {
      check_id: 'k1',
      gps_ok: true,
      distance_from_boundary_m: 0,
      next_due_on: '2027-05-15',
    };
    const uploads: string[] = [];
    const kinds: (string | undefined)[] = [];
    await syncOutbox(
      box,
      {
        upload: async (path) => void uploads.push(path),
        recordVisit: async (v) => {
          kinds.push(v.kind);
          return checkResult;
        },
      },
      'agent',
    );
    expect(uploads).toEqual([
      'checks/cyc/farm/c-portrait-face.jpg',
      'checks/cyc/farm/c-0-IMG-1.jpg',
      'checks/cyc/farm/c-1-IMG-2.jpg',
    ]);
    expect(kinds).toEqual(['check']);
    expect(box.all.get('c')).toMatchObject({ state: 'synced', result: checkResult });
  });

  it('a retry after a dropped connection skips the portrait already uploaded', async () => {
    const box = memoryBox([queued('a', { portrait })]);
    await syncOutbox(box, remote({ onUpload: 1 }).r, 'agent');
    expect(box.all.get('a')!.uploaded).toEqual(['ms/farm/a-portrait-face.jpg']);
    const second = remote();
    await syncOutbox(box, second.r, 'agent');
    expect(second.uploads).toEqual(['ms/farm/a-0-IMG-1.jpg', 'ms/farm/a-1-IMG-2.jpg']);
    expect(second.records[0].portrait).toBe('ms/farm/a-portrait-face.jpg');
  });
});

describe('when a check is due', () => {
  // 23:30 UTC on 1 May is already 2 May in Nigeria.
  const lateEvening = new Date('2027-05-01T23:30:00Z');

  it('counts days in Nigerian dates', () => {
    expect(lagosToday(lateEvening)).toBe('2027-05-02');
    expect(daysUntil('2027-05-02', lateEvening)).toBe(0);
    expect(daysUntil('2027-05-09', lateEvening)).toBe(7);
    expect(daysUntil('2027-04-29', lateEvening)).toBe(-3);
  });

  it('describes it plainly', () => {
    expect(dueLabel('2027-05-02', lateEvening)).toBe('Due today');
    expect(dueLabel('2027-05-03', lateEvening)).toBe('Due in 1 day');
    expect(dueLabel('2027-05-06', lateEvening)).toBe('Due in 4 days');
    expect(dueLabel('2027-05-01', lateEvening)).toBe('Overdue by 1 day');
    expect(dueLabel('2027-04-25', lateEvening)).toBe('Overdue by 7 days');
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
