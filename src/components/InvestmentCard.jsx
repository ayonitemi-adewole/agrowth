import { Link } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { cn, formatNaira } from '../lib/format';
import { STATUS_STYLES, cropEmoji, getExpectedProfit, getPeriodLabel, getProgress, getTimeLeft } from '../lib/investments';
import { Badge, ProgressRing } from './ui';

// `compact` is the dashboard carousel tile; the default is a full-width list row
const InvestmentCard = ({ investment, now, compact = false }) => {
  const progress = getProgress(investment, now);
  const timeLeft = getTimeLeft(investment, now);
  const profit = getExpectedProfit(investment);

  return (
    <Link
      to={`/invest/product/${investment.id}`}
      state={{ investment }}
      className={cn(
        'group block rounded-3xl border border-line bg-surface p-4 transition-all duration-200 hover:border-accent/40 hover:shadow-lg hover:shadow-black/5',
        compact ? 'w-[270px] shrink-0 snap-start sm:w-[300px]' : 'w-full'
      )}
    >
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-2xl">{cropEmoji(investment.productName)}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{investment.productName}</p>
          <p className="text-xs text-muted">
            {getPeriodLabel(investment)}
            {investment.unitsBought ? ` · ${investment.unitsBought} unit${investment.unitsBought === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        <ProgressRing value={progress} size={compact ? 52 : 56} stroke={5} />
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-lg font-extrabold tabular-nums">{formatNaira(investment.investmentAmount)}</p>
          <p className="text-xs font-semibold text-accent">+{formatNaira(profit)} {investment.status === 'Completed' ? 'earned' : 'expected'}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Badge className={STATUS_STYLES[investment.status] || 'bg-surface-2 text-muted'} dot>
            {investment.status}
          </Badge>
          {investment.status !== 'Completed' && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <Clock className="h-3 w-3" /> {investment.status === 'Pending' ? 'Starts soon' : timeLeft.label}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
};

export default InvestmentCard;
