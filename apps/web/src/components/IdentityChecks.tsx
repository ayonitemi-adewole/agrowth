import { Check, Minus, ShieldCheck, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../lib/errors';
import { formatDate } from '../lib/format';
import {
  CHECK_STATUS,
  FIELD_LABEL,
  NUMBER_LABEL,
  describeOutcomes,
  isSimulated,
  latestAnswered,
  runIdentityChecks,
  type FieldResults,
  type IdentityCheck,
  type IdentitySubject,
  type NumberType,
} from '../lib/identity';
import { useToast } from './Toast';
import { Alert, Badge, Button, Input, cx } from './ui';

/**
 * The identity checks of one farmer or investor: for each NIN or BVN on record, the
 * check that counts and how each field compared, with a way to check again. The number
 * isn't stored, so checking again means typing it from the person's ID.
 */
export function IdentityChecks({
  subject,
  subjectId,
  checks,
  onRecord,
  since,
  canRun,
  onChecked,
}: {
  subject: IdentitySubject;
  subjectId: string;
  checks: IdentityCheck[];
  /** The numbers held for this person, with the last four digits when known. */
  onRecord: { type: NumberType; last4?: string | null }[];
  /** Investors: when they last submitted. Earlier checks are shown as superseded. */
  since?: string | null;
  canRun: boolean;
  onChecked: () => void;
}) {
  const latest = latestAnswered(checks, since);

  if (onRecord.length === 0) {
    return <p className="text-sm text-zinc-500">No NIN or BVN on record.</p>;
  }
  return (
    <ul className="space-y-3">
      {onRecord.map(({ type, last4 }) => {
        const counted = latest[type];
        const pending = checks.find(
          (c) =>
            c.number_type === type &&
            c.status === 'pending' &&
            (!counted || c.requested_at > counted.requested_at),
        );
        const earlier = checks.filter((c) => c.number_type === type && c !== counted).length;
        return (
          <li key={type} className="rounded-xl p-3 ring-1 ring-zinc-950/10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-zinc-900">
                {NUMBER_LABEL[type]}
                {last4 && <span className="ml-1 font-mono text-zinc-500">•••••••{last4}</span>}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {counted && isSimulated(counted.provider) && <Badge tone="violet">Simulated</Badge>}
                {pending ? (
                  <Badge>Checking…</Badge>
                ) : counted ? (
                  <Badge tone={CHECK_STATUS[counted.status].tone} dot>
                    {CHECK_STATUS[counted.status].label}
                  </Badge>
                ) : (
                  <Badge tone="amber" dot>
                    Not checked
                  </Badge>
                )}
              </span>
            </div>
            {counted && (
              <>
                <p className="mt-1 text-xs text-zinc-500">
                  {counted.error_message ?? CHECK_STATUS[counted.status].help}{' '}
                  {formatDate(counted.requested_at)}
                  {!isSimulated(counted.provider) && ` · ${counted.provider}`}
                  {earlier > 0 && ` · ${earlier} earlier`}
                </p>
                {counted.fields && <Fields fields={counted.fields} />}
              </>
            )}
            {canRun && (
              <RunCheck subject={subject} subjectId={subjectId} type={type} onDone={onChecked} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Fields({ fields }: { fields: FieldResults }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {(Object.keys(FIELD_LABEL) as (keyof FieldResults)[]).map((k) => {
        const v = fields[k];
        const Icon = v === true ? Check : v === false ? X : Minus;
        return (
          <li
            key={k}
            className={cx(
              'inline-flex items-center gap-1',
              v === true ? 'text-brand-800' : v === false ? 'text-red-700' : 'text-zinc-400',
            )}
            title={v === null ? 'Not compared' : v ? 'Matches' : 'Differs'}
          >
            <Icon className="size-3.5" aria-hidden />
            {FIELD_LABEL[k]}
            <span className="sr-only">
              {v === null ? 'not compared' : v ? 'matches' : 'differs'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function RunCheck({
  subject,
  subjectId,
  type,
  onDone,
}: {
  subject: IdentitySubject;
  subjectId: string;
  type: NumberType;
  onDone: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const [outcome] = await runIdentityChecks(subject, subjectId, [
        { number_type: type, number },
      ]);
      if ('refused' in outcome) {
        setError(outcome.refused);
        return;
      }
      const { ok, message } = describeOutcomes([outcome]);
      (ok ? toast.success : toast.error)(message);
      setNumber('');
      setOpen(false);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="mt-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <ShieldCheck aria-hidden /> Check {NUMBER_LABEL[type]}
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label={`${NUMBER_LABEL[type]}, 11 digits`}
          placeholder={`${NUMBER_LABEL[type]} from their ID`}
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          required
          pattern="[0-9 \-]{11,15}"
          inputMode="numeric"
          autoComplete="off"
          className="min-w-0 flex-1 basis-40 font-mono"
        />
        <Button type="submit" size="md" busy={busy}>
          Check
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-zinc-500">
        The number isn’t kept, so type it from the person’s ID. It must be the one on record.
      </p>
      {error && <Alert>{error}</Alert>}
    </form>
  );
}
