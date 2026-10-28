import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { addDoc, collection, doc, getDoc, updateDoc } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { BadgeCheck, Building2, Hash } from 'lucide-react';
import { db, functions } from '../firebase';
import { useApp } from '../context/AppContext';
import { useBanks } from '../hooks/useData';
import { formatNaira } from '../lib/format';
import { Alert, AmountInput, Button, Card, Input, PageHeader, Select } from '../components/ui';

// Paystack transfers are not live yet; flip this once the backend is ready
const WITHDRAWALS_ENABLED = false;

const Withdraw = () => {
  const { user, profile, availableBalance } = useApp();
  const { banks, loading: banksLoading, error: banksError } = useBanks();
  const [accountNumber, setAccountNumber] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [accountName, setAccountName] = useState('');
  const [amount, setAmount] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    if (profile && !prefilled) {
      setAccountNumber(profile.bankAccount || '');
      setBankCode(profile.bankCode || '');
      setPrefilled(true);
    }
  }, [profile, prefilled]);

  const value = Number(amount) || 0;
  const verified = Boolean(accountName);
  const resetVerification = () => setAccountName('');

  const handleVerify = async () => {
    if (!/^\d{10}$/.test(accountNumber) || !bankCode) {
      toast.error('Enter a 10-digit account number and select your bank.');
      return;
    }
    setVerifying(true);
    try {
      const res = await httpsCallable(functions, 'verifyBankAccount')({ accountNumber, bankCode });
      if (res?.data?.status && res.data.data.account_name) {
        setAccountName(res.data.data.account_name);
        toast.success('Account verified');
      } else {
        toast.error('We could not verify this account.');
      }
    } catch (error) {
      console.error('Verification error:', error);
      toast.error('Error verifying account.');
    } finally {
      setVerifying(false);
    }
  };

  const handleWithdraw = async () => {
    if (!verified) {
      toast.error('Please verify your account first.');
      return;
    }
    if (value <= 0) {
      toast.error('Enter a valid amount.');
      return;
    }

    setProcessing(true);
    try {
      const userRef = doc(db, 'users', user.uid);
      const currentBalance = (await getDoc(userRef)).data()?.availableBalance || 0;
      if (currentBalance < value) {
        toast.error('Insufficient balance.');
        return;
      }

      const res = await httpsCallable(functions, 'initiatePaystackTransfer')({
        amount: value,
        bankCode,
        accountNumber,
        accountName,
        userId: user.uid,
        email: user.email,
      });

      if (res.data.status === 'success') {
        await updateDoc(userRef, { availableBalance: currentBalance - value });
        await addDoc(collection(db, 'transactions'), {
          userId: user.uid,
          email: user.email,
          amount: value,
          status: 'pending',
          type: 'Withdraw',
          method: 'Paystack',
          transferCode: res.data.transferCode,
          accountNumber,
          bankCode,
          accountName,
          createdAt: new Date().toISOString(),
          timestamp: new Date().toISOString(),
        });
        toast.success('Withdrawal initiated.');
        setAmount('');
      } else {
        toast.error('Transfer failed. Try again.');
      }
    } catch (error) {
      console.error('Transfer error:', error);
      toast.error('Transfer failed. Try again.');
    } finally {
      setProcessing(false);
    }
  };

  const bankName = banks.find((b) => b.code === bankCode)?.name;

  return (
    <div className="mx-auto max-w-xl pb-24 lg:pb-0">
      <PageHeader title="Withdraw" subtitle={`Available: ${formatNaira(availableBalance)}`} back="/transact" />

      <div className="space-y-5">
        {!WITHDRAWALS_ENABLED && (
          <Alert tone="info" title="Withdrawals are coming soon">
            We’re finishing bank transfers. You can save your bank details now in Settings so you’re ready when they launch.
          </Alert>
        )}

        <Card className="space-y-4 p-5 sm:p-6">
          <h2 className="font-bold">Send to</h2>
          <Select
            label="Bank"
            icon={Building2}
            value={bankCode}
            onChange={(e) => {
              setBankCode(e.target.value);
              resetVerification();
            }}
            disabled={banksLoading}
            error={banksError ? "Couldn't load banks. Refresh to try again." : ''}
          >
            <option value="">{banksLoading ? 'Loading banks…' : 'Select your bank'}</option>
            {banks.map((bank) => (
              <option key={bank.code} value={bank.code}>
                {bank.name}
              </option>
            ))}
          </Select>
          <Input
            label="Account number"
            icon={Hash}
            inputMode="numeric"
            maxLength={10}
            placeholder="10-digit NUBAN"
            value={accountNumber}
            onChange={(e) => {
              setAccountNumber(e.target.value.replace(/\D/g, ''));
              resetVerification();
            }}
          />

          {verified ? (
            <div className="flex items-center gap-3 rounded-2xl bg-accent/10 p-4">
              <BadgeCheck className="h-6 w-6 shrink-0 text-accent" />
              <div>
                <p className="font-bold">{accountName}</p>
                <p className="text-xs text-muted">
                  {bankName} · {accountNumber}
                </p>
              </div>
            </div>
          ) : (
            <Button variant="outline" className="w-full" onClick={handleVerify} loading={verifying} disabled={!WITHDRAWALS_ENABLED}>
              Verify account
            </Button>
          )}
        </Card>

        <Card className="space-y-4 p-5 sm:p-6">
          <AmountInput
            label="Amount"
            value={amount}
            onChange={setAmount}
            placeholder="0"
            error={value > availableBalance ? 'Amount is more than your available balance' : ''}
            labelAction={
              <button type="button" onClick={() => setAmount(String(Math.floor(availableBalance)))} className="text-sm font-semibold text-accent hover:underline">
                Use max
              </button>
            }
          />
        </Card>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 p-4 pb-safe backdrop-blur-xl lg:static lg:mt-5 lg:border-0 lg:bg-transparent lg:p-0">
        <div className="mx-auto max-w-xl">
          <Button size="lg" className="w-full" onClick={handleWithdraw} loading={processing} disabled={!WITHDRAWALS_ENABLED || !verified || value <= 0 || value > availableBalance}>
            {WITHDRAWALS_ENABLED ? (value ? `Withdraw ${formatNaira(value)}` : 'Withdraw') : 'Coming soon'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Withdraw;
