import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CircleCheck, Hourglass, PiggyBank, Sprout, TrendingUp, Wallet } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useInvestmentProducts, useInvestments, useNow, useQuickInvestments } from '../hooks/useData';
import { formatNaira, toDate } from '../lib/format';
import { cropEmoji, getExpectedProfit, getProgress } from '../lib/investments';
import { Card, EmptyState, PageHeader, SectionTitle, Segmented, Select, Skeleton } from '../components/ui';
import InvestmentCard from '../components/InvestmentCard';
import ProductExplorer from '../components/ProductExplorer';
import QuickInvestCard from '../components/QuickInvestCard';

const PAGE_SIZE = 6;
const ALLOCATION_COLORS = ['bg-accent', 'bg-gold-400', 'bg-sky-500', 'bg-violet-500', 'bg-rose-500', 'bg-lime-500'];

const Stat = ({ icon: Icon, label, value, tone = 'text-accent bg-accent/12', index }) => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
    <Card className="h-full p-4 sm:p-5">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-3 text-xs font-medium text-muted sm:text-sm">{label}</p>
      <p className="mt-0.5 truncate text-lg font-extrabold tracking-tight tabular-nums sm:text-xl">{value}</p>
    </Card>
  </motion.div>
);

// Share of active + pending capital per product
const Allocation = ({ investments }) => {
  const slices = useMemo(() => {
    const totals = new Map();
    investments
      .filter((inv) => inv.status !== 'Completed')
      .forEach((inv) => totals.set(inv.productName, (totals.get(inv.productName) || 0) + (Number(inv.investmentAmount) || 0)));
    const sum = [...totals.values()].reduce((a, b) => a + b, 0);
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => ({ name, amount, share: sum ? (amount / sum) * 100 : 0 }));
  }, [investments]);

  if (!slices.length) return null;

  return (
    <Card className="p-5">
      <SectionTitle title="Portfolio mix" subtitle="Where your running capital sits" />
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
        {slices.map((slice, i) => (
          <motion.div
            key={slice.name}
            className={`${ALLOCATION_COLORS[i % ALLOCATION_COLORS.length]} h-full first:rounded-l-full last:rounded-r-full`}
            initial={{ width: 0 }}
            animate={{ width: `${slice.share}%` }}
            transition={{ duration: 0.8, delay: i * 0.08 }}
            title={`${slice.name}: ${slice.share.toFixed(1)}%`}
          />
        ))}
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {slices.map((slice, i) => (
          <li key={slice.name} className="flex items-center gap-2 text-sm">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${ALLOCATION_COLORS[i % ALLOCATION_COLORS.length]}`} />
            <span className="truncate">
              {cropEmoji(slice.name)} {slice.name}
            </span>
            <span className="ml-auto shrink-0 font-semibold tabular-nums">{formatNaira(slice.amount, { compact: true })}</span>
            <span className="w-11 shrink-0 text-right text-xs text-muted tabular-nums">{slice.share.toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </Card>
  );
};

const Invest = () => {
  const { user } = useApp();
  const { hash } = useLocation();
  const { investments, loading } = useInvestments(user?.uid);
  const { products, loading: productsLoading } = useInvestmentProducts();
  const { quickInvestments } = useQuickInvestments();
  const now = useNow(30000);
  const [status, setStatus] = useState('All');
  const [sortBy, setSortBy] = useState('latest');
  const [visible, setVisible] = useState(PAGE_SIZE);

  useEffect(() => {
    if (hash === '#explore') document.getElementById('explore')?.scrollIntoView({ behavior: 'smooth' });
  }, [hash]);

  const summary = useMemo(() => {
    const active = investments.filter((inv) => inv.status === 'Active');
    return {
      totalInvested: investments.reduce((sum, inv) => sum + (Number(inv.investmentAmount) || 0), 0),
      activeValue: active.reduce((sum, inv) => sum + (Number(inv.investmentAmount) || 0), 0),
      expectedReturns: active.reduce((sum, inv) => sum + getExpectedProfit(inv), 0),
      counts: {
        All: investments.length,
        Active: active.length,
        Pending: investments.filter((inv) => inv.status === 'Pending').length,
        Completed: investments.filter((inv) => inv.status === 'Completed').length,
      },
    };
  }, [investments]);

  const displayed = useMemo(() => {
    const list = investments.filter((inv) => status === 'All' || inv.status === status);
    const sorters = {
      latest: (a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0),
      progress: (a, b) => getProgress(b, now) - getProgress(a, now),
      amount: (a, b) => (Number(b.investmentAmount) || 0) - (Number(a.investmentAmount) || 0),
    };
    return [...list].sort(sorters[sortBy]);
  }, [investments, status, sortBy, now]);

  const openQuickInvest = quickInvestments.find((inv) => inv.status === 'open');

  return (
    <div className="space-y-8">
      <PageHeader title="Invest" subtitle="Your portfolio and new opportunities" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-32 rounded-3xl" />)
        ) : (
          <>
            <Stat index={0} icon={PiggyBank} label="Total invested" value={formatNaira(summary.totalInvested)} />
            <Stat index={1} icon={Wallet} label="Active capital" value={formatNaira(summary.activeValue)} tone="text-sky-600 bg-sky-500/15 dark:text-sky-400" />
            <Stat index={2} icon={TrendingUp} label="Expected returns" value={`+${formatNaira(summary.expectedReturns)}`} tone="text-gold-500 bg-gold-400/20" />
            <Stat
              index={3}
              icon={CircleCheck}
              label="Active · Pending · Done"
              value={`${summary.counts.Active} · ${summary.counts.Pending} · ${summary.counts.Completed}`}
              tone="text-violet-600 bg-violet-500/15 dark:text-violet-400"
            />
          </>
        )}
      </div>

      {!loading && <Allocation investments={investments} />}

      {openQuickInvest && <QuickInvestCard investment={openQuickInvest} />}

      <section>
        <SectionTitle title="Your investments" />
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-40 rounded-3xl" />
            ))}
          </div>
        ) : investments.length === 0 ? (
          <Card className="border-dashed">
            <EmptyState icon={Sprout} title="No investments yet" description="Pick a crop cycle below to start growing your money." />
          </Card>
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Segmented
                options={['All', 'Active', 'Pending', 'Completed'].map((value) => ({ value, label: value, count: summary.counts[value] }))}
                value={status}
                onChange={(value) => {
                  setStatus(value);
                  setVisible(PAGE_SIZE);
                }}
                layoutId="investment-status"
                className="flex-1"
              />
              <Select value={sortBy} onChange={(e) => setSortBy(e.target.value)} fieldClassName="sm:w-44" aria-label="Sort investments">
                <option value="latest">Newest first</option>
                <option value="progress">Most progress</option>
                <option value="amount">Largest amount</option>
              </Select>
            </div>

            {displayed.length === 0 ? (
              <Card className="border-dashed">
                <EmptyState icon={Hourglass} title={`No ${status.toLowerCase()} investments`} description="Try a different filter." />
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {displayed.slice(0, visible).map((inv) => (
                  <InvestmentCard key={inv.id} investment={inv} now={now} />
                ))}
              </div>
            )}

            {visible < displayed.length && (
              <div className="mt-6 flex justify-center">
                <button
                  onClick={() => setVisible((v) => v + PAGE_SIZE)}
                  className="rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-semibold transition hover:bg-surface-2"
                >
                  Show more ({displayed.length - visible} left)
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section id="explore" className="scroll-mt-6">
        <SectionTitle title="Explore opportunities" subtitle="Open crop cycles you can invest in today" />
        <ProductExplorer products={products} loading={productsLoading} />
      </section>
    </div>
  );
};

export default Invest;
