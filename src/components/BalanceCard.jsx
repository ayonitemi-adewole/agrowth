import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';
import { formatNaira } from '../lib/format';

const readShowBalance = () => {
  try {
    return localStorage.getItem('showBalance') !== 'false';
  } catch {
    return true;
  }
};

const Amount = ({ value, visible, className }) => (
  <AnimatePresence mode="wait" initial={false}>
    <motion.span
      key={visible ? 'shown' : 'hidden'}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.15 }}
      className={className}
    >
      {visible ? formatNaira(value) : '₦ ••••••'}
    </motion.span>
  </AnimatePresence>
);

const BalanceCard = ({ available, invested, loading, children, title = 'Total balance', showTotal = true }) => {
  const [visible, setVisible] = useState(readShowBalance);

  const toggle = () => {
    setVisible((prev) => {
      try {
        localStorage.setItem('showBalance', String(!prev));
      } catch {
        // ignore
      }
      return !prev;
    });
  };

  return (
    <div className="accent-gradient relative overflow-hidden rounded-[1.75rem] p-5 text-white shadow-xl shadow-accent/25 sm:p-7">
      <svg className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 opacity-15" viewBox="0 0 200 200" aria-hidden="true">
        <path d="M100 20c40 30 60 70 0 160C40 90 60 50 100 20Z" fill="white" />
        <path d="M100 30c-6 50-6 100 0 150" stroke="white" strokeWidth="3" fill="none" opacity=".6" />
      </svg>
      <div className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />

      <div className="relative">
        <button onClick={toggle} className="flex items-center gap-2 text-sm font-medium text-white/80 hover:text-white" aria-label={visible ? 'Hide balance' : 'Show balance'}>
          {title}
          {visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </button>
        {loading ? (
          <div className="mt-2 h-10 w-48 animate-pulse rounded-xl bg-white/20" />
        ) : (
          <p className="mt-1 text-3xl font-extrabold tracking-tight tabular-nums sm:text-4xl">
            <Amount value={showTotal ? available + invested : available} visible={visible} />
          </p>
        )}

        {showTotal && (
          <div className="mt-5 grid max-w-sm grid-cols-2 gap-3">
            {[
              ['Available', available],
              ['Invested', invested],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-white/12 px-3.5 py-2.5 backdrop-blur-sm">
                <p className="text-xs text-white/70">{label}</p>
                <p className="text-sm font-bold tabular-nums sm:text-base">{loading ? '…' : <Amount value={value} visible={visible} />}</p>
              </div>
            ))}
          </div>
        )}
        {children && <div className="mt-5">{children}</div>}
      </div>
    </div>
  );
};

export default BalanceCard;
