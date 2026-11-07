import {
  BadgeCheck,
  Ban,
  ClipboardCheck,
  Coins,
  History,
  Landmark,
  Lock,
  RotateCcw,
  Send,
  ShieldCheck,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { EmptyState } from '../../components/ui';
import type { TabProps } from './useCycleData';

const ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  submitted: { icon: Send, tone: 'bg-sky-100 text-sky-700' },
  rejected: { icon: Undo2, tone: 'bg-amber-100 text-amber-700' },
  approved: { icon: ShieldCheck, tone: 'bg-brand-100 text-brand-700' },
  cancelled: { icon: Ban, tone: 'bg-red-100 text-red-700' },
  funding_received: { icon: Coins, tone: 'bg-violet-100 text-violet-700' },
  funded: { icon: Coins, tone: 'bg-violet-100 text-violet-700' },
  refunded: { icon: RotateCcw, tone: 'bg-red-100 text-red-700' },
  verification_requested: { icon: ClipboardCheck, tone: 'bg-sky-100 text-sky-700' },
  milestone_verified: { icon: BadgeCheck, tone: 'bg-brand-100 text-brand-700' },
  milestone_blocked: { icon: Lock, tone: 'bg-red-100 text-red-700' },
  milestone_awaiting_verification: { icon: ClipboardCheck, tone: 'bg-amber-100 text-amber-700' },
  release_instructed: { icon: Landmark, tone: 'bg-sky-100 text-sky-700' },
  milestone_released: { icon: Landmark, tone: 'bg-brand-100 text-brand-700' },
};

/** The cycle's append-only history, newest first. */
export function HistoryTab({ data }: TabProps) {
  if (data.events.length === 0) {
    return (
      <EmptyState icon={<History />} title="Nothing yet">
        Every submission, decision, deposit, verification and payment is recorded here permanently.
      </EmptyState>
    );
  }
  return (
    <div className="max-w-2xl rounded-2xl bg-white p-6 shadow-card ring-1 ring-zinc-950/5">
      <ol className="relative">
        {data.events.map((e, i) => {
          const { icon: Icon, tone } = ICONS[e.kind] ?? {
            icon: History,
            tone: 'bg-zinc-100 text-zinc-600',
          };
          const last = i === data.events.length - 1;
          return (
            <li key={e.id} className="relative flex gap-4 pb-6 last:pb-0">
              {!last && (
                <span className="absolute top-9 bottom-0 left-4 w-px bg-zinc-200" aria-hidden />
              )}
              <span
                className={`relative grid size-8 shrink-0 place-items-center rounded-full ${tone}`}
              >
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 pt-1">
                <p className="text-sm text-zinc-900">{e.message}</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {new Date(e.created_at).toLocaleString('en-NG', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                  {e.actor_id && ` · ${data.people.get(e.actor_id) ?? 'Staff'}`}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
