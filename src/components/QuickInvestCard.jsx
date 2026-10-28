import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Zap } from 'lucide-react';
import { formatNaira } from '../lib/format';

const QuickInvestCard = ({ investment }) => {
  const { productName, expectedROI, ROIFrequency, minimumInvestment, minimumInvestmentPeriod, status } = investment;
  const open = status === 'open';

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-3xl bg-brand-950 p-5 text-white sm:p-6">
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold-400/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 left-1/3 h-48 w-48 rounded-full bg-brand-500/40 blur-3xl" />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-400/20 px-2.5 py-1 text-xs font-bold text-gold-300">
            <Zap className="h-3.5 w-3.5 fill-current" /> Quick invest
          </span>
          <h3 className="mt-3 text-xl font-extrabold tracking-tight">{productName}</h3>
          <p className="mt-1 text-sm text-white/70">Short cycles with daily returns. Pick your amount and duration.</p>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-white/10 px-3 py-1.5">
              <strong className="text-gold-300">{expectedROI}%</strong> {ROIFrequency}
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1.5">From {minimumInvestmentPeriod} days</span>
            <span className="rounded-full bg-white/10 px-3 py-1.5">Min. {formatNaira(minimumInvestment)}</span>
          </div>
        </div>

        <Link
          to={`/invest/quick-invest/fast-vegetable/${productName}`}
          state={{ investment }}
          aria-disabled={!open}
          className={`inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-6 font-bold transition ${
            open ? 'bg-gold-400 text-brand-950 hover:bg-gold-300' : 'pointer-events-none bg-white/10 text-white/50'
          }`}
        >
          {open ? 'Invest now' : 'Closed'} {open && <ArrowRight className="h-4 w-4" />}
        </Link>
      </div>
    </motion.div>
  );
};

export default QuickInvestCard;
