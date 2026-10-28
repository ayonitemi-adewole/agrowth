import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, History, Sprout } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useInvestmentProducts, useInvestments, useNow, useQuickInvestments, useTransactions } from '../hooks/useData';
import { greeting } from '../lib/format';
import { Avatar, Button, EmptyState, SectionTitle, Skeleton } from '../components/ui';
import BalanceCard from '../components/BalanceCard';
import InvestmentCard from '../components/InvestmentCard';
import ProductExplorer from '../components/ProductExplorer';
import QuickInvestCard from '../components/QuickInvestCard';
import TransactionList from '../components/TransactionList';
import ThemeToggle from '../components/ThemeToggle';

const ACTIONS = [
  { to: '/transact/deposit', label: 'Deposit', icon: ArrowDownLeft },
  { to: '/transact/withdraw', label: 'Withdraw', icon: ArrowUpRight },
  { to: '/invest', label: 'Invest', icon: Sprout },
  { to: '/transact', label: 'History', icon: History },
];

const SeeAll = ({ to }) => (
  <Link to={to} className="flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
    See all <ArrowRight className="h-4 w-4" />
  </Link>
);

const Dashboard = () => {
  const { user, profile, displayName, availableBalance, investmentBalance, profileLoading } = useApp();
  const { investments, loading: investmentsLoading } = useInvestments(user?.uid);
  const { transactions, loading: transactionsLoading } = useTransactions(user?.uid);
  const { products, loading: productsLoading } = useInvestmentProducts();
  const { quickInvestments } = useQuickInvestments();
  const now = useNow(30000);

  const running = useMemo(() => investments.filter((inv) => inv.status !== 'Completed'), [investments]);
  const openQuickInvest = quickInvestments.find((inv) => inv.status === 'open');

  return (
    <div className="space-y-8">
      <header className="flex items-center gap-3">
        <Link to="/profile" aria-label="Profile">
          <Avatar src={user?.photoURL} name={`${profile?.firstName || displayName} ${profile?.lastName || ''}`} size={46} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted">{greeting()},</p>
          <h1 className="truncate text-xl font-extrabold tracking-tight sm:text-2xl">{displayName} 👋</h1>
        </div>
        <ThemeToggle className="lg:hidden" />
      </header>

      <BalanceCard available={availableBalance} invested={investmentBalance} loading={profileLoading}>
        <div className="grid grid-cols-4 gap-2 sm:max-w-md">
          {ACTIONS.map(({ to, label, icon: Icon }, i) => (
            <motion.div key={label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.05 }}>
              <Link to={to} className="group flex flex-col items-center gap-1.5 text-xs font-semibold text-white/90">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm transition group-hover:bg-white/25 group-active:scale-95">
                  <Icon className="h-5 w-5" />
                </span>
                {label}
              </Link>
            </motion.div>
          ))}
        </div>
      </BalanceCard>

      <section>
        <SectionTitle title="Your farms" subtitle={running.length ? `${running.length} running` : undefined} action={investments.length > 0 && <SeeAll to="/invest" />} />
        {investmentsLoading ? (
          <div className="flex gap-4 overflow-hidden">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-40 w-[270px] shrink-0 rounded-3xl sm:w-[300px]" />
            ))}
          </div>
        ) : running.length ? (
          <div className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
            {running.map((inv) => (
              <InvestmentCard key={inv.id} investment={inv} now={now} compact />
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-line">
            <EmptyState
              icon={Sprout}
              title={investments.length ? 'All harvests are in' : 'Plant your first seed'}
              description={investments.length ? 'Every investment has matured. Start a new cycle below.' : 'Back a crop cycle and track its growth right here.'}
              action={
                <Button to="/invest" size="sm" iconRight={ArrowRight}>
                  Explore farms
                </Button>
              }
            />
          </div>
        )}
      </section>

      {openQuickInvest && <QuickInvestCard investment={openQuickInvest} />}

      <div className="grid gap-8 xl:grid-cols-[1fr_1.2fr]">
        <section>
          <SectionTitle title="Recent activity" action={transactions.length > 0 && <SeeAll to="/transact" />} />
          <TransactionList
            transactions={transactions}
            loading={transactionsLoading}
            limit={4}
            emptyAction={
              <Button to="/transact/deposit" size="sm" icon={ArrowDownLeft}>
                Make a deposit
              </Button>
            }
          />
        </section>

        <section>
          <SectionTitle title="Top opportunities" subtitle="Open crop cycles" action={products.length > 2 && <SeeAll to="/invest#explore" />} />
          <ProductExplorer products={products} loading={productsLoading} limit={2} />
        </section>
      </div>
    </div>
  );
};

export default Dashboard;
