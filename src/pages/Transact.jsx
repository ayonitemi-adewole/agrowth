import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Sprout } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useTransactions } from '../hooks/useData';
import { formatNaira } from '../lib/format';
import { Button, Card, PageHeader, SectionTitle } from '../components/ui';
import BalanceCard from '../components/BalanceCard';
import TransactionList from '../components/TransactionList';

const Transact = () => {
  const { user, availableBalance, investmentBalance, profileLoading } = useApp();
  const { transactions, loading } = useTransactions(user?.uid);

  const totals = useMemo(() => {
    const sums = { deposit: 0, invest: 0, withdraw: 0 };
    transactions
      .filter((txn) => txn.status === 'successful')
      .forEach((txn) => {
        const type = String(txn.type || '').toLowerCase();
        if (type in sums) sums[type] += Number(txn.amount) || 0;
      });
    return sums;
  }, [transactions]);

  return (
    <div className="space-y-8">
      <PageHeader title="Wallet" subtitle="Fund your account and review activity" />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <BalanceCard title="Available balance" available={availableBalance} invested={investmentBalance} loading={profileLoading} showTotal={false}>
          <div className="flex gap-3">
            <Link
              to="/transact/deposit"
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-white font-bold text-brand-900 transition hover:bg-white/90 active:scale-[0.98]"
            >
              <ArrowDownLeft className="h-5 w-5" /> Deposit
            </Link>
            <Link
              to="/transact/withdraw"
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-white/15 font-bold backdrop-blur-sm transition hover:bg-white/25 active:scale-[0.98]"
            >
              <ArrowUpRight className="h-5 w-5" /> Withdraw
            </Link>
          </div>
        </BalanceCard>

        <div className="grid grid-cols-3 gap-3 lg:grid-cols-1">
          {[
            { label: 'Deposited', value: totals.deposit, icon: ArrowDownLeft, tone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
            { label: 'Invested', value: totals.invest, icon: Sprout, tone: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
            { label: 'Withdrawn', value: totals.withdraw, icon: ArrowUpRight, tone: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' },
          ].map(({ label, value, icon: Icon, tone }) => (
            <Card key={label} className="flex flex-col gap-2 p-4 lg:flex-row lg:items-center lg:gap-4">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted">{label}</p>
                <p className="truncate font-extrabold tabular-nums">{formatNaira(value, { compact: true })}</p>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <section>
        <SectionTitle title="Transaction history" />
        <TransactionList
          transactions={transactions}
          loading={loading}
          emptyAction={
            <Button to="/transact/deposit" size="sm" icon={ArrowDownLeft}>
              Make your first deposit
            </Button>
          }
        />
      </section>
    </div>
  );
};

export default Transact;
