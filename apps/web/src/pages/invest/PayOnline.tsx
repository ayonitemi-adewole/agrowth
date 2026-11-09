import { CreditCard, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, DescriptionList, Modal } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatNaira } from '../../lib/money';
import { GATEWAY_LABEL, returnUrl, startPledgePayment } from '../../lib/payments';

/**
 * Pay a pledge online. The payment is opened first, so the investor sees exactly what
 * they'll be charged (the pledge plus the gateway's fee) before leaving for the gateway.
 */
export function PayOnline({
  gateway,
  pledge,
}: {
  gateway: string;
  pledge: { id: string; amount_kobo: string; cooling_off_ends_at: string; pay_by: string };
}) {
  const [open, setOpen] = useState(false);
  const [checkout, setCheckout] = useState<{ url: string; charge: string; fee: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coolingOff = new Date(pledge.cooling_off_ends_at) > new Date();
  const name = GATEWAY_LABEL[gateway] ?? gateway;

  const begin = async () => {
    setOpen(true);
    setCheckout(null);
    setError(null);
    setBusy(true);
    try {
      const r = await startPledgePayment(pledge.id, returnUrl());
      setCheckout({ url: r.checkout_url, charge: r.charge_kobo, fee: r.fee_kobo });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (coolingOff) {
    return (
      <p className="text-xs text-zinc-500">You can pay online once your cooling-off period ends.</p>
    );
  }
  return (
    <>
      <Button onClick={begin}>
        <CreditCard aria-hidden /> Pay online
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Pay online"
        description={`By card, bank transfer or USSD through ${name}. The money goes straight to the trustee's escrow account, as a transfer would.`}
      >
        <div className="space-y-4">
          {busy && <p className="text-sm text-zinc-500">Preparing your payment…</p>}
          {error && <Alert>{error}</Alert>}
          {checkout && (
            <>
              <DescriptionList
                items={[
                  ['Your investment', formatNaira(pledge.amount_kobo)],
                  ['Gateway fee', formatNaira(checkout.fee)],
                  ['You pay', formatNaira(checkout.charge)],
                ]}
              />
              <p className="text-xs text-zinc-500">
                The fee is the gateway’s, added so the full amount reaches the trustee. Your
                investment is confirmed as soon as the payment goes through.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => window.location.assign(checkout.url)}>
                  Continue to payment <ExternalLink aria-hidden />
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
