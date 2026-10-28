import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowDownLeft, ArrowUpRight, Receipt, Sprout } from 'lucide-react';
import { cn, dayLabel, formatNaira, formatTime } from '../lib/format';
import { Badge, EmptyState, Segmented, Skeleton } from './ui';

const TYPES = {
  deposit: { label: 'Deposit', icon: ArrowDownLeft, sign: '+', tone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', amount: 'text-emerald-600 dark:text-emerald-400' },
  invest: { label: 'Investment', icon: Sprout, sign: '−', tone: 'bg-sky-500/15 text-sky-600 dark:text-sky-400', amount: 'text-fg' },
  withdraw: { label: 'Withdrawal', icon: ArrowUpRight, sign: '−', tone: 'bg-rose-500/15 text-rose-600 dark:text-rose-400', amount: 'text-fg' },
};

const STATUS = {
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  failed: 'bg-red-500/15 text-red-600 dark:text-red-400',
};

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'deposit', label: 'Deposits' },
  { value: 'invest', label: 'Investments' },
  { value: 'withdraw', label: 'Withdrawals' },
];

const PAGE_SIZE = 10;

const typeOf = (txn) => String(txn.type || '').toLowerCase();

export const TransactionRow = ({ txn, index = 0 }) => {
  const type = TYPES[typeOf(txn)] || { label: txn.type || 'Transaction', icon: Receipt, sign: '', tone: 'bg-surface-2 text-muted', amount: 'text-fg' };
  const Icon = type.icon;
  const status = String(txn.status || '').toLowerCase();

  return (
    <motion.li
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.03 }}
      className="flex items-center gap-3 px-4 py-3.5"
    >
      <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', type.tone)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">
          {type.label}
          {txn.investmentId && <span className="font-medium text-muted"> · {txn.investmentId}</span>}
        </p>
        <p className="text-xs text-muted">{formatTime(txn.createdAt)}</p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <p className={cn('text-sm font-extrabold tabular-nums', status === 'successful' ? type.amount : 'text-muted')}>
          {type.sign}
          {formatNaira(txn.amount)}
        </p>
        {status !== 'successful' && <Badge className={cn('px-2 py-0.5 text-[10px] capitalize', STATUS[status] || 'bg-surface-2 text-muted')}>{status || 'unknown'}</Badge>}
      </div>
    </motion.li>
  );
};

const TransactionList = ({ transactions, loading, limit, emptyAction }) => {
  const [filter, setFilter] = useState('all');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const preview = Boolean(limit);

  const filtered = useMemo(() => (filter === 'all' ? transactions : transactions.filter((txn) => typeOf(txn) === filter)), [transactions, filter]);
  const shown = filtered.slice(0, preview ? limit : visible);

  const groups = useMemo(() => {
    const map = new Map();
    shown.forEach((txn) => {
      const label = dayLabel(txn.createdAt);
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(txn);
    });
    return [...map.entries()];
  }, [shown]);

  const counts = useMemo(() => {
    const result = { all: transactions.length };
    transactions.forEach((txn) => {
      result[typeOf(txn)] = (result[typeOf(txn)] || 0) + 1;
    });
    return result;
  }, [transactions]);

  return (
    <div>
      {!preview && (
        <Segmented
          options={FILTERS.map((f) => ({ ...f, count: counts[f.value] || 0 }))}
          value={filter}
          onChange={(value) => {
            setFilter(value);
            setVisible(PAGE_SIZE);
          }}
          layoutId="txn-filter"
          className="mb-4"
        />
      )}

      {loading ? (
        <div className="space-y-2 rounded-3xl border border-line bg-surface p-4">
          {Array.from({ length: preview ? limit : 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5">
              <Skeleton className="h-11 w-11 rounded-2xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line">
          <EmptyState
            icon={Receipt}
            title={filter === 'all' ? 'No transactions yet' : `No ${FILTERS.find((f) => f.value === filter).label.toLowerCase()} yet`}
            description="Your deposits, investments and withdrawals will show up here."
            action={emptyAction}
          />
        </div>
      ) : preview ? (
        <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface">
          {shown.map((txn, i) => (
            <TransactionRow key={txn.id} txn={txn} index={i} />
          ))}
        </ul>
      ) : (
        <div className="space-y-5">
          {groups.map(([label, items]) => (
            <section key={label}>
              <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-muted">{label}</h3>
              <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface">
                {items.map((txn, i) => (
                  <TransactionRow key={txn.id} txn={txn} index={i} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {!preview && visible < filtered.length && (
        <div className="mt-6 flex justify-center">
          <button onClick={() => setVisible((v) => v + PAGE_SIZE)} className="rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-semibold transition hover:bg-surface-2">
            Load more
          </button>
        </div>
      )}
    </div>
  );
};

export default TransactionList;
