import { Pencil } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { BANK_CHOICES, bankCode } from '../lib/bankfiles';
import { errorMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast';
import { Alert, Button, Field, Input, Modal } from './ui';

export interface BankAccount {
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
}

/** A payout account as one line: "OPay 8123456789 · AMINA IBRAHIM", or a dash. */
export const accountLine = (a: BankAccount) =>
  a.account_number ? `${a.bank_name} ${a.account_number} · ${a.account_name}` : '—';

/**
 * Add or change a payout account, saved through a database function (`rpc`, with its
 * `args` plus p_bank_name, p_account_number and p_account_name), which checks it.
 */
export function EditBankAccount({
  title,
  description,
  current,
  defaultName,
  rpc,
  args,
  onSaved,
}: {
  title: string;
  description?: string;
  current: BankAccount;
  /** The name to start from, e.g. the farmer's. */
  defaultName?: string;
  rpc: string;
  args: Record<string, unknown>;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const blank = () => ({
    bank: current.bank_name ?? '',
    number: current.account_number ?? '',
    name: current.account_name ?? defaultName ?? '',
  });
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc(rpc, {
      ...args,
      p_bank_name: form.bank.trim(),
      p_account_number: form.number.replace(/\s/g, ''),
      p_account_name: form.name.trim(),
    });
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    toast.success('Payout account saved');
    setOpen(false);
    onSaved();
  };

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setForm(blank());
          setError(null);
          setOpen(true);
        }}
      >
        <Pencil aria-hidden /> {current.account_number ? 'Change' : 'Add account'}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description}>
        <form onSubmit={save} className="space-y-4">
          <Field
            label="Bank or mobile money"
            hint={
              form.bank && !bankCode(form.bank)
                ? 'Not one the gateway can pay: it can still go in a bank payment file.'
                : undefined
            }
          >
            <Input
              list="bank-choices"
              value={form.bank}
              onChange={(e) => setForm({ ...form, bank: e.target.value })}
              required
              placeholder="e.g. OPay, First Bank"
            />
            <datalist id="bank-choices">
              {BANK_CHOICES.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </Field>
          <Field label="Account number" hint="10 digits">
            <Input
              value={form.number}
              onChange={(e) =>
                setForm({ ...form, number: e.target.value.replace(/[^0-9]/g, '').slice(0, 10) })
              }
              required
              inputMode="numeric"
              pattern="[0-9]{10}"
              className="font-mono"
            />
          </Field>
          <Field label="Account name" hint="As the bank has it">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </Field>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" busy={busy}>
              Save
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
