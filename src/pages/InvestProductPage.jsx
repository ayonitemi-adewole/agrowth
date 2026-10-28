import { useLocation, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CalendarCheck, CalendarClock, CalendarPlus, PackageOpen } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useInvestment, useNow } from '../hooks/useData';
import { cn, formatDate, formatNaira } from '../lib/format';
import {
  STATUS_STYLES,
  cropEmoji,
  getExpectedProfit,
  getMaturityDate,
  getPeriodLabel,
  getProgress,
  getStartDate,
  getTimeLeft,
  isQuickInvestment,
} from '../lib/investments';
import { Badge, Button, Card, EmptyState, PageHeader, ProgressRing } from '../components/ui';
import { PageLoader } from '../components/layout/FullPageLoader';

const InvestProductPage = () => {
  const { id } = useParams();
  const { state } = useLocation();
  const { user } = useApp();
  const { investment, loading } = useInvestment(user?.uid, id, state?.investment);
  const now = useNow(30000);

  if (loading) return <PageLoader />;
  if (!investment) {
    return (
      <>
        <PageHeader title="Investment" back="/invest" />
        <Card>
          <EmptyState icon={PackageOpen} title="Investment not found" description="We couldn't load this investment." action={<Button to="/invest">Back to portfolio</Button>} />
        </Card>
      </>
    );
  }

  const progress = getProgress(investment, now);
  const timeLeft = getTimeLeft(investment, now);
  const profit = getExpectedProfit(investment);
  const amount = Number(investment.investmentAmount) || 0;
  const completed = investment.status === 'Completed';
  const quick = isQuickInvestment(investment);
  const start = getStartDate(investment);
  const maturity = getMaturityDate(investment);

  const timeline = [
    { icon: CalendarPlus, label: 'Invested', date: investment.createdAt, done: true },
    ...(!quick ? [{ icon: CalendarClock, label: 'Cycle starts', date: start, done: start && now >= start }] : []),
    { icon: CalendarCheck, label: completed ? 'Paid out' : 'Maturity', date: investment.completedAt || maturity, done: completed },
  ];

  return (
    <div>
      <PageHeader title={investment.productName} subtitle={`Invested ${formatDate(investment.createdAt)}`} back />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card className="flex flex-col items-center p-6 text-center sm:p-8">
          <div className="relative">
            <ProgressRing value={progress} size={200} stroke={14}>
              <div>
                <span className="text-5xl">{cropEmoji(investment.productName)}</span>
                <p className="mt-1 text-2xl font-extrabold tabular-nums">{Math.round(progress)}%</p>
              </div>
            </ProgressRing>
          </div>
          <Badge className={cn('mt-5', STATUS_STYLES[investment.status] || 'bg-surface-2 text-muted')} dot>
            {investment.status}
          </Badge>
          <p className="mt-2 text-sm text-muted">{completed ? 'This cycle is complete' : investment.status === 'Pending' ? 'Waiting for the cycle to begin' : timeLeft.label}</p>

          <div className="mt-6 grid w-full grid-cols-2 gap-3">
            <div className="rounded-2xl bg-surface-2/70 p-4">
              <p className="text-xs text-muted">Invested</p>
              <p className="text-lg font-extrabold tabular-nums">{formatNaira(amount)}</p>
            </div>
            <div className="rounded-2xl bg-accent/10 p-4">
              <p className="text-xs text-muted">{completed ? 'Payout' : 'Expected payout'}</p>
              <p className="text-lg font-extrabold text-accent tabular-nums">{formatNaira(amount + profit)}</p>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-5 sm:p-6">
            <h2 className="mb-2 font-bold">Details</h2>
            <dl className="divide-y divide-line text-sm">
              {[
                ['Amount', formatNaira(amount)],
                ...(!quick && investment.unitsBought ? [['Units bought', investment.unitsBought]] : []),
                ['Total ROI', `${investment.expectedROI}%`],
                ...(quick && investment.investmentPeriod ? [['Daily ROI', `${(investment.expectedROI / investment.investmentPeriod).toFixed(2)}%`]] : []),
                ['Duration', getPeriodLabel(investment)],
                [completed ? 'Profit' : 'Expected profit', <span key="p" className="text-accent">+{formatNaira(profit)}</span>],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 py-3">
                  <dt className="text-muted">{label}</dt>
                  <dd className="font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="p-5 sm:p-6">
            <h2 className="mb-4 font-bold">Timeline</h2>
            <ol className="relative space-y-6">
              <span className="absolute bottom-3 left-5 top-3 w-0.5 bg-line" aria-hidden="true" />
              {timeline.map(({ icon: Icon, label, date, done }, i) => (
                <motion.li key={label} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }} className="relative flex items-center gap-4">
                  <span className={cn('relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2', done ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface text-muted')}>
                    <Icon className="h-4.5 w-4.5" />
                  </span>
                  <div>
                    <p className="text-sm font-bold">{label}</p>
                    <p className="text-xs text-muted">{formatDate(date)}</p>
                  </div>
                </motion.li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default InvestProductPage;
