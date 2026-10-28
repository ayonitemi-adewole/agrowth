import { useEffect, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { ArrowRight, Building2, Hash, Save } from 'lucide-react';
import { db } from '../../firebase';
import { useApp } from '../../context/AppContext';
import { useBanks } from '../../hooks/useData';
import { AmountInput, Button, Input, Select } from '../ui';

const WithdrawalSettings = () => {
  const { user, profile } = useApp();
  const { banks, loading: banksLoading, error: banksError } = useBanks();
  const [form, setForm] = useState({ bankAccount: '', bankCode: '', withdrawalLimit: '5000' });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile && !loaded) {
      setForm({
        bankAccount: profile.bankAccount || '',
        bankCode: profile.bankCode || '',
        withdrawalLimit: String(profile.withdrawalLimit || '5000'),
      });
      setLoaded(true);
    }
  }, [profile, loaded]);

  const accountError = form.bankAccount && !/^\d{10}$/.test(form.bankAccount) ? 'Account numbers have 10 digits' : '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.bankAccount || !form.bankCode) {
      toast.error('Please enter your account number and bank.');
      return;
    }
    if (accountError) return;

    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        bankAccount: form.bankAccount,
        bankCode: form.bankCode,
        withdrawalLimit: form.withdrawalLimit,
      });
      toast.success('Withdrawal details saved');
    } catch (err) {
      console.error('Error updating withdrawal settings:', err);
      toast.error('Failed to update withdrawal settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <p className="text-sm text-muted">Payouts and withdrawals will be sent to this account.</p>
      <Select
        label="Bank"
        icon={Building2}
        value={form.bankCode}
        onChange={(e) => setForm((prev) => ({ ...prev, bankCode: e.target.value }))}
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
        value={form.bankAccount}
        onChange={(e) => setForm((prev) => ({ ...prev, bankAccount: e.target.value.replace(/\D/g, '') }))}
        error={accountError}
      />
      <AmountInput
        label="Withdrawal limit"
        size="md"
        value={form.withdrawalLimit}
        onChange={(value) => setForm((prev) => ({ ...prev, withdrawalLimit: value }))}
        hint="A safety cap on how much can be withdrawn at once."
      />

      <div className="flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <Button to="/transact" variant="ghost" iconRight={ArrowRight}>
          View transaction history
        </Button>
        <Button type="submit" icon={Save} loading={saving}>
          Save details
        </Button>
      </div>
    </form>
  );
};

export default WithdrawalSettings;
