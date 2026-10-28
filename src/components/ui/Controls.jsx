import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '../../lib/format';

export const ProgressRing = ({ value = 0, size = 64, stroke = 6, children, className }) => {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(Math.max(value, 0), 100);
  const done = clamped >= 100;

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-surface-2" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className="stroke-accent"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - clamped / 100) }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {children ??
          (done ? (
            <Check className="h-1/3 w-1/3 text-accent" strokeWidth={3} />
          ) : (
            <span className="font-bold tabular-nums" style={{ fontSize: Math.max(size / 4.6, 11) }}>
              {Math.round(clamped)}%
            </span>
          ))}
      </div>
    </div>
  );
};

export const ProgressBar = ({ value = 0, className }) => (
  <div className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-2', className)}>
    <motion.div
      className="h-full rounded-full bg-accent"
      initial={{ width: 0 }}
      animate={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
    />
  </div>
);

export const Switch = ({ checked, onChange, label, disabled, id }) => (
  <button
    id={id}
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn(
      'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200',
      'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 disabled:opacity-50',
      checked ? 'bg-accent' : 'bg-line'
    )}
  >
    <motion.span
      layout
      transition={{ type: 'spring', stiffness: 600, damping: 35 }}
      className={cn('h-5.5 w-5.5 rounded-full bg-white shadow-md', checked ? 'ml-[23px]' : 'ml-[3px]')}
    />
  </button>
);

// Pill-style filter tabs with a sliding active indicator
export const Segmented = ({ options, value, onChange, className, layoutId = 'segmented', size = 'md' }) => (
  <div className={cn('scrollbar-none flex gap-1 overflow-x-auto rounded-2xl bg-surface-2 p-1', className)} role="tablist">
    {options.map((option) => {
      const opt = typeof option === 'string' ? { value: option, label: option } : option;
      const active = opt.value === value;
      return (
        <button
          key={opt.value}
          role="tab"
          aria-selected={active}
          onClick={() => onChange(opt.value)}
          className={cn(
            'relative flex shrink-0 grow items-center justify-center gap-1.5 rounded-xl font-semibold transition-colors',
            size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
            active ? 'text-fg' : 'text-muted hover:text-fg'
          )}
        >
          {active && (
            <motion.span
              layoutId={layoutId}
              className="absolute inset-0 rounded-xl bg-surface shadow-sm"
              transition={{ type: 'spring', stiffness: 500, damping: 38 }}
            />
          )}
          <span className="relative flex items-center gap-1.5">
            {opt.label}
            {opt.count !== undefined && (
              <span className={cn('rounded-full px-1.5 text-[10px] leading-4', active ? 'bg-accent text-on-accent' : 'bg-line text-muted')}>
                {opt.count}
              </span>
            )}
          </span>
        </button>
      );
    })}
  </div>
);
