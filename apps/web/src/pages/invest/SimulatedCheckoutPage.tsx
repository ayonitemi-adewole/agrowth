import { FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Logo } from '../../components/Layout';
import { Alert, Button, Card } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatNaira } from '../../lib/money';
import { simulatePayment } from '../../lib/payments';

/**
 * The simulated gateway's checkout, standing in for Paystack's page on demos: the investor
 * approves or declines, and is sent back as a real gateway would. No money moves; the
 * database only accepts these payments where an admin has allowed simulated payments.
 */
export function SimulatedCheckoutPage() {
  const [params] = useSearchParams();
  const reference = params.get('reference') ?? '';
  const amount = params.get('amount') ?? '0';
  const back = params.get('return');
  const [busy, setBusy] = useState<'pay' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only ever return to this app.
  const returnTo = (() => {
    try {
      const url = new URL(back ?? '/portfolio', window.location.origin);
      return url.origin === window.location.origin
        ? url
        : new URL('/portfolio', window.location.origin);
    } catch {
      return new URL('/portfolio', window.location.origin);
    }
  })();

  const finish = async (pay: boolean) => {
    setBusy(pay ? 'pay' : 'decline');
    setError(null);
    try {
      await simulatePayment(reference, pay);
      returnTo.searchParams.set('payment', reference);
      window.location.assign(returnTo.toString());
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-center">
          <Logo />
        </div>
        <Card className="space-y-5">
          <div className="flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-xs font-medium text-violet-800 ring-1 ring-violet-600/20">
            <FlaskConical className="size-4 shrink-0" aria-hidden />
            Simulated payment gateway: no money moves.
          </div>
          <div className="text-center">
            <p className="text-sm text-zinc-500">Pay the trustee's escrow account</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950 tabular-nums">
              {formatNaira(amount)}
            </p>
            <p className="mt-1 font-mono text-xs text-zinc-500">{reference}</p>
          </div>
          <p className="text-center text-xs text-zinc-500">
            On a live system this is the gateway’s own page, where the investor pays by card, bank
            transfer or USSD.
          </p>
          {error && <Alert>{error}</Alert>}
          <div className="grid gap-2">
            <Button
              busy={busy === 'pay'}
              disabled={busy !== null || !reference}
              onClick={() => finish(true)}
            >
              Pay {formatNaira(amount)}
            </Button>
            <Button
              variant="ghost"
              busy={busy === 'decline'}
              disabled={busy !== null || !reference}
              onClick={() => finish(false)}
            >
              Decline the payment
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
