import { CheckCircle2, CloudUpload, Hourglass, Trash2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Modal, SectionTitle, cx } from '../../components/ui';
import { useOffline } from '../../lib/offline/OfflineProvider';
import type { QueuedVisit } from '../../lib/offline/types';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });

/** Visits on this phone: waiting to send, refused by the database, or recently sent. */
export function OutboxList() {
  const { visits, online, syncing, pending, syncNow } = useOffline();
  if (visits.length === 0) return null;

  return (
    <Card className="mb-6">
      <SectionTitle
        title="Visits on this phone"
        description={
          pending > 0
            ? online
              ? `${pending} waiting to send.`
              : `${pending} waiting to send. They go automatically when you have a connection.`
            : 'Everything recorded on this phone has been sent.'
        }
        actions={
          pending > 0 && (
            <Button size="sm" onClick={() => void syncNow()} busy={syncing} disabled={!online}>
              <CloudUpload aria-hidden /> Send now
            </Button>
          )
        }
      />
      <ul className="divide-y divide-zinc-950/5">
        {[...visits].reverse().map((v) => (
          <OutboxRow key={v.id} v={v} />
        ))}
      </ul>
    </Card>
  );
}

function OutboxRow({ v }: { v: QueuedVisit }) {
  const passed = v.result?.passed;
  return (
    <li className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
      {v.state === 'queued' ? (
        <Hourglass className="size-4 shrink-0 text-amber-600" aria-hidden />
      ) : v.state === 'failed' || passed === false ? (
        <XCircle className="size-4 shrink-0 text-red-500" aria-hidden />
      ) : (
        <CheckCircle2 className="size-4 shrink-0 text-brand-600" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-900">{v.farmLabel}</p>
        <p className="text-xs text-zinc-500">
          {v.milestoneLabel} · visited {when(v.fix.at)}
          {v.syncedAt && ` · sent ${when(v.syncedAt)}`}
        </p>
        {v.state === 'failed' && <p className="mt-1 text-xs text-red-700">{v.error}</p>}
        {v.state === 'synced' && passed === false && (
          <p className="mt-1 text-xs text-red-700">
            {v.result?.gps_ok
              ? 'Did not pass. The release is on hold until a passing visit.'
              : `Check-in was ${Math.round(v.result?.distance_from_boundary_m ?? 0)} m from the boundary, or the GPS wasn't precise enough.`}
          </p>
        )}
      </div>
      <Badge
        tone={
          v.state === 'queued'
            ? 'amber'
            : v.state === 'failed' || passed === false
              ? 'red'
              : 'green'
        }
      >
        {v.state === 'queued'
          ? `Waiting${v.attempts ? ` · tried ${v.attempts}×` : ''}`
          : v.state === 'failed'
            ? 'Not accepted'
            : passed
              ? 'Sent · passed'
              : 'Sent · did not pass'}
      </Badge>
      {v.state === 'failed' && <DiscardButton v={v} />}
    </li>
  );
}

function DiscardButton({ v }: { v: QueuedVisit }) {
  const { discard } = useOffline();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label="Remove">
        <Trash2 aria-hidden />
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Remove this visit from the phone?"
        description="The database didn't accept it, so it isn't recorded anywhere else. Remove it once you've noted why, or recorded a new visit."
      >
        <p className={cx('mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800')}>{v.error}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Keep
          </Button>
          <Button variant="danger" onClick={() => void discard(v.id)}>
            Remove
          </Button>
        </div>
      </Modal>
    </>
  );
}
