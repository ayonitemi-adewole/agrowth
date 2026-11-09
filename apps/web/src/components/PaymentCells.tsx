import { CheckCircle2, Landmark } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { PaymentKind } from '../lib/bankfiles';
import { errorMessage } from '../lib/errors';
import { formatDate } from '../lib/format';
import { formatNaira } from '../lib/money';
import { GATEWAY_NAME, type useGatewayPayouts } from '../lib/payouts';
import { supabase } from '../lib/supabase';
import { GatewayPayButton } from './GatewayPayButton';
import { useToast } from './Toast';
import { Alert, Badge, Button, Field, Input, Modal } from './ui';

/*
 * The status and action cells of a table of payments the trustee makes (settlement
 * payouts, vendor payments for vouchers), so every such table reads and works the same.
 */

export type GatewayData = ReturnType<typeof useGatewayPayouts>['data'];

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'neutral';

/**
 * Where a payment stands, always as one badge with a line of detail under it: voided,
 * paid, on its way (through Paystack or in a bank payment file), held, on hold, or to pay.
 */
export function PaymentStatus({
  kind,
  id,
  paidAt,
  reference,
  gateway,
  voided,
  onHold,
}: {
  kind: PaymentKind;
  id: string;
  paidAt: string | null;
  reference: string | null;
  gateway: GatewayData;
  /** The reason, if the payment was cancelled. */
  voided?: string | null;
  /** Why it mustn't be paid now, e.g. the vendor is suspended. */
  onHold?: string | null;
}) {
  const show = (tone: Tone, label: string, detail?: ReactNode) => (
    <>
      <Badge tone={tone} dot>
        {label}
      </Badge>
      {detail && <span className="mt-1 block text-xs text-zinc-500">{detail}</span>}
    </>
  );
  if (voided) return show('neutral', 'Voided', voided);
  if (paidAt) {
    return show(
      'green',
      'Paid',
      <>
        {formatDate(paidAt)} · <span className="font-mono">{reference}</span>
      </>,
    );
  }
  const transfer = gateway?.liveFor(kind, id);
  if (transfer?.status === 'needs_review') {
    return show('red', 'Held', `${transfer.message ?? ''} Let it go on Bank files once checked.`);
  }
  if (transfer) {
    return show(
      'blue',
      `Paying through ${GATEWAY_NAME[transfer.provider]?.replace(/^the /, '') ?? transfer.provider}`,
      `Sent ${formatDate(transfer.requested_at)}; confirmed when it arrives`,
    );
  }
  if (onHold) return show('red', 'On hold', onHold);
  const payment = gateway?.paymentFor(kind, id);
  if (payment?.batch_id) {
    return show(
      'blue',
      'In a payment file',
      `Made ${formatDate(payment.batch_created_at)}; confirmed from the bank statement`,
    );
  }
  if (payment?.problem) return show('amber', 'To pay by hand', 'No bank account on file');
  return show('amber', 'To pay');
}

/**
 * What the trustee can do with an unpaid payment, always in the same order: pay it through
 * Paystack where that can be used, then record a payment made from the bank. Nothing while a
 * Paystack transfer is out, so it can't be paid twice. `children` go last (e.g. Void).
 */
export function PaymentActions({
  kind,
  id,
  gateway,
  trustee,
  record,
  reload,
  children,
}: {
  kind: PaymentKind;
  id: string;
  gateway: GatewayData;
  trustee: boolean;
  /** The bank-payment form for this payment; omit when it mustn't be paid (on hold). */
  record?: Omit<RecordBankPaymentProps, 'reload'>;
  reload: () => void;
  children?: ReactNode;
}) {
  const transferOut = Boolean(gateway?.liveFor(kind, id));
  const payable = gateway?.payable.find((p) => p.kind === kind && p.item_id === id);
  return (
    <span className="inline-flex flex-wrap justify-end gap-2">
      {trustee && !transferOut && record && gateway?.provider && payable && (
        <GatewayPayButton
          size="sm"
          payments={[payable]}
          provider={gateway.provider}
          balance={gateway.balance}
          onDone={reload}
        />
      )}
      {trustee && !transferOut && record && <RecordBankPayment {...record} reload={reload} />}
      {!transferOut && children}
    </span>
  );
}

interface RecordBankPaymentProps {
  /** e.g. confirm_settlement_payout, confirm_redemption_payment */
  rpc: string;
  /** The function's arguments, besides p_trustee_reference. */
  args: Record<string, unknown>;
  amountKobo: string | number;
  payee: string;
  /** Where the money went, shown to check against, e.g. the vendor's account. */
  account?: string;
  reload: () => void;
}

/** The trustee paid it from its bank: record it with the bank's reference. */
function RecordBankPayment({
  rpc,
  args,
  amountKobo,
  payee,
  account,
  reload,
}: RecordBankPaymentProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc(rpc, { ...args, p_trustee_reference: reference });
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    toast.success(`${formatNaira(amountKobo)} to ${payee} recorded as paid`);
    setOpen(false);
    reload();
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Landmark aria-hidden /> Record bank payment
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Record ${formatNaira(amountKobo)} to ${payee}`}
        description={`Once the trustee has paid it from the bank${account ? `, to ${account}` : ''}. This posts it to the ledger and can't be undone.`}
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Bank reference">
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              required
              maxLength={120}
              autoFocus
            />
          </Field>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" busy={busy}>
              <CheckCircle2 aria-hidden /> Record payment
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
