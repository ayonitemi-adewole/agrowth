import { Send } from 'lucide-react';
import { useState } from 'react';
import { PAYMENT_KIND, type TrusteePayment } from '../lib/bankfiles';
import { errorMessage } from '../lib/errors';
import { formatNaira, toKobo } from '../lib/money';
import { GATEWAY_NAME, describeSend, sendPayouts } from '../lib/payouts';
import { useToast } from './Toast';
import { Alert, Button, Modal, Table } from './ui';

/**
 * Pay one or more payments through the gateway, from the trustee's Paystack balance. Each
 * account is checked before anything is sent.
 */
export function GatewayPayButton({
  payments,
  provider,
  balance,
  onDone,
  size = 'md',
  label = 'Pay through Paystack',
}: {
  payments: TrusteePayment[];
  provider: string;
  balance: string | null;
  onDone: () => void;
  size?: 'sm' | 'md';
  label?: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = payments.reduce((s, p) => s + toKobo(p.amount_kobo), 0n);
  const short = balance !== null && toKobo(balance) < total;
  const name = GATEWAY_NAME[provider] ?? provider;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const { results } = await sendPayouts(
        payments.map((p) => ({ kind: p.kind, item_id: p.item_id })),
      );
      const { ok, message } = describeSend(results);
      (ok ? toast.success : toast.error)(message);
      setOpen(false);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size={size}
        disabled={payments.length === 0}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Send aria-hidden /> {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        wide
        title={`Pay ${formatNaira(total)} through ${name.replace(/^the /, '')}`}
        description={`${payments.length} payment${payments.length === 1 ? '' : 's'}, sent from the trustee's ${name.replace(/^the /, '')} balance. Each account is checked first: if the bank holds it for someone else, that payment is held and nothing is sent.`}
      >
        <div className="space-y-4">
          <Table head={['Payee', 'Account', 'Amount']}>
            {payments.map((p) => (
              <tr key={`${p.kind}:${p.item_id}`}>
                <td>
                  <span className="font-medium text-zinc-900">{p.payee_name}</span>
                  <span className="block text-xs text-zinc-500">{PAYMENT_KIND[p.kind]}</span>
                </td>
                <td className="text-zinc-600">
                  {p.bank_name} <span className="font-mono">{p.account_number}</span>
                </td>
                <td className="text-right tabular-nums">{formatNaira(p.amount_kobo)}</td>
              </tr>
            ))}
          </Table>
          {balance !== null && (
            <p className="text-sm text-zinc-600">
              Balance available:{' '}
              <span className="font-medium tabular-nums">{formatNaira(balance)}</span>. The
              gateway's transfer fees come from the balance too.
            </p>
          )}
          {short && (
            <Alert tone="warning">
              The balance won't cover these payments. Top it up from the escrow account first.
            </Alert>
          )}
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button busy={busy} disabled={short} onClick={send}>
              <Send aria-hidden /> Send {formatNaira(total)}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
