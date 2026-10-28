import { useState } from 'react';
import { addDoc, collection } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { CreditCard, Landmark, Lock, QrCode, Smartphone } from 'lucide-react';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { cn, formatNaira } from '../lib/format';
import { Alert, AmountInput, Button, Card, PageHeader } from '../components/ui';

const BASE_URL = 'https://smart-farmer-ercaspay-api.onrender.com';
const MINIMUM_DEPOSIT = 100;
const QUICK_AMOUNTS = [1000, 5000, 10000, 50000];

const METHODS = [
  { icon: CreditCard, label: 'Card' },
  { icon: Landmark, label: 'Transfer' },
  { icon: Smartphone, label: 'USSD' },
  { icon: QrCode, label: 'QR code' },
];

const Deposit = () => {
  const { user, profile, availableBalance } = useApp();
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const value = Number(amount) || 0;
  const fullName = `${profile?.lastName || ''} ${profile?.firstName || ''}`.trim();
  const tooLow = value > 0 && value < MINIMUM_DEPOSIT;

  const handleDeposit = async () => {
    if (isProcessing) return;
    if (value < MINIMUM_DEPOSIT) {
      toast.warning(`Please enter at least ${formatNaira(MINIMUM_DEPOSIT)}`);
      return;
    }
    setIsProcessing(true);

    const paymentReference = user.uid + Date.now();
    const depositData = {
      amount: value,
      paymentReference,
      paymentMethods: 'card,bank-transfer,ussd,qrcode',
      customerName: fullName,
      customerEmail: user.email,
      currency: 'NGN',
      redirectUrl: `${window.location.origin}/transact/deposit-success`,
      description: 'Deposit to your account',
      metadata: { userId: user.uid, userEmail: user.email, userName: fullName },
    };

    try {
      const response = await fetch(`${BASE_URL}/api/ercaspay/initiate-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(depositData),
      });

      if (!response.ok) {
        toast.error('Unable to initiate payment. Please try again.');
        return;
      }

      const data = await response.json();
      if (data.responseMessage !== 'success') {
        toast.error('Payment initiation failed.');
        return;
      }

      await addDoc(collection(db, 'transactions'), {
        uid: user.uid,
        email: user.email,
        type: 'deposit',
        amount: value,
        status: 'pending',
        reference: paymentReference,
        txn_data: depositData,
        createdAt: new Date().toISOString(),
      });

      toast.info('Redirecting you to secure checkout…');
      window.location.href = data.responseBody.checkoutUrl;
    } catch (err) {
      console.error('Payment error:', err);
      toast.error('An error occurred during deposit.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl pb-24 lg:pb-0">
      <PageHeader title="Add money" subtitle={`Balance: ${formatNaira(availableBalance)}`} back="/transact" />

      <div className="space-y-5">
        <Alert tone="warning" title="Deposits are in beta">
          Deposits are still in development. Funds may be lost, so please start with small amounts.
        </Alert>

        <Card className="space-y-5 p-5 sm:p-6">
          <AmountInput
            label="Amount"
            value={amount}
            onChange={setAmount}
            placeholder="0"
            autoFocus
            error={tooLow ? `Minimum deposit is ${formatNaira(MINIMUM_DEPOSIT)}` : ''}
            hint={`Minimum ${formatNaira(MINIMUM_DEPOSIT)}`}
          />
          <div className="grid grid-cols-4 gap-2">
            {QUICK_AMOUNTS.map((n) => (
              <button
                key={n}
                onClick={() => setAmount(String(n))}
                className={cn(
                  'rounded-xl border py-2.5 text-sm font-bold transition',
                  value === n ? 'border-accent bg-accent/10 text-accent' : 'border-line hover:bg-surface-2'
                )}
              >
                {formatNaira(n)}
              </button>
            ))}
          </div>

          <div className="rounded-2xl bg-surface-2/60 p-4 text-sm">
            <div className="flex justify-between py-1">
              <span className="text-muted">Account name</span>
              <span className="font-semibold">{fullName || '—'}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted">Email</span>
              <span className="truncate pl-4 font-semibold">{user?.email}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted">New balance</span>
              <span className="font-semibold tabular-nums">{formatNaira(availableBalance + value)}</span>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Pay with</p>
            <div className="grid grid-cols-4 gap-2">
              {METHODS.map(({ icon: Icon, label }) => (
                <div key={label} className="flex flex-col items-center gap-1.5 rounded-xl border border-line py-3 text-xs font-medium text-muted">
                  <Icon className="h-5 w-5 text-fg" />
                  {label}
                </div>
              ))}
            </div>
          </div>
        </Card>

        <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
          <Lock className="h-3.5 w-3.5" /> You’ll complete payment on Ercaspay’s secure checkout
        </p>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 p-4 pb-safe backdrop-blur-xl lg:static lg:mt-5 lg:border-0 lg:bg-transparent lg:p-0">
        <div className="mx-auto max-w-xl">
          <Button size="lg" className="w-full" onClick={handleDeposit} loading={isProcessing} disabled={value < MINIMUM_DEPOSIT}>
            {isProcessing ? 'Preparing checkout…' : value ? `Deposit ${formatNaira(value)}` : 'Enter an amount'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Deposit;
