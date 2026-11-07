import { Inbox, Loader2, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

export const cx = (...classes: (string | false | null | undefined)[]) =>
  classes.filter(Boolean).join(' ');

// ---------- Buttons ----------

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'subtle';
type Size = 'sm' | 'md';

const variants: Record<Variant, string> = {
  primary:
    'bg-brand-700 text-white shadow-sm hover:bg-brand-800 focus-visible:outline-brand-700 disabled:bg-brand-700/50',
  secondary:
    'bg-white text-zinc-800 shadow-sm ring-1 ring-zinc-950/10 hover:bg-zinc-50 disabled:text-zinc-400',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 disabled:bg-red-600/50',
  ghost: 'text-zinc-600 hover:bg-zinc-950/5 hover:text-zinc-900 disabled:text-zinc-400',
  subtle: 'bg-brand-50 text-brand-800 hover:bg-brand-100 disabled:opacity-50',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 [&_svg]:size-3.5',
  md: 'h-10 px-4 text-sm gap-2 [&_svg]:size-4',
};

export function Button({
  variant = 'primary',
  size = 'md',
  busy = false,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; busy?: boolean }) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || busy}
      {...props}
    >
      {busy && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

// ---------- Form fields ----------

const inputClass =
  'block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm ring-1 ring-zinc-950/10 ring-inset placeholder:text-zinc-400 transition focus:ring-2 focus:ring-brand-600 focus:outline-none disabled:bg-zinc-50 disabled:text-zinc-500';

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('block space-y-1.5', className)}>
      <span className="text-sm font-medium text-zinc-800">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, 'h-10', props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputClass, 'h-10 pr-8', props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputClass, props.className)} />;
}

// ---------- Surfaces ----------

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cx(
        'rounded-2xl bg-white shadow-card ring-1 ring-zinc-950/5',
        padded && 'p-5 sm:p-6',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 text-sm text-zinc-500">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// ---------- Feedback ----------

export function Alert({
  tone = 'error',
  title,
  children,
}: {
  tone?: 'error' | 'success' | 'info' | 'warning';
  title?: string;
  children?: ReactNode;
}) {
  const tones = {
    error: 'bg-red-50 text-red-800 ring-red-600/15',
    success: 'bg-brand-50 text-brand-900 ring-brand-600/20',
    info: 'bg-sky-50 text-sky-900 ring-sky-600/15',
    warning: 'bg-amber-50 text-amber-900 ring-amber-600/20',
  };
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('rounded-xl px-4 py-3 text-sm ring-1 ring-inset', tones[tone])}
    >
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={title ? 'mt-1 opacity-90' : undefined}>{children}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'violet';

const badgeTones: Record<Tone, string> = {
  neutral: 'bg-zinc-100 text-zinc-700 ring-zinc-500/15 [--dot:var(--color-zinc-400)]',
  green: 'bg-brand-50 text-brand-800 ring-brand-600/20 [--dot:var(--color-brand-500)]',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20 [--dot:var(--color-amber-500)]',
  red: 'bg-red-50 text-red-700 ring-red-600/15 [--dot:var(--color-red-500)]',
  blue: 'bg-sky-50 text-sky-800 ring-sky-600/20 [--dot:var(--color-sky-500)]',
  violet: 'bg-violet-50 text-violet-800 ring-violet-600/20 [--dot:var(--color-violet-500)]',
};

export function Badge({
  tone = 'neutral',
  dot = false,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        badgeTones[tone],
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-(--dot)" aria-hidden />}
      {children}
    </span>
  );
}

export function KycBadge({ status }: { status: 'pending' | 'verified' | 'rejected' }) {
  const tone = { pending: 'amber', verified: 'green', rejected: 'red' } as const;
  const label = { pending: 'KYC pending', verified: 'KYC verified', rejected: 'KYC rejected' };
  return (
    <Badge tone={tone[status]} dot>
      {label[status]}
    </Badge>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-zinc-500">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-zinc-200/70', className)} />;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-zinc-300 bg-white/50 px-6 py-12 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-xl bg-zinc-100 text-zinc-500 [&_svg]:size-5">
        {icon ?? <Inbox />}
      </div>
      {title && <p className="font-medium text-zinc-900">{title}</p>}
      {children && <div className="mt-1 max-w-sm text-sm text-zinc-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---------- Data display ----------

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-zinc-950/5">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-950/5 bg-zinc-50/80">
            <tr>
              {head.map((h, i) => (
                <th
                  key={i}
                  className="px-4 py-3 text-xs font-medium whitespace-nowrap text-zinc-500 first:pl-6 last:pr-6"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-950/5 [&_td]:px-4 [&_td]:py-3.5 [&_td:first-child]:pl-6 [&_td:last-child]:pr-6">
            {children}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Stat({
  icon,
  label,
  value,
  sub,
  tone = 'green',
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'green' | 'amber' | 'blue' | 'violet';
}) {
  const chip = {
    green: 'bg-brand-50 text-brand-700',
    amber: 'bg-amber-50 text-amber-700',
    blue: 'bg-sky-50 text-sky-700',
    violet: 'bg-violet-50 text-violet-700',
  };
  return (
    <div className="flex h-full flex-col rounded-2xl bg-white p-5 shadow-card ring-1 ring-zinc-950/5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-500">{label}</span>
        {icon && (
          <span
            className={cx('grid size-8 place-items-center rounded-lg [&_svg]:size-4', chip[tone])}
          >
            {icon}
          </span>
        )}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-zinc-950 tabular-nums">
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div
      className={cx('h-2 overflow-hidden rounded-full bg-zinc-100', className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-[width] duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function DescriptionList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-zinc-950/5 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
          <dt className="text-zinc-500">{label}</dt>
          <dd className="text-right font-medium text-zinc-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return (
    <span
      className={cx(
        'grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800',
        className,
      )}
      aria-hidden
    >
      {initials || '?'}
    </span>
  );
}

// ---------- Tabs ----------

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="mb-6 overflow-x-auto border-b border-zinc-950/10">
      <nav className="-mb-px flex gap-6" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={value === t.id}
            onClick={() => onChange(t.id)}
            className={cx(
              'flex items-center gap-2 border-b-2 py-3 text-sm font-medium whitespace-nowrap transition',
              value === t.id
                ? 'border-brand-600 text-brand-800'
                : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                className={cx(
                  'rounded-full px-1.5 py-0.5 text-[11px] tabular-nums',
                  value === t.id ? 'bg-brand-100 text-brand-800' : 'bg-zinc-100 text-zinc-600',
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ---------- Dialog ----------

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        // A modal opened from a table cell is that cell's child in the DOM: reset what it inherits.
        'm-auto w-[calc(100%-2rem)] rounded-2xl bg-white p-0 text-left font-normal whitespace-normal shadow-pop open:animate-slide-up',
        wide ? 'max-w-2xl' : 'max-w-lg',
      )}
    >
      {open && (
        <div className="p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">{title}</h2>
              {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-m-1 rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
