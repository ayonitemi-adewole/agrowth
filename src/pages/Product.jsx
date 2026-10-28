import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { addDoc, collection, doc, getDoc, updateDoc } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { CalendarDays, Minus, PackageOpen, Plus, ShieldAlert, Sprout, TrendingUp, Wallet } from 'lucide-react';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { useProduct } from '../hooks/useData';
import { cn, formatDate, formatNaira, formatNumber, toDate } from '../lib/format';
import { cropEmoji } from '../lib/investments';
import { Alert, Badge, Button, Card, EmptyState, Modal, PageHeader } from '../components/ui';
import { PageLoader } from '../components/layout/FullPageLoader';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_DAYS_BEFORE_START = 5;

const Row = ({ label, value, strong }) => (
  <div className="flex items-center justify-between gap-4 py-2 text-sm">
    <span className="text-muted">{label}</span>
    <span className={cn('text-right tabular-nums', strong ? 'text-base font-extrabold' : 'font-semibold')}>{value}</span>
  </div>
);

const Product = () => {
  const { id } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { user, availableBalance } = useApp();
  const { product, loading } = useProduct(id, state?.product);
  const [units, setUnits] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [investing, setInvesting] = useState(false);

  const unitPrice = Number(product?.unitPrice) || 0;
  const availableUnits = Number(product?.availableUnits) || 0;
  const minUnits = unitPrice ? Math.max(1, Math.ceil((Number(product?.minimumInvestment) || 0) / unitPrice)) : 1;

  useEffect(() => {
    if (product && units === null) setUnits(minUnits);
  }, [product, units, minUnits]);

  if (loading) return <PageLoader />;
  if (!product) {
    return (
      <>
        <PageHeader title="Opportunity" back="/invest" />
        <Card>
          <EmptyState icon={PackageOpen} title="Opportunity not found" description="It may have been removed or the link is incorrect." action={<Button to="/invest">Browse opportunities</Button>} />
        </Card>
      </>
    );
  }

  const qty = units ?? minUnits;
  const amount = qty * unitPrice;
  const roi = Number(product.expectedROI) || 0;
  const period = Number(product.investmentPeriod) || 0;
  const profit = (amount * roi) / 100;
  const startDate = toDate(product.startDate);
  const daysToStart = startDate ? Math.ceil((startDate - new Date()) / DAY_MS) : Infinity;
  const windowClosed = daysToStart < MIN_DAYS_BEFORE_START;
  const soldOut = availableUnits <= 0;
  const maxAffordable = Math.min(availableUnits, unitPrice ? Math.floor(availableBalance / unitPrice) : 0);

  const problems = [];
  if (qty > availableUnits) problems.push(`Only ${formatNumber(availableUnits)} units are available.`);
  if (qty < minUnits) problems.push(`The minimum is ${minUnits} unit${minUnits === 1 ? '' : 's'} (${formatNaira(product.minimumInvestment)}).`);
  if (amount > availableBalance) problems.push(`You need ${formatNaira(amount - availableBalance)} more in your wallet.`);

  const setQty = (value) => setUnits(Math.max(1, Math.min(Number(value) || 0, Math.max(availableUnits, 1))));

  const handleInvest = async () => {
    setInvesting(true);
    try {
      const productRef = doc(db, 'investmentProducts', product.id);
      const productSnap = await getDoc(productRef);
      if (!productSnap.exists()) throw new Error('Product not found');

      const liveUnits = productSnap.data().availableUnits;
      if (liveUnits < qty) {
        toast.error(`Only ${liveUnits} units are left. Please reduce your units.`);
        return;
      }
      if (amount < product.minimumInvestment) {
        toast.error(`Minimum investment is ${minUnits} units.`);
        return;
      }
      if (windowClosed) {
        toast.error(`Investments must be made at least ${MIN_DAYS_BEFORE_START} days before the start date.`);
        return;
      }

      const userRef = doc(db, 'users', user.uid);
      const userData = (await getDoc(userRef)).data() || {};
      if (Number(userData.availableBalance || 0) < amount) {
        toast.error('Insufficient balance. Please fund your wallet.');
        return;
      }

      await updateDoc(productRef, { availableUnits: liveUnits - qty });

      const record = {
        uid: user.uid,
        productName: product.name,
        investmentAmount: amount,
        investmentPeriod: product.investmentPeriod,
        expectedROI: product.expectedROI,
        status: 'Pending',
        unitPrice: product.unitPrice,
        unitsBought: qty,
        startDate: product.startDate,
        endDate: new Date(Date.now() + product.investmentPeriod * DAY_MS).toISOString(),
        earningsSoFar: 0,
        createdAt: new Date().toISOString(),
      };
      await addDoc(collection(db, 'users', user.uid, 'investments'), record);
      await addDoc(collection(db, 'investmentProducts', product.id, 'investors'), record);

      await addDoc(collection(db, 'transactions'), {
        userId: user.uid,
        email: user.email,
        amount,
        status: 'successful',
        type: 'invest',
        investmentId: product.name,
        timestamp: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });

      await updateDoc(userRef, {
        availableBalance: Number(userData.availableBalance) - amount,
        investmentBalance: Number(userData.investmentBalance || 0) + amount,
      });

      toast.success(`You invested ${formatNaira(amount)} in ${product.name} 🎉`);
      setConfirmOpen(false);
      navigate('/invest');
    } catch (error) {
      console.error('Error making investment:', error);
      toast.error('Something went wrong. Please try again.');
    } finally {
      setInvesting(false);
    }
  };

  const canInvest = !soldOut && !windowClosed && problems.length === 0;

  return (
    <div className="pb-24 lg:pb-0">
      <PageHeader title={product.name} subtitle={product.category} back />

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="relative flex items-center gap-5 bg-gradient-to-br from-accent/15 via-accent/5 to-transparent p-6">
              <motion.div
                initial={{ scale: 0.6, rotate: -15, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl bg-surface text-5xl shadow-sm"
              >
                {cropEmoji(product.name)}
              </motion.div>
              <div>
                <div className="flex flex-wrap gap-1.5">
                  {product.riskLevel && <Badge className="bg-surface text-fg">{product.riskLevel} risk</Badge>}
                  {soldOut && <Badge className="bg-red-500/15 text-red-600">Sold out</Badge>}
                </div>
                <p className="mt-2 text-3xl font-extrabold text-accent">{roi}%</p>
                <p className="text-sm text-muted">expected return over {period} months</p>
              </div>
            </div>
            {product.description && <p className="border-t border-line p-6 text-sm leading-relaxed text-muted">{product.description}</p>}
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { icon: Wallet, label: 'Price per unit', value: formatNaira(unitPrice) },
              { icon: TrendingUp, label: 'Minimum', value: formatNaira(product.minimumInvestment) },
              { icon: Sprout, label: 'Units left', value: formatNumber(availableUnits) },
              { icon: CalendarDays, label: 'Starts', value: formatDate(product.startDate) },
              { icon: CalendarDays, label: 'Ends', value: formatDate(product.endDate) },
              { icon: ShieldAlert, label: 'Risk level', value: product.riskLevel || '—' },
            ].map(({ icon: Icon, label, value }) => (
              <Card key={label} className="p-4">
                <Icon className="h-4.5 w-4.5 text-accent" />
                <p className="mt-2 text-xs text-muted">{label}</p>
                <p className="font-bold">{value}</p>
              </Card>
            ))}
          </div>
        </div>

        <Card className="h-fit p-5 sm:p-6 lg:sticky lg:top-8">
          <h2 className="text-lg font-bold">Buy units</h2>
          <p className="text-sm text-muted">Wallet balance: {formatNaira(availableBalance)}</p>

          {windowClosed && !soldOut && (
            <Alert tone="warning" className="mt-4">
              This cycle {daysToStart > 0 ? `starts in ${daysToStart} day${daysToStart === 1 ? '' : 's'}` : 'has already started'}. New investments close {MIN_DAYS_BEFORE_START} days before the start date.
            </Alert>
          )}

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={() => setQty(qty - 1)}
              disabled={qty <= 1}
              className="flex h-12 w-12 items-center justify-center rounded-xl border border-line transition hover:bg-surface-2 disabled:opacity-40"
              aria-label="Fewer units"
            >
              <Minus className="h-5 w-5" />
            </button>
            <div className="flex-1 text-center">
              <input
                type="number"
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-full bg-transparent text-center text-3xl font-extrabold tabular-nums outline-none"
                aria-label="Number of units"
              />
              <p className="text-xs text-muted">units</p>
            </div>
            <button
              onClick={() => setQty(qty + 1)}
              disabled={qty >= availableUnits}
              className="flex h-12 w-12 items-center justify-center rounded-xl border border-line transition hover:bg-surface-2 disabled:opacity-40"
              aria-label="More units"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {[...new Set([minUnits, minUnits * 2, minUnits * 5])]
              .filter((n) => n <= availableUnits)
              .map((n) => (
                <button
                  key={n}
                  onClick={() => setQty(n)}
                  className={cn('rounded-full border px-3 py-1 text-xs font-semibold transition', qty === n ? 'border-accent bg-accent/10 text-accent' : 'border-line hover:bg-surface-2')}
                >
                  {n} units
                </button>
              ))}
            {maxAffordable >= minUnits && (
              <button onClick={() => setQty(maxAffordable)} className="rounded-full border border-line px-3 py-1 text-xs font-semibold transition hover:bg-surface-2">
                Max ({maxAffordable})
              </button>
            )}
          </div>

          <div className="mt-5 divide-y divide-line rounded-2xl bg-surface-2/60 px-4 py-1">
            <Row label="You invest" value={formatNaira(amount)} />
            <Row label="Expected profit" value={<span className="text-accent">+{formatNaira(profit)}</span>} />
            <Row label="Monthly equivalent" value={formatNaira(period ? profit / period : 0)} />
            <Row label="Payout at maturity" value={formatNaira(amount + profit)} strong />
          </div>

          {problems.length > 0 && !soldOut && !windowClosed && (
            <div className="mt-4 space-y-1">
              {problems.map((p) => (
                <p key={p} className="text-xs font-medium text-red-500">
                  {p}
                </p>
              ))}
              {amount > availableBalance && (
                <Button to="/transact/deposit" variant="soft" size="sm" className="mt-2">
                  Fund wallet
                </Button>
              )}
            </div>
          )}

          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 p-4 pb-safe backdrop-blur-xl lg:static lg:mt-5 lg:border-0 lg:bg-transparent lg:p-0">
            <Button size="lg" className="w-full" disabled={!canInvest} onClick={() => setConfirmOpen(true)}>
              {soldOut ? 'Sold out' : windowClosed ? 'Investment window closed' : `Invest ${formatNaira(amount)}`}
            </Button>
          </div>
        </Card>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => !investing && setConfirmOpen(false)}
        title="Confirm investment"
        description={`${qty} unit${qty === 1 ? '' : 's'} of ${product.name}`}
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
        <div className="divide-y divide-line">
          <Row label="Amount" value={formatNaira(amount)} />
          <Row label="Expected ROI" value={`${roi}% over ${period} months`} />
          <Row label="Starts" value={formatDate(product.startDate)} />
          <Row label="Balance after" value={formatNaira(availableBalance - amount)} />
          <Row label="Expected payout" value={formatNaira(amount + profit)} strong />
        </div>
      </Modal>
    </div>
  );
};

export default Product;
