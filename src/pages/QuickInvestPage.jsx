import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { addDoc, collection, doc, getDoc, updateDoc } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { PackageOpen, Zap } from 'lucide-react';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { useQuickInvestments } from '../hooks/useData';
import { cn, formatNaira } from '../lib/format';
import { Alert, AmountInput, Button, Card, EmptyState, Field, Modal, PageHeader } from '../components/ui';
import { PageLoader } from '../components/layout/FullPageLoader';

const DAY_MS = 24 * 60 * 60 * 1000;

const QuickInvestPage = () => {
  const { id } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { user, availableBalance } = useApp();
  const { quickInvestments, loading } = useQuickInvestments();
  const investment = state?.investment || quickInvestments.find((inv) => inv.id === id || inv.productName === id);

  const [amount, setAmount] = useState('');
  const [days, setDays] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [investing, setInvesting] = useState(false);

  if (!investment && loading) return <PageLoader />;
  if (!investment) {
    return (
      <>
        <PageHeader title="Quick invest" back="/invest" />
        <Card>
          <EmptyState icon={PackageOpen} title="Offer not available" description="This quick-invest offer couldn't be found." action={<Button to="/invest">Back to Invest</Button>} />
        </Card>
      </>
    );
  }

  const dailyROI = Number(investment.expectedROI) || 0;
  const minDays = Math.max(Number(investment.minimumInvestmentPeriod) || 1, Number(investment.minWithdrawalDays) || 0);
  const maxDays = Math.max(minDays * 6, 90);
  const duration = days ?? minDays;
  const value = Number(amount) || 0;
  const profit = value * (dailyROI / 100) * duration;
  const open = investment.status === 'open';
  const minAmount = Number(investment.minimumInvestment) || 0;

  const error =
    value && value < minAmount
      ? `Minimum investment is ${formatNaira(minAmount)}`
      : value > availableBalance
        ? `Insufficient balance. You have ${formatNaira(availableBalance)}`
        : '';
  const canInvest = open && value >= minAmount && value <= availableBalance && duration >= minDays;

  const handleInvest = async () => {
    setInvesting(true);
    try {
      const userRef = doc(db, 'users', user.uid);
      const userData = (await getDoc(userRef)).data() || {};
      if (Number(userData.availableBalance || 0) < value) {
        toast.error('You do not have sufficient funds for this investment.');
        return;
      }

      await updateDoc(userRef, {
        availableBalance: Number(userData.availableBalance || 0) - value,
        investmentBalance: Number(userData.investmentBalance || 0) + value,
      });

      const record = {
        status: 'Active',
        expectedReturn: profit,
        uid: user.uid,
        productName: investment.productName,
        investmentAmount: value,
        investmentPeriod: duration,
        expectedROI: dailyROI * duration,
        endDate: new Date(Date.now() + duration * DAY_MS).toISOString(),
        earningsSoFar: 0,
        createdAt: new Date().toISOString(),
      };
      await addDoc(collection(db, 'users', user.uid, 'investments'), record);
      await addDoc(collection(db, 'quickInvestments', 'fastVegetables', 'investors'), record);

      await addDoc(collection(db, 'transactions'), {
        userId: user.uid,
        email: user.email,
        amount: value,
        status: 'successful',
        type: 'invest',
        investmentId: investment.productName,
        timestamp: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });

      toast.success(`Successfully invested ${formatNaira(value)} in ${investment.productName}!`);
      navigate('/dashboard');
    } catch (err) {
      console.error('Error making investment:', err);
      toast.error('Something went wrong. Please try again.');
    } finally {
      setInvesting(false);
    }
  };

  const quickAmounts = [minAmount, minAmount * 2, minAmount * 5, minAmount * 10].filter((n, i, arr) => n > 0 && arr.indexOf(n) === i);

  return (
    <div className="pb-24 lg:pb-0">
      <PageHeader title={investment.productName} subtitle="Quick invest · daily returns" back />

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <div className="relative overflow-hidden rounded-3xl bg-brand-950 p-6 text-white">
            <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-gold-400/30 blur-3xl" />
            <span className="relative inline-flex items-center gap-1.5 rounded-full bg-gold-400/20 px-2.5 py-1 text-xs font-bold text-gold-300">
              <Zap className="h-3.5 w-3.5 fill-current" /> {open ? 'Open now' : 'Closed'}
            </span>
            <div className="relative mt-4 grid grid-cols-3 gap-3 text-center">
              {[
                ['ROI', `${dailyROI}%`, investment.ROIFrequency],
                ['Min. period', minDays, 'days'],
                ['Min. amount', formatNaira(minAmount, { compact: true }), 'to start'],
              ].map(([label, val, sub]) => (
                <div key={label} className="rounded-2xl bg-white/10 p-3">
                  <p className="text-[11px] text-white/65">{label}</p>
                  <p className="text-lg font-extrabold">{val}</p>
                  <p className="text-[11px] text-white/65">{sub}</p>
                </div>
              ))}
            </div>
          </div>

          <Card className="space-y-6 p-5 sm:p-6">
            <AmountInput
              label="How much do you want to invest?"
              value={amount}
              onChange={setAmount}
              placeholder="0"
              error={error}
              hint={`Wallet balance: ${formatNaira(availableBalance)}`}
            />
            <div className="flex flex-wrap gap-2">
              {quickAmounts.map((n) => (
                <button
                  key={n}
                  onClick={() => setAmount(String(n))}
                  className={cn('rounded-full border px-3.5 py-1.5 text-sm font-semibold transition', value === n ? 'border-accent bg-accent/10 text-accent' : 'border-line hover:bg-surface-2')}
                >
                  {formatNaira(n, { compact: true })}
                </button>
              ))}
            </div>

            <Field label="Duration" labelAction={<span className="text-sm font-extrabold text-accent">{duration} days</span>}>
              <input
                type="range"
                min={minDays}
                max={maxDays}
                value={duration}
                onChange={(e) => setDays(Number(e.target.value))}
                className="w-full"
                aria-label="Investment duration in days"
              />
              <div className="flex justify-between text-xs text-muted">
                <span>{minDays} days</span>
                <span>{maxDays} days</span>
              </div>
            </Field>
            <div className="flex flex-wrap gap-2">
              {[minDays, 14, 30, 60].filter((d, i, arr) => d >= minDays && d <= maxDays && arr.indexOf(d) === i).map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={cn('rounded-full border px-3.5 py-1.5 text-sm font-semibold transition', duration === d ? 'border-accent bg-accent/10 text-accent' : 'border-line hover:bg-surface-2')}
                >
                  {d} days
                </button>
              ))}
            </div>
          </Card>
        </div>

        <Card className="h-fit p-5 sm:p-6 lg:sticky lg:top-8">
          <h2 className="font-bold">Your projection</h2>
          <p className="text-sm text-muted">Based on {dailyROI}% per day</p>
          <motion.p key={Math.round(profit)} initial={{ scale: 0.95, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} className="mt-5 text-4xl font-extrabold tracking-tight text-accent tabular-nums">
            +{formatNaira(profit)}
          </motion.p>
          <p className="text-sm text-muted">profit after {duration} days</p>

          <div className="mt-5 divide-y divide-line rounded-2xl bg-surface-2/60 px-4 py-1 text-sm">
            {[
              ['You invest', formatNaira(value)],
              ['Total ROI', `${(dailyROI * duration).toFixed(1)}%`],
              ['Matures on', new Date(Date.now() + duration * DAY_MS).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })],
              ['Total payout', formatNaira(value + profit)],
            ].map(([label, val]) => (
              <div key={label} className="flex justify-between py-2.5">
                <span className="text-muted">{label}</span>
                <span className="font-semibold tabular-nums">{val}</span>
              </div>
            ))}
          </div>

          {!open && (
            <Alert tone="warning" className="mt-4">
              This offer is currently closed.
            </Alert>
          )}
          {value > availableBalance && (
            <Button to="/transact/deposit" variant="soft" size="sm" className="mt-4">
              Fund wallet
            </Button>
          )}

          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 p-4 pb-safe backdrop-blur-xl lg:static lg:mt-5 lg:border-0 lg:bg-transparent lg:p-0">
            <Button size="lg" className="w-full" disabled={!canInvest} onClick={() => setConfirmOpen(true)}>
              {value ? `Invest ${formatNaira(value)}` : 'Enter an amount'}
            </Button>
          </div>
        </Card>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => !investing && setConfirmOpen(false)}
        title="Confirm quick invest"
        description={`${investment.productName} for ${duration} days`}
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmOpen(false)} disabled={investing}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleInvest} loading={investing}>
              Confirm
            </Button>
          </>
        }
      >
        <div className="space-y-1 text-center">
          <p className="text-sm text-muted">You’re investing</p>
          <p className="text-3xl font-extrabold tabular-nums">{formatNaira(value)}</p>
          <p className="text-sm text-accent">Expected profit +{formatNaira(profit)}</p>
          <p className="pt-3 text-xs text-muted">Balance after: {formatNaira(availableBalance - value)}</p>
        </div>
      </Modal>
    </div>
  );
};

export default QuickInvestPage;
