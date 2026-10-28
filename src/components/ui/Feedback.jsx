import { motion } from 'framer-motion';
import { AlertTriangle, Info, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '../../lib/format';

export const Badge = ({ className, children, dot = false }) => (
  <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', className)}>
    {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
    {children}
  </span>
);

export const Skeleton = ({ className }) => <div className={cn('skeleton rounded-xl', className)} />;

export const Spinner = ({ className }) => (
  <span
    className={cn('inline-block h-6 w-6 animate-spin rounded-full border-[3px] border-accent/25 border-t-accent', className)}
    role="status"
    aria-label="Loading"
  />
);

export const EmptyState = ({ icon: Icon, title, description, action, className }) => (
  <motion.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    className={cn('flex flex-col items-center px-6 py-10 text-center', className)}
  >
    {Icon && (
      <div className="relative mb-4">
        <div className="absolute inset-0 scale-150 rounded-full bg-accent/10 blur-xl" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/12 text-accent">
          <Icon className="h-7 w-7" />
        </div>
      </div>
    )}
    <h3 className="font-bold">{title}</h3>
    {description && <p className="mt-1 max-w-xs text-sm text-muted">{description}</p>}
    {action && <div className="mt-5">{action}</div>}
  </motion.div>
);

const ALERT_STYLES = {
  warning: { icon: AlertTriangle, classes: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300' },
  info: { icon: Info, classes: 'border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300' },
  success: { icon: CheckCircle2, classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' },
  error: { icon: XCircle, classes: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300' },
};

export const Alert = ({ tone = 'info', title, children, className }) => {
  const { icon: Icon, classes } = ALERT_STYLES[tone];
  return (
    <div className={cn('flex gap-3 rounded-2xl border p-4 text-sm', classes, className)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon className="mt-0.5 h-4.5 w-4.5 shrink-0" />
      <div>
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5 opacity-90')}>{children}</div>}
      </div>
    </div>
  );
};
